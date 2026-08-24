"""Offline unit tests for the RSI lab core (no network needed).

Run:  python tests/test_core.py   (or pytest tests/test_core.py)
"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from rsi.evolve import ANGLES, apply_edits
from rsi.executor import run_python
from rsi.evaluator import score
from rsi.llm import extract_json, make_client
from rsi.models import Scaffold
from rsi.solve import build_messages, extract_code

FENCE = chr(96) * 3
EVAL_SCRIPT = os.path.join(ROOT, "problems", "quake_b", "eval.py")


# ---------- llm.extract_json ----------

def test_extract_json_fenced():
    inner = FENCE + 'json\n{"b": 0.9, "n": 1}\n' + FENCE
    assert extract_json("Sure! Here you go:\n" + inner) == {"b": 0.9, "n": 1}


def test_extract_json_bare_in_prose():
    text = 'The answer is {"b": 1.25, "why": "mle {with braces}"} per MLE.'
    assert extract_json(text)["b"] == 1.25


def test_extract_json_invalid_returns_none():
    assert extract_json("no json here at all") is None


# ---------- solve.extract_code / build_messages ----------

def test_extract_code_single_block():
    reply = "thinking...\n" + FENCE + "python\nprint(1+1)\n" + FENCE + "\ndone"
    assert extract_code(reply) == ["print(1+1)"]


def test_extract_code_multiple_blocks_keeps_order():
    reply = FENCE + "\na = 1\n" + FENCE + "\nmid\n" + FENCE + "\nb = 2\n" + FENCE
    assert extract_code(reply) == ["a = 1", "b = 2"]


def test_extract_code_none():
    assert extract_code("just prose, no code") == []


def test_build_messages_appends_tips():
    msgs = build_messages({"system_prompt": "base", "tips": ["t1"]}, "STMT")
    assert msgs[0]["role"] == "system" and "t1" in msgs[0]["content"]
    assert msgs[1] == {"role": "user", "content": "STMT"}


# ---------- evolve.apply_edits ----------

def test_apply_add_tip():
    s = apply_edits({"system_prompt": "p", "tips": []},
                    [{"op": "add_tip", "text": "new"}])
    assert s["tips"] == ["new"]


def test_apply_delete_and_replace_index_bounds():
    s = {"system_prompt": "p", "tips": ["a", "b"]}
    out = apply_edits(s, [
        {"op": "delete_tip", "index": 5},
        {"op": "replace_tip", "index": 0, "text": "A"},
        {"op": "delete_tip", "index": 1},
    ])
    assert out["tips"] == ["A"]


def test_apply_prompt_append_and_lr_cap():
    s = {"system_prompt": "p", "tips": []}
    edits = [{"op": "prompt_append", "text": "x"}, {"op": "add_tip", "text": "y"}]
    out = apply_edits(s, edits, lr=1)
    assert out["system_prompt"].endswith("x") and out["tips"] == []


def test_original_not_mutated():
    s = {"system_prompt": "p", "tips": ["keep"]}
    apply_edits(s, [{"op": "add_tip", "text": "more"}])
    assert s["tips"] == ["keep"]


def test_angles_nonempty():
    assert len(ANGLES) >= 3


# ---------- models.Scaffold ----------

def test_scaffold_roundtrip():
    sc = Scaffold(system_prompt="sp", tips=["a"], generation=3)
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.json")
        sc.save(p)
        back = Scaffold.load(p)
    assert back.system_prompt == "sp" and back.tips == ["a"] and back.generation == 3


# ---------- executor.run_python ----------

def test_run_python_stdout_and_code():
    res = run_python("print(40 + 2)", timeout_s=30)
    assert res["returncode"] == 0 and res["stdout"].strip() == "42"


def test_run_python_error_surface():
    res = run_python("raise ValueError('boom')", timeout_s=30)
    assert res["returncode"] != 0 and "boom" in res["stderr"]


def test_run_python_timeout():
    res = run_python("import time; time.sleep(10)", timeout_s=2)
    assert res["timed_out"] is True


# ---------- evaluator.score (real eval script, local files only) ----------

def _score_with(b_value, split):
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "sub.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"b": b_value}, fh)
        return score(EVAL_SCRIPT, p, split=split)


def test_score_perfect_private():
    fit, err = _score_with(0.85, "private")
    assert err is None and abs(fit - 1.0) < 1e-6


def test_score_partial_private():
    fit, err = _score_with(1.05, "private")
    assert err is None and abs(fit - 0.6) < 1e-6


def test_score_public_reference():
    fit, err = _score_with(1.00, "public")
    assert err is None and abs(fit - 1.0) < 1e-6


def test_score_bad_submission_zero():
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "bad.json")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("not json")
        fit, err = score(EVAL_SCRIPT, p)
    assert fit == 0.0


# ---------- llm.ModelRouter (offline: routing table only) ----------

def test_router_modes():
    r = make_client("https://example.invalid/v1", "k",
                    routes={"muse-spark-1.2-contributor": "proxy"})
    assert r.mode_for("hy3") == "direct"
    assert r.mode_for("muse-spark-1.2-contributor") == "proxy"


def test_router_client_cache():
    r = make_client("https://example.invalid/v1", "k")
    assert r.client_for("hy3") is r.client_for("hy3")
    assert r.client_for("hy3") is not r.client_for("muse-spark-1.2-contributor")


# ---------- runner ----------

def main():
    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    failed = []
    for name, fn in fns:
        try:
            fn()
            print("PASS " + name)
        except Exception as e:
            failed.append(name)
            print("FAIL " + name + ": " + type(e).__name__ + ": " + str(e))
    total = len(fns)
    print("")
    print(str(total - len(failed)) + "/" + str(total) + " passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
