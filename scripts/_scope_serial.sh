#!/bin/bash
# serial three-arm scoping experiment (per-arm artifact isolation + KB isolation)
cd /f/rsi-lab
for tag in A-seed B-unscoped C-scoped; do
  LANE_KB="knowledge/nodes-lane-sc-${tag}.jsonl"
  LANE_JUDGE="F:/rsi-lab/problems/_shared/judge_cache_scope_${tag}.jsonl"
  if [ -e "$LANE_KB" ]; then
    echo "refusing to overwrite existing lane KB ${LANE_KB}" >&2
    exit 2
  fi
  cp knowledge/nodes.jsonl "$LANE_KB"
  export RSILAB_KB_PATH="F:/rsi-lab/${LANE_KB}"
  export RSILAB_JUDGE_CACHE="$LANE_JUDGE"
  RUN_NAME="scope-rerun-${tag}"
  if [ -e "runs/${RUN_NAME}" ] || [ -e "runs/${RUN_NAME}.log" ]; then
    echo "refusing to overwrite existing ${RUN_NAME} artifacts" >&2
    exit 2
  fi
  echo "=== scope-${tag} start ==="
  npx tsx src/run.ts rsi --config "config/scope-${tag}.json" --scaffold "scaffolds/scope-${tag}.json" --run-name "${RUN_NAME}" > "runs/${RUN_NAME}.log" 2>&1 || exit $?
  python scripts/kb_merge.py "${LANE_KB}" >> "runs/${RUN_NAME}.log" 2>&1 || exit $?
  rm -f "${LANE_KB}"
done
echo SCOPE_SERIAL_DONE
