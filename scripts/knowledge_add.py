"""Knowledge-base curation CLI.

Add a lesson node:
  python scripts/knowledge_add.py --text "..." --tags quiz,fill [--scope regional]
                                  [--run rsi-k2-a] [--gen 4]

List nodes with stats:
  python scripts/knowledge_add.py --list

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
    a = ap.parse_args()

    nodes = load()
    if a.list:
        for n in nodes:
            avg = n["stats"]["fitness_sum"] / n["stats"]["uses"] if n["stats"]["uses"] else float("nan")
            print(f"{n['id']} [{n['status']}/{n['scope']}] tags={','.join(n['tags'])} "
                  f"uses={n['stats']['uses']} wins={n['stats']['wins']} avg_fit={avg:.3f}")
            print(f"   {n['text'][:100]}")
        print(f"\n{len(nodes)} nodes")
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
