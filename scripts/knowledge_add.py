"""Knowledge-base curation CLI.

Add a lesson node:
  python scripts/knowledge_add.py --text "..." --tags quiz,fill [--scope regional]
                                  [--run rsi-k2-a] [--gen 4]

List nodes with stats:
  python scripts/knowledge_add.py --list

Promote a probation node after independent evidence:
  python scripts/knowledge_add.py --promote tip_xxxx --evidence-file evidence.json
  # evidence: {"node_id":"tip_xxxx", "independent_groups":2, "paired_delta":0.01}
  # historical uses/wins remain co-exposure telemetry, not causal evidence

Nodes live in knowledge/nodes.jsonl (one JSON per line). Dedup is by
normalized text; duplicates are reported, not written.
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = os.path.join(ROOT, "knowledge", "nodes.jsonl")


def load():
    if not os.path.exists(KB):
        return []
    return [json.loads(l) for l in open(KB, encoding="utf-8") if l.strip()]


def norm_text(s):
    return re.sub(r"\s+", " ", s.strip().lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text")
    ap.add_argument("--tags", help="comma separated regions, e.g. quiz,fill")
    ap.add_argument("--scope", choices=["regional", "generic"], default="regional")
    ap.add_argument("--run", default="manual")
    ap.add_argument("--gen", type=int, default=0)
    ap.add_argument("--status", choices=["active", "probation", "retired"], default="active")
    ap.add_argument("--id", help="explicit id (default tip_NNNN)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--promote", action="append", help="promote an existing probation node by id (repeatable)")
    ap.add_argument("--evidence-file", help="independent A/B evidence JSON required for promotion unless --force")
    ap.add_argument("--min-uses", type=int, default=3, help="legacy co-exposure display threshold (not causal evidence)")
    ap.add_argument("--min-win-rate", type=float, default=0.8, help="legacy competent-exposure rate (not causal evidence)")
    ap.add_argument("--force", action="store_true", help="promote without probation thresholds")
    a = ap.parse_args()

    nodes = load()
    if a.list:
        for n in nodes:
            avg = n["stats"]["fitness_sum"] / n["stats"]["uses"] if n["stats"]["uses"] else float("nan")
            print(f"{n['id']} [{n['status']}/{n['scope']}] tags={','.join(n['tags'])} "
                  f"uses={n['stats']['uses']} competent_exposures={n['stats']['wins']} avg_fit={avg:.3f}")
            print(f"   {n['text'][:100]}")
        print(f"\n{len(nodes)} nodes")
        return

    if a.promote:
        wanted = set(a.promote)
        evidence = None
        if a.evidence_file:
            evidence = json.load(open(a.evidence_file, encoding="utf-8"))
        if not a.force and not evidence:
            sys.exit("promotion requires --evidence-file with independent A/B evidence (or explicit --force)")
        changed = 0
        for n in nodes:
            if n.get("id") not in wanted:
                continue
            if n.get("status") != "probation":
                print(f"{n['id']}: not probation ({n.get('status')}) - unchanged")
                continue
            stats = n.get("stats", {})
            uses = int(stats.get("uses", 0))
            wins = int(stats.get("wins", 0))
            rate = wins / uses if uses else 0.0
            if not a.force:
                evidence_ok = (
                    evidence.get("node_id") == n.get("id")
                    and int(evidence.get("independent_groups", 0)) >= 2
                    and float(evidence.get("paired_delta", 0)) > 0
                )
                if not evidence_ok:
                    print(f"{n['id']}: independent evidence missing/mismatched - unchanged")
                    continue
            n["status"] = "active"
            changed += 1
            print(f"{n['id']}: promoted independent_evidence={'forced' if a.force else a.evidence_file} uses={uses} competent_exposure_rate={rate:.3f}")
        missing = wanted - {n.get("id") for n in nodes}
        for nid in sorted(missing):
            print(f"{nid}: not found")
        if changed:
            tmp = KB + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                for n in nodes:
                    f.write(json.dumps(n, ensure_ascii=False) + "\n")
            os.replace(tmp, KB)
        return

    if not a.text or not a.tags:
        sys.exit("--text and --tags required (or --list)")
    tags = [t.strip().lower() for t in a.tags.split(",") if t.strip()]
    dup = [n["id"] for n in nodes if norm_text(n["text"]) == norm_text(a.text)]
    if dup:
        print(f"DUPLICATE of {dup} - not added")
        return
    nums = [int(m.group(1)) for n in nodes if (m := re.match(r"tip_(\d+)", n["id"]))]
    nid = a.id or f"tip_{max(nums, default=0) + 1:04d}"
    node = {
        "id": nid,
        "text": a.text.strip(),
        "tags": tags,
        "scope": a.scope,
        "stats": {"uses": 0, "wins": 0, "fitness_sum": 0},
        "origin": {"run": a.run, "gen": a.gen},
        "status": a.status,
    }
    with open(KB, "a", encoding="utf-8") as f:
        f.write(json.dumps(node, ensure_ascii=False) + "\n")
    print(f"added {nid} tags={tags}")


if __name__ == "__main__":
    main()
