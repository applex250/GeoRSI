#!/bin/bash
cd /f/rsi-lab
export RSILAB_JUDGE_CACHE=F:/rsi-lab/problems/_shared/judge_cache_lane_sc_B-unscoped.jsonl
export RSILAB_KB_PATH=F:/rsi-lab/knowledge/nodes-lane-sc-B-unscoped.jsonl
npx tsx src/run.ts exam --config config/scope-B-unscoped.json --scaffold scaffolds/scope-B-unscoped.json --name scope-B-unscoped --run-name scope-B-unscoped > runs/scope-B-unscoped.log 2>&1
echo SCOPE_B-unscoped_DONE
