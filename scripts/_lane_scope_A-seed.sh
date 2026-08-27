#!/bin/bash
cd /f/rsi-lab
export RSILAB_JUDGE_CACHE=F:/rsi-lab/problems/_shared/judge_cache_lane_sc_A-seed.jsonl
export RSILAB_KB_PATH=F:/rsi-lab/knowledge/nodes-lane-sc-A-seed.jsonl
if [ -e runs/scope-rerun-A-seed ] || [ -e runs/scope-rerun-A-seed.log ]; then exit 2; fi
npx tsx src/run.ts rsi --config config/scope-A-seed.json --scaffold scaffolds/scope-A-seed.json --run-name scope-rerun-A-seed > runs/scope-rerun-A-seed.log 2>&1 || exit $?
echo SCOPE_A-seed_DONE
