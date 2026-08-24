"""Outer loop primitives: propose scaffold edits, apply them."""

import copy
import json

from .llm import chat, extract_json

ANGLES = ["improve", "crossover", "robustness", "decompose", "validate"]

EDIT_MENU = (
    '- {"op": "add_tip", "text": "..."}' + "\n"
    + '- {"op": "delete_tip", "index": N}' + "\n"
    + '- {"op": "replace_tip", "index": N, "text": "..."}' + "\n"
    + '- {"op": "prompt_append", "text": "..."}'
)


def propose(client, model, scaffold, angle, feedback="", history="", max_tokens=4096):
    """Ask the outer model for one improvement proposal. Returns dict | None."""
    prompt = (
        "You are improving the strategy of a scientific research agent.\n"
        "CURRENT SCAFFOLD:\n" + json.dumps(scaffold, indent=2) + "\n"
        + ("\nRECENT RESULTS:\n" + history + "\n" if history else "")
        + ("\nFEEDBACK:\n" + feedback + "\n" if feedback else "")
        + "\nIMPROVEMENT ANGLE: " + angle + "\n\n"
        + "Propose 1-3 concrete edits from this menu:\n" + EDIT_MENU + "\n\n"
        + "Return EXACTLY ONE JSON object:\n"
        + '{"edits": [...], "mechanism": "...", '
        + '"expected_delta": "+0.05", "falsification": "..."}' + "\n\n"
        + "mechanism: why these edits should raise fitness. falsification: what result "
        + "would disprove it. Keep each tip text under 30 words."
    )
    reply = chat(client, model, [
        {"role": "system", "content": "You output exactly one JSON object and nothing else."},
        {"role": "user", "content": prompt},
    ], max_tokens=max_tokens)
    data = extract_json(reply["content"])
    if not isinstance(data, dict):
        print(f"    [propose] unparsable reply head: {reply['content'][:160]!r}")
        return None
    edits = data.get("edits")
    if not isinstance(edits, list) or not edits or not data.get("mechanism"):
        return None
    return {
        "edits": edits,
        "mechanism": str(data["mechanism"]),
        "expected_delta": str(data.get("expected_delta", "?")),
        "angle": angle,
    }


def apply_edits(scaffold, edits, lr=3):
    """Apply up to lr edits to a deep copy of the scaffold dict."""
    s = copy.deepcopy(scaffold)
    tips = list(s.get("tips", []))
    for e in edits[:lr]:
        op = e.get("op")
        if op == "add_tip":
            tips.append(str(e.get("text", ""))[:400])
        elif op == "delete_tip":
            i = int(e.get("index", -1))
            if 0 <= i < len(tips):
                tips.pop(i)
        elif op == "replace_tip":
            i = int(e.get("index", -1))
            if 0 <= i < len(tips):
                tips[i] = str(e.get("text", ""))[:400]
        elif op == "prompt_append":
            s["system_prompt"] = s.get("system_prompt", "") + "\n" + str(e.get("text", ""))[:600]
    s["tips"] = tips
    return s