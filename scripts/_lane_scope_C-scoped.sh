#!/bin/bash
cd /f/rsi-lab
export RSILAB_JUDGE_CACHE=F:/rsi-lab/problems/_shared/judge_cache_lane_sc_C-scoped.jsonl
export RSILAB_KB_PATH=F:/rsi-lab/knowledge/nodes-lane-sc-C-scoped.jsonl
if [ -e runs/scope-rerun-C-scoped ] || [ -e runs/scope-rerun-C-scoped.log ]; then exit 2; fi
npx tsx src/run.ts rsi --config config/scope-C-scoped.json --scaffold scaffolds/scope-C-scoped.json --run-name scope-rerun-C-scoped > runs/scope-rerun-C-scoped.log 2>&1 || exit $?
echo SCOPE_C-scoped_DONE
