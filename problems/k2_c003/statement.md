# Quiz batch: k2 (chunk 3 of 19)

## Task
1. Read `data/quiz.jsonl` — one JSON object per line: {"qid": ..., "kind": "mcq|tf|fill|value", "question": ..., "options": [...]}
2. Answer EVERY question yourself (reason carefully; no external data needed).
3. Write your answers to `answers.json` in the workspace root as one JSON object mapping qid to answer:
   - mcq: the letter, e.g. "B"
   - tf: "true" or "false"
   - fill: the missing text
   - value: the exact value requested by the question
   Write it with the write tool (you may build it up in parts across turns with the edit tool).
4. Call the submit tool with `answers_file: "answers.json"` (and final=true when done).

Batch discipline (recommended): work in batches of 15-20 questions — answer a
batch, merge it into answers.json, then continue. Do not try to solve the whole
sheet in one pass. Once ~90% of questions are answered, submit: partial
submissions score partially and unanswered questions count as wrong.

## Grading
public score = accuracy on a hidden calibration slice (a number, never the answers);
private score = accuracy on all questions. Partial answers score partially —
always submit, even if unsure on some questions.
