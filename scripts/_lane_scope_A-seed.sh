#!/bin/bash
cd /f/rsi-lab
export RSILAB_JUDGE_CACHE=F:/rsi-lab/problems/_shared/judge_cache_lane_sc_A-seed.jsonl
export RSILAB_KB_PATH=F:/rsi-lab/knowledge/nodes-lane-sc-A-seed.jsonl
npx tsx src/run.ts exam --config config/scope-A-seed.json --scaffold scaffolds/scope-A-seed.json --name scope-A-seed --run-name scope-A-seed > runs/scope-A-seed.log 2>&1
echo SCOPE_A-seed_DONE
