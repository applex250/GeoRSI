# Experience store

Cross-run memory of the research engine — the flywheel's raw material. Written by
`harvestRunExperience` after every sealed workspace run (and by
`npm run research:experience -- --run-dir <dir> | --all` for backfills).

| file | tracked | content |
|---|---|---|
| `records.jsonl` | no | one `ExperienceRecord` per sealed run (route, tools, verifier verdict, score, durable hashes) |
| `counter-examples.jsonl` | no | one record per failed node attempt, with a failure-class hypothesis/falsifier |
| `approvals.jsonl` | no | human decisions (`accept` / `modify` / `reject`) — the operator evidence source |
| `index.json` | no | signature → ids, counts by family/status, pending human reviews |
| `promoted.jsonl` | yes | curated records promoted by paired-repetition evidence (empty until the promotion stage lands) |

Records enter through three doors (`src/research/experience/gates.ts`): the family verifier
verdict, package replay, and — for high-risk cases — a human. Nothing here is routed into a
run yet: this stage stores and observes; routing by experience is the next stage.

`GEORSI_EXPERIENCE_ROOT` redirects the store (selftests use a temp dir).
