#!/bin/bash
cd /f/rsi-lab
export RSILAB_JUDGE_CACHE=F:/rsi-lab/problems/_shared/judge_cache_lane_sc_B-unscoped.jsonl
export RSILAB_KB_PATH=F:/rsi-lab/knowledge/nodes-lane-sc-B-unscoped.jsonl
if [ -e runs/scope-rerun-B-unscoped ] || [ -e runs/scope-rerun-B-unscoped.log ]; then exit 2; fi
npx tsx src/run.ts rsi --config config/scope-B-unscoped.json --scaffold scaffolds/scope-B-unscoped.json --run-name scope-rerun-B-unscoped > runs/scope-rerun-B-unscoped.log 2>&1 || exit $?
echo SCOPE_B-unscoped_DONE
