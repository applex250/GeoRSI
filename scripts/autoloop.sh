#!/bin/bash
# AutoLoop: automated test-feedback-optimize cycle for GeoRSI evolution.
#   RUN (rsi, lane-isolated) -> VERDICT (run_verdict.py) -> branch:
#     CHAMPION        -> merge KB, stop success
#     CLEAN_NEGATIVE  -> merge KB, stop (honest negative, no token burn)
#     CRASHY/premature-> merge KB, retry next iteration (fix already in code)
#     ESCALATE/BROKEN -> merge KB, stop for manual layer
# G5 guard between iterations: selftest must stay green.
set -u
cd /f/rsi-lab
CFG="${1:-config/k2evo-stealth.json}"
MAX_ITER="${2:-2}"
TAG="${3:-autoloop}"
mkdir -p "runs/${TAG}"
SUMMARY="runs/${TAG}/SUMMARY.md"
echo "# AutoLoop ${TAG} ($(date))" > "$SUMMARY"
echo "- config: ${CFG}, max_iter: ${MAX_ITER}" >> "$SUMMARY"

for i in $(seq 1 "$MAX_ITER"); do
  RUN="${TAG}-iter${i}"
  LANE_KB="knowledge/nodes-lane-${RUN}.jsonl"
  cp knowledge/nodes.jsonl "$LANE_KB"
  echo "" >> "$SUMMARY"
  echo "## iteration ${i}: ${RUN}" >> "$SUMMARY"

  echo "[autoloop] iter ${i}: running ${RUN} ..." | tee -a "$SUMMARY"
  RSILAB_JUDGE_CACHE="F:/rsi-lab/problems/_shared/judge_cache_${RUN}.jsonl" \
  RSILAB_KB_PATH="F:/rsi-lab/${LANE_KB}" \
    npx tsx src/run.ts rsi --config "$CFG" --run-name "$RUN" > "runs/${RUN}.log" 2>&1

  python scripts/run_verdict.py "$RUN" > "runs/${TAG}/verdict-iter${i}.json"
  VERDICT=$(python -c "import json;print(json.load(open('runs/${TAG}/verdict-iter${i}.json',encoding='utf-8'))['verdict'])")
  ACTION=$(python -c "import json;print(json.load(open('runs/${TAG}/verdict-iter${i}.json',encoding='utf-8'))['next_action'])")
  echo "- verdict: ${VERDICT} / next: ${ACTION}" | tee -a "$SUMMARY"
  python scripts/kb_merge.py "$LANE_KB" >> "$SUMMARY" 2>&1
  rm -f "$LANE_KB"

  if [ "$ACTION" = "STOP_SUCCESS" ] || [ "$ACTION" = "STOP_NEGATIVE" ]; then
    echo "[autoloop] ${ACTION} at iter ${i}" | tee -a "$SUMMARY"
    echo "AUTOLOOP_DONE" && exit 0
  fi
  if [ "$ACTION" = "ESCALATE" ]; then
    echo "[autoloop] ESCALATE at iter ${i} - manual layer needed" | tee -a "$SUMMARY"
    echo "AUTOLOOP_DONE" && exit 1
  fi
  # RETRY: G5 guard before next iteration
  if ! npm run selftest > /dev/null 2>&1; then
    echo "[autoloop] selftest RED after iter ${i} - abort" | tee -a "$SUMMARY"
    echo "AUTOLOOP_DONE" && exit 1
  fi
done
echo "[autoloop] max iterations reached" | tee -a "$SUMMARY"
echo "AUTOLOOP_DONE"
