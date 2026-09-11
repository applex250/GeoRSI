#!/usr/bin/env python3
"""Independent fail-closed verdict for a GeoRSI research package."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

REQUIRED = [
    "mission.json", "plan.json", "events.jsonl", "claims.json",
    "evidence-index.json", "environment.json", "runtime-attestation.json",
    "research-manifest.json", "replay.json", "research-score.json",
    "package-seal.json", "report.md", "presentation.md", "defense.json",
]


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def bytes_digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def resolve_run(value: str, root: Path | None = None) -> Path:
    root = root or Path(__file__).resolve().parents[1]
    candidate = Path(value)
    return candidate.resolve() if candidate.is_absolute() or candidate.exists() else (root / "runs" / value).resolve()


def work_graph_fingerprint(graph: dict) -> str:
    stable = []
    for node in graph.get("nodes", []):
        stable.append({
            "id": node.get("id"), "kind": node.get("kind"),
            "dependsOn": sorted(node.get("dependsOn", [])),
            "expectedOutputs": node.get("expectedOutputs", []),
            "acceptanceCriteriaIds": node.get("acceptanceCriteriaIds", []),
            "allowedCapabilities": node.get("allowedCapabilities", []),
            "budget": node.get("budget"),
        })
    stable.sort(key=lambda item: item.get("id") or "")
    return digest([graph.get("missionId"), stable])[:16]


def verify_ledger(path: Path, expected_root: str | None) -> list[str]:
    issues = []
    previous = None
    sequence = 0
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except Exception:
            issues.append(f"malformed event ledger line {index}")
            continue
        sequence += 1
        if event.get("seq") != sequence:
            issues.append(f"non-monotonic event sequence at {index}")
        if event.get("previousHash") != previous:
            issues.append(f"event previousHash mismatch at {index}")
        stored = event.get("hash")
        unsigned = dict(event)
        unsigned.pop("hash", None)
        if stored != digest(unsigned):
            issues.append(f"event hash mismatch at {index}")
        previous = stored
    if previous != expected_root:
        issues.append("event ledger root does not match manifest")
    return issues


def evaluate(run_dir: Path) -> tuple[bool, dict]:
    missing = [name for name in REQUIRED if not (run_dir / name).is_file()]
    issues: list[str] = [f"missing {name}" for name in missing]
    objects = {}
    if not missing:
        try:
            for name in ("mission", "plan", "claims", "evidence-index", "environment", "runtime-attestation", "research-manifest", "replay", "research-score", "package-seal"):
                objects[name] = json.loads((run_dir / f"{name}.json").read_text(encoding="utf-8"))
        except Exception as error:
            issues.append(f"invalid JSON evidence: {error}")
    if issues:
        return False, {"runDir": str(run_dir), "issues": issues}

    mission, graph, claims = objects["mission"], objects["plan"], objects["claims"]
    evidence, environment = objects["evidence-index"], objects["environment"]
    attestation, manifest = objects["runtime-attestation"], objects["research-manifest"]
    replay, score, seal = objects["replay"], objects["research-score"], objects["package-seal"]

    unsigned_manifest = dict(manifest)
    stored_manifest_hash = unsigned_manifest.pop("manifestHash", None)
    if stored_manifest_hash != digest(unsigned_manifest):
        issues.append("manifest hash mismatch")
    unsigned_seal = dict(seal)
    stored_seal_hash = unsigned_seal.pop("sealHash", None)
    if stored_seal_hash != digest(unsigned_seal) or seal.get("manifestHash") != manifest.get("manifestHash") or seal.get("replayHash") != digest(replay) or seal.get("scoreHash") != digest(score):
        issues.append("package seal mismatch")
    if manifest.get("missionId") != mission.get("id") or manifest.get("missionFingerprint") != digest(mission)[:24]:
        issues.append("mission commitment mismatch")
    if manifest.get("workGraphStateHash") != digest(graph):
        issues.append("work graph state commitment mismatch")
    if manifest.get("environmentFingerprint") != environment.get("fingerprint") or manifest.get("environmentHash") != digest(environment):
        issues.append("environment commitment mismatch")
    sorted_evidence = sorted(evidence, key=lambda item: item.get("id", ""))
    if manifest.get("evidence") != sorted_evidence or manifest.get("evidenceIndexHash") != digest(sorted_evidence):
        issues.append("evidence index commitment mismatch")
    sorted_claims = sorted(claims, key=lambda item: item.get("id", ""))
    if manifest.get("claimIds") != [item.get("id") for item in sorted_claims] or manifest.get("claimHashes") != [digest(item) for item in sorted_claims]:
        issues.append("claim commitment mismatch")

    issues.extend(verify_ledger(run_dir / "events.jsonl", manifest.get("eventLedgerRootHash")))
    for deliverable in manifest.get("deliverables", []):
        path = (run_dir / str(deliverable.get("path", ""))).resolve()
        try:
            path.relative_to(run_dir.resolve())
            content = path.read_bytes()
        except Exception:
            issues.append(f"missing or unsafe deliverable {deliverable.get('id')}")
            continue
        if len(content) != deliverable.get("bytes") or bytes_digest(content) != deliverable.get("sha256"):
            issues.append(f"deliverable hash mismatch {deliverable.get('id')}")

    evidence_root = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "GeoRSI" / "evidence" / run_dir.name
    for reference in sorted_evidence:
        sha = reference.get("sha256", "")
        path = evidence_root / sha[:2] / sha
        try:
            content = path.read_bytes()
        except Exception:
            issues.append(f"missing CAS evidence {reference.get('id')}")
            continue
        if len(content) != reference.get("bytes") or bytes_digest(content) != sha:
            issues.append(f"CAS evidence mismatch {reference.get('id')}")

    compute = replay.get("computeReplay") or {}
    if replay.get("passed") is not True or compute.get("passed") is not True:
        issues.append("replay did not pass")
    mode = attestation.get("runMode")
    receipts = attestation.get("modelCalls") or []
    runtime_issues = []

    # The package must commit the authoritative model policy; receipts are
    # validated against it instead of a hardcoded provider identity.
    policy = attestation.get("modelPolicy")
    policy_issues: list[str] = []
    if isinstance(policy, dict) and policy.get("model"):
        required_policy_fields = ("provider", "base_url", "model", "api", "thinking_level", "max_tokens_field", "credential_env", "fallback")
        missing = [field for field in required_policy_fields if not policy.get(field)]
        if missing:
            policy_issues.append(f"model policy missing fields: {', '.join(missing)}")
        if policy.get("fallback") != "none":
            policy_issues.append("model policy fallback must be none")
        if policy.get("thinking_level") not in ("high", "xhigh"):
            policy_issues.append("model policy thinking must be high or xhigh")
        if mode == "competition" and policy.get("thinking_level") != "xhigh":
            policy_issues.append("competition model policy thinking must be xhigh")
        expected_fp = digest(policy)[:24]
        if attestation.get("modelPolicyFingerprint") != expected_fp:
            policy_issues.append("research model policy fingerprint mismatch")
        expected_provider = policy.get("provider")
        expected_model = policy.get("model")
        expected_api = policy.get("api")
        expected_thinking = policy.get("thinking_level")
    else:
        policy = None
        expected_provider, expected_model, expected_api, expected_thinking = "ai-pixel", "gpt-5.6-luna", "openai-responses", "xhigh"

    if attestation.get("unitTestsPassed") is not True:
        runtime_issues.append("unit tests not attested")
    if attestation.get("guardViolations"):
        runtime_issues.append("guard violations present")
    if attestation.get("cleanupPassed") is not True:
        runtime_issues.append("cleanup did not pass")
    if any(item.get("success") is not True for item in receipts):
        runtime_issues.append("failed model receipt present")

    family = (mission.get("taskProfile") or {}).get("family")
    required_profiles = ["gis-v1", "literature-v1", "quantitative-v1"] if family == "capstone" else [(mission.get("taskProfile") or {}).get("verifierProfile")]
    family_attestations = attestation.get("familyVerifications") or []
    actual_profiles = sorted(item.get("profile") for item in family_attestations)
    if len(actual_profiles) != len(set(actual_profiles)) or actual_profiles != sorted(required_profiles):
        runtime_issues.append("family verifier profile set mismatch")
    evidence_ids = {item.get("id") for item in sorted_evidence}
    claim_ids = {item.get("id") for item in sorted_claims}
    for item in family_attestations:
        result = item.get("result") or {}
        if result.get("profile") != item.get("profile") or result.get("passed") is not True or not item.get("inputHash") or not item.get("evidenceIds") or any(eid not in evidence_ids for eid in item.get("evidenceIds", [])):
            runtime_issues.append(f"invalid family verifier attestation {item.get('profile')}")
    contrary_links = attestation.get("contraryEvidenceLinks") or []
    for link in contrary_links:
        ref = next((item for item in sorted_evidence if item.get("id") == link.get("sourceEvidenceId")), None)
        if not ref or ref.get("kind") != "source" or link.get("claimId") not in claim_ids:
            runtime_issues.append("invalid contrary evidence link")
    if (mission.get("sourcePolicy") or {}).get("requireContraryEvidence") and not contrary_links:
        runtime_issues.append("required contrary evidence links missing")

    if mode == "competition":
        if policy is None:
            runtime_issues.append("competition package must persist the authoritative research model policy")
        runtime_issues.extend(policy_issues)
        evaluator_metrics = environment.get("evaluatorMetrics", {})
        if not (evaluator_metrics.get("researchCapabilityProbe") or evaluator_metrics.get("aiPixelCapabilityProbe")):
            runtime_issues.append("competition package lacks provider-observed research capability probe")
        if not receipts:
            runtime_issues.append("competition package has no model-call receipts")
        if attestation.get("isolationBackend") != "sandboxie-app-level" or compute.get("backend") != "sandboxie-app-level" or compute.get("processOwnershipVerified") is not True:
            runtime_issues.append("competition isolation/compute attestation is insufficient")
        if (policy or {}).get("thinking_evidence", "provider-observed") != "provider-observed":
            runtime_issues.append("competition requires provider-observed thinking evidence")
        dataset = mission.get("dataset")
        if not isinstance(dataset, dict) or not str(dataset.get("description", "")).strip() or dataset.get("seed") is None:
            runtime_issues.append("competition mission must declare a dataset contract with a binding seed")
        else:
            dataset_fp = environment.get("evaluatorMetrics", {}).get("datasetFingerprint")
            canonical = hashlib.sha256(json.dumps(dataset, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
            if dataset_fp != canonical:
                runtime_issues.append("competition dataset fingerprint mismatch between mission and environment capture")
    elif mode == "deterministic-demo":
        if compute.get("backend") != "deterministic-test-double":
            runtime_issues.append("deterministic demo has wrong compute backend")
    elif mode == "host-development":
        # Honest development mode: sandbox isolation disabled by configuration; the package
        # stays ineligible (expected_eligible below requires competition mode) but the
        # attestation must pair consistently with the host-audit compute backend.
        if attestation.get("isolationBackend") != "host-audit" or compute.get("backend") != "host-audit":
            runtime_issues.append("host-development package must attest host-audit isolation honestly")
    else:
        runtime_issues.append("unknown research run mode")
    overrides = attestation.get("thinkingOverrides") or {}
    receipt_ids = set()
    for receipt in receipts:
        rid = receipt.get("id")
        nid = receipt.get("nodeId")
        expected_t = overrides.get(nid, expected_thinking) if isinstance(nid, str) else expected_thinking
        if not isinstance(rid, str) or not rid.strip():
            runtime_issues.append("model receipt id is missing")
        elif isinstance(rid, str) and rid in receipt_ids:
            runtime_issues.append(f"duplicate model receipt id: {rid}")
        if isinstance(rid, str):
            receipt_ids.add(rid)
        for field in ("inputTokens", "outputTokens", "reasoningTokens"):
            value = receipt.get(field)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                runtime_issues.append(f"invalid {field} in model receipt {rid}")
        total = receipt.get("totalTokens")
        if isinstance(total, bool) or not isinstance(total, int) or total < 0:
            runtime_issues.append(f"invalid totalTokens in model receipt {rid}")
        if receipt.get("provider") != expected_provider or receipt.get("model") != expected_model or receipt.get("api") != expected_api or receipt.get("requestedThinking") != expected_t or receipt.get("effectiveThinking") != expected_t or receipt.get("success") is not True or not isinstance(receipt.get("outputTokens"), int) or isinstance(receipt.get("outputTokens"), bool) or receipt.get("outputTokens") <= 0:
            runtime_issues.append(f"forbidden or invalid model receipt {rid}")

    receipt_totals = []
    for item in receipts:
        value = item.get("totalTokens")
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            continue
        receipt_totals.append(value)
    if not isinstance(attestation.get("totalTokens"), int) or isinstance(attestation.get("totalTokens"), bool) or attestation.get("totalTokens") < 0 or attestation.get("totalTokens") != sum(receipt_totals) or len(receipt_totals) != len(receipts):
        runtime_issues.append("token total does not match model receipts")
    issues.extend(runtime_issues)

    components = score.get("components") or {}
    expected_overall = (
        float(components.get("taskOutcome", 0)) * 0.30 +
        float(components.get("methodValidity", 0)) * 0.20 +
        float(components.get("claimEvidenceQuality", 0)) * 0.15 +
        float(components.get("reproducibility", 0)) * 0.15 +
        float(components.get("scientificValue", 0)) * 0.10 +
        float(components.get("communication", 0)) * 0.10
    )
    expected_eligible = mode == "competition" and not runtime_issues and replay.get("passed") is True and compute.get("passed") is True
    if score.get("eligible") is not expected_eligible:
        issues.append("research eligibility does not match independent runtime gates")
    if expected_eligible:
        if not isinstance(score.get("overall"), (int, float)) or abs(float(score["overall"]) - expected_overall) > 1e-9:
            issues.append("research overall score does not match deterministic weights")
    elif score.get("overall") is not None:
        issues.append("ineligible research score must have null overall")

    detail = {
        "runDir": str(run_dir), "runMode": mode, "eligible": score.get("eligible"),
        "overall": score.get("overall"), "replay": replay.get("passed"),
        "computeReplay": compute.get("passed"), "modelReceipts": len(receipts),
        "issues": issues,
    }
    return not issues, detail


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python scripts/research_verdict.py <run-name-or-dir>")
    ok, detail = evaluate(resolve_run(sys.argv[1]))
    print(("RESEARCH_VERDICT_OK " if ok else "RESEARCH_VERDICT_FAIL ") + json.dumps(detail, ensure_ascii=False))
    raise SystemExit(0 if ok else 2)


if __name__ == "__main__":
    main()
