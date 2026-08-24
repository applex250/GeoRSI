"""Execute Python code blocks in a subprocess with timeout."""
import subprocess, sys, tempfile, os

def run_python(code: str, timeout_s: float = 120, cwd: str = None) -> dict:
    """Run code in a fresh python process. Returns {stdout, returncode, timed_out}."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False,
                                      encoding="utf-8") as f:
        f.write(code)
        path = f.name
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        proc = subprocess.run(
            [sys.executable, path],
            capture_output=True,
            encoding="utf-8", errors="replace",
            timeout=timeout_s, cwd=cwd, env=env,
        )
        return {
            "stdout": proc.stdout[-8000:],
            "stderr": proc.stderr[-4000:],
            "returncode": proc.returncode,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "timed out", "returncode": -1, "timed_out": True}
    finally:
        os.unlink(path)
