#!/bin/bash
cd /f/rsi-lab
export RSILAB_JUDGE_CACHE=F:/rsi-lab/problems/_shared/judge_cache_lane_sc_C-scoped.jsonl
export RSILAB_KB_PATH=F:/rsi-lab/knowledge/nodes-lane-sc-C-scoped.jsonl
npx tsx src/run.ts exam --config config/scope-C-scoped.json --scaffold scaffolds/scope-C-scoped.json --name scope-C-scoped --run-name scope-C-scoped > runs/scope-C-scoped.log 2>&1
echo SCOPE_C-scoped_DONE
