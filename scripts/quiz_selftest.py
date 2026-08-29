"""No-LLM unit tests for problems/_shared/quiz_grader.py (run by src/selftest.ts)."""
import sys

sys.path.insert(0, "problems/_shared")
import quiz_grader as g  # noqa: E402

sys.path.insert(0, "scripts")
from quiz_build import extract_inline_options  # noqa: E402

# Option parsing must respect true token boundaries (EBSD) is not a D marker).
parsed = extract_inline_options("Which method? A) Seismic B) Electron Backscattered Diffraction (EBSD) C) XRD D) TEM")
assert parsed == ["Seismic", "Electron Backscattered Diffraction (EBSD)", "XRD", "TEM"]
assert extract_inline_options("A) one C) three") is None

# MCQ normalization: bare letter, punctuation, option-text mapping
assert g.grade_mcq("B", "B")
assert g.grade_mcq("b)", "B")
assert g.grade_mcq("(c)", "C")
assert g.grade_mcq("D.", "D")
assert g.grade_mcq("plate tectonics", "B", ["the Coriolis effect", "plate tectonics", "hotspots"])
assert not g.grade_mcq("Q", "B")
assert not g.grade_mcq("", "B")

# True/False normalization
assert g.grade_tf("True", "true")
assert g.grade_tf("FALSE", "False")
assert g.grade_tf("yes", "true")
assert g.grade_tf("no", "false")
assert not g.grade_tf("maybe", "true")
assert not g.grade_tf("", "false")

# Fill normalization: case/articles/whitespace tolerant, meaning-sensitive
assert g.grade_fill("The Asthenosphere", "asthenosphere")
assert g.grade_fill("  tectonism, earthquake, magmatism ", "Tectonism, earthquake, magmatism")
assert not g.grade_fill("crust", "asthenosphere")

# Structured values: numeric tolerance + comma formats + case-insensitive text
assert g.grade_value("1234", "1,234")
assert g.grade_value("3.14159", "3.1416")
assert g.grade_value("Plan Check", "plan check")
assert not g.grade_value(1, 2)
assert not g.grade_value("anything", "")

# Batch grading with disjoint dev/private-only splits and unanswered handling
q = [
    {"qid": "a", "kind": "mcq"},
    {"qid": "b", "kind": "tf"},
    {"qid": "c", "kind": "fill"},
]
ans = {
    "a": {"answer": "B", "dev": True},
    "b": {"answer": "true", "dev": False},
    "c": {"answer": "asthenosphere", "dev": False},
}
sp, dp = g.grade_quiz({"a": "B", "b": "wrong", "c": "x"}, q, ans, "public")
assert sp == 1.0 and dp["total"] == 1 and dp["metric"] == "public-dev-v1"
# Changing dev answers cannot affect the private-only metric.
sq1, dq1 = g.grade_quiz({"a": "B", "b": "true"}, q, ans, "private")
sq2, dq2 = g.grade_quiz({"a": "wrong", "b": "true"}, q, ans, "private")
assert sq1 == sq2 == 0.5 and dq1["total"] == dq2["total"] == 2
assert dq1["metric"] == "private-only-v2"  # c is unanswered and remains wrong
# Changing private-only answers cannot affect the public calibration metric.
sp2, _ = g.grade_quiz({"a": "B", "b": "true", "c": "asthenosphere"}, q, ans, "public")
assert sp2 == sp

print("GRADER_OK")
