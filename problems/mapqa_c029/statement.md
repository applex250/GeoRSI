# Quiz batch: mapqa (chunk 29 of 53)

## Task
1. Read `data/quiz.jsonl` — one JSON object per line: {"qid": ..., "kind": "mcq|tf|fill|value", "question": ..., "options": [...]}
2. Answer EVERY question yourself (reason carefully; no external data needed; entity reference data is provided in data/).
3. Write your answers to `answers.json` in the workspace root as one JSON object mapping qid to answer:
   - mcq: the letter, e.g. "B"
   - tf: "true" or "false"
   - fill: the missing text
   - value: the exact value requested by the question
   Write it with the write tool (you may build it up in parts across turns with the edit tool).
4. Call the submit tool with `answers_file: "answers.json"` (and final=true when done).

## Grading
public score = accuracy on a hidden calibration slice (a number, never the answers);
private score = accuracy on all questions. Partial answers score partially —
always submit, even if unsure on some questions.
