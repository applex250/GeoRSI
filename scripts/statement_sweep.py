"""Sweep the batch-answering protocol into every quiz chunk's statement.md.

Run ONLY when no evolution/exam run is active (statements are read at episode
start; a mid-run sweep would change protocol between episodes of one run).

Idempotent: chunks already carrying the batch-discipline block are skipped.
"""
import glob
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BATCH_BLOCK = """
Batch discipline (recommended): work in batches of 15-20 questions — answer a
batch, merge it into answers.json, then continue. Do not try to solve the whole
sheet in one pass. Once ~90% of questions are answered, submit: partial
submissions score partially and unanswered questions count as wrong.
"""

MARKER = "Batch discipline (recommended)"

def main():
    patched = skipped = 0
    for p in glob.glob(os.path.join(ROOT, "problems", "*_c[0-9][0-9][0-9]", "statement.md")):
        s = open(p, encoding="utf-8").read()
        if MARKER in s:
            skipped += 1
            continue
        # insert right after the submit-tool instruction line (before ## Grading)
        anchor = "## Grading"
        if anchor not in s:
            print("no anchor:", p)
            continue
        s = s.replace(anchor, BATCH_BLOCK.strip() + "\n\n" + anchor, 1)
        open(p, "w", encoding="utf-8", newline="").write(s)
        patched += 1
    print(f"patched {patched}, already-patched {skipped}")


if __name__ == "__main__":
    main()
