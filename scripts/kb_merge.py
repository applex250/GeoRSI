"""Merge a lane KB file's stat deltas back into the main knowledge store.
Usage: python scripts/kb_merge.py knowledge/nodes-lane-X.jsonl"""
import json
import sys

main_path = "knowledge/nodes.jsonl"
lane_path = sys.argv[1]

nodes = []
main = {}
for l in open(main_path, encoding="utf-8"):
    if l.strip():
        n = json.loads(l)
        main[n["id"]] = n["stats"]
        nodes.append(n)

merged = 0
for l in open(lane_path, encoding="utf-8"):
    if not l.strip():
        continue
    n = json.loads(l)
    if n["id"] not in main:
        nodes.append(n)  # node born in the lane (auto-promotion) - adopt it
        main[n["id"]] = {"uses": 0, "wins": 0, "fitness_sum": 0}
        merged += 1
        continue
    d = {k: n["stats"][k] - main[n["id"]][k] for k in ("uses", "wins", "fitness_sum")}
    if d["uses"]:
        for k in d:
            main[n["id"]][k] = round(main[n["id"]][k] + d[k], 4)
        merged += 1

out = []
for n in nodes:
    n["stats"] = main[n["id"]]
    out.append(json.dumps(n, ensure_ascii=False))
open(main_path, "w", encoding="utf-8", newline="").write("\n".join(out) + "\n")
print(f"merged {merged} node stat(s) from {lane_path}")
