"""Inner agent: iteratively writes and executes python until it submits an answer."""

import json
import os

from .evaluator import score
from .executor import run_python
from .llm import chat, extract_json

FENCE = chr(96) * 3


def extract_code(content):
    """Return python code blocks from a markdown reply."""
    blocks = []
    inside = False
    buf = []
    for line in content.split("\n"):
        s = line.strip()
        if not inside and s.startswith(FENCE):
            inside = True
            buf = []
            continue
        if inside and s == FENCE:
            blocks.append("\n".join(buf))
            inside = False
            continue
        if inside:
            buf.append(line)
    return blocks


def build_messages(scaffold, statement):
    sys_prompt = scaffold.get("system_prompt", "")
    tips = scaffold.get("tips", [])
    if tips:
        sys_prompt += "\n\nStrategy notes:\n" + "\n".join("- " + str(t) for t in tips)
    return [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": statement},
    ]


def solve(client, model, scaffold, statement, ws, eval_script,
          solution_file="solution.json", max_turns=10, log=print):
    """Run one inner episode. Returns (fitness | None, error | None)."""
    sol_path = os.path.join(ws, solution_file)
    os.makedirs(os.path.dirname(sol_path), exist_ok=True)

    messages = build_messages(scaffold, statement)

    for turn in range(max_turns):
        log(f"    turn {turn + 1}/{max_turns}")
        reply = chat(client, model, messages)
        content = reply["content"]
        messages.append({"role": "assistant", "content": content})

        if os.path.exists(sol_path):
            break

        blocks = extract_code(content)
        if blocks:
            res = run_python(blocks[-1], timeout_s=120, cwd=ws)
            obs = "stdout:\n" + res["stdout"][:2500]
            if res["stderr"]:
                obs += "\nstderr:\n" + res["stderr"][:1000]
            if res["timed_out"]:
                obs += "\n[execution timed out]"
            messages.append({"role": "user", "content": (
                "Execution result:\n" + obs +
                "\n\nContinue investigating, or finish by writing your final answer "
                "file exactly as the task instructs."
            )})
        else:
            data = extract_json(content)
            if data is not None and "b" in data:
                with open(sol_path, "w", encoding="utf-8") as fh:
                    json.dump(data, fh)
                break
            messages.append({"role": "user", "content": (
                "[system] Your reply contained no executable code block. Reply again with "
                "ONE fenced python block that makes progress, or give your final JSON answer."
            )})

    if not os.path.exists(sol_path):
        return None, "no solution file after max turns"
    return score(eval_script, sol_path)