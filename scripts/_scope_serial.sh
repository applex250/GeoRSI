#!/bin/bash
# serial three-arm scoping experiment (per-arm dir cleanup + KB isolation)
cd /f/rsi-lab
export RSILAB_JUDGE_CACHE=F:/rsi-lab/problems/_shared/judge_cache_scope.jsonl
for tag in A-seed B-unscoped C-scoped; do
  LANE_KB="knowledge/nodes-lane-sc-${tag}.jsonl"
  cp knowledge/nodes.jsonl "$LANE_KB"
  export RSILAB_KB_PATH="F:/rsi-lab/${LANE_KB}"
  rm -rf "runs/scope-${tag}"
  echo "=== scope-${tag} start ==="
  npx tsx src/run.ts exam --config "config/scope-${tag}.json" --scaffold "scaffolds/scope-${tag}.json" --name "scope-${tag}" --run-name "scope-${tag}" > "runs/scope-${tag}.log" 2>&1
  python scripts/kb_merge.py "${LANE_KB}" >> "runs/scope-${tag}.log" 2>&1
  rm -f "${LANE_KB}"
done
echo SCOPE_SERIAL_DONE
