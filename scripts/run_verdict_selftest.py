"""Deterministic tests for exact held-out verdict denominators."""
import json
import os
import sys
import tempfile

sys.path.insert(0, "scripts")
from run_verdict import compute_heldout, expected_heldout  # noqa: E402

manifest = {
    "config": {"episodes_per_problem": 2},
    "problems": [
        {"id": "train", "heldout": False, "weight": 1},
        {"id": "h1", "heldout": True, "weight": 1},
        {"id": "h2", "heldout": True, "weight": 3},
    ],
}
assert expected_heldout(manifest) == [("r1-h1", 1.0, "h1"), ("r1-h2", 3.0, "h2"), ("r2-h1", 1.0, "h1"), ("r2-h2", 3.0, "h2")]

with tempfile.TemporaryDirectory() as root:
    for name, score in [("r1-h1", 1.0), ("r1-h2", 0.5), ("r2-h1", 1.0)]:
        directory = os.path.join(root, "heldout", name)
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, "episode.json"), "w", encoding="utf-8") as handle:
            json.dump({"problemId": name.split("-", 1)[1], "fitness": score}, handle)
    mean, complete, missing = compute_heldout(root, manifest)
    # Missing r2-h2 retains its weight=3 in the denominator: (1 + 1.5 + 1 + 0) / 8.
    assert mean == 0.4375
    assert complete is False and missing == ["r2-h2"]

    directory = os.path.join(root, "heldout", "r2-h2")
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, "episode.json"), "w", encoding="utf-8") as handle:
        json.dump({"problemId": "h2", "fitness": 0.5}, handle)
    mean, complete, missing = compute_heldout(root, manifest)
    assert mean == 0.625 and complete is True and missing == []

print("RUN_VERDICT_OK")
