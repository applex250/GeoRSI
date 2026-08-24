"""Score solutions against private truth."""
import subprocess, sys, os, json

def score(script_path: str, submission_path: str, split: str = "private",
          timeout_s: float = 60) -> tuple:
    """Returns (fitness_float | None, error_str | None)."""
    cmd = [sys.executable, script_path, "--submission", submission_path, "--split", split]
    try:
        r = subprocess.run(cmd, capture_output=True,
                           encoding="utf-8", errors="replace", timeout=timeout_s)
    except subprocess.TimeoutExpired:
        return None, "eval timeout"
    except OSError as e:
        return None, str(e)
    if r.returncode != 0:
        return None, f"eval exit {r.returncode}: {(r.stderr or '')[:200]}"
    for line in (r.stdout or "").splitlines():
        if line.startswith("##SCORE##"):
            try: return float(line.split("##SCORE##")[1]), None
            except ValueError: pass
    return None, "no ##SCORE## marker in output"
