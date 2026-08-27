"""Model probe suite (direct gateway calls, no harness).

Modes (--mode):
  stab    : tiny completions x4 -> success rate, latency mean/p95, error kinds,
            plus json-discipline and one verifiable reasoning question
            (budgets are generous: reasoning models eat max_tokens thinking)
  vision  : Pillow-rendered scene (shapes/colors/text) scored on 4 details
  levels  : extended reasoning levels minimal..max x param styles, acceptance
            + latency on a real question (answer must be 5)
  all     : everything (default)

Usage: python scripts/model_probe.py [--mode stab|vision|levels|all]
Results feed config/model-profiles.json (see docs/MODELS.md).
"""
import base64
import json
import os
import struct
import time
import urllib.error
import urllib.request
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZEN = "https://opencode.ai/zen/go/v1"
LOCAL = "http://172.27.116.56:8080/v1"
OPENROUTER = "https://openrouter.ai/api/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

KEY = open(os.path.join(ROOT, "api_key.txt"), encoding="utf-8").read().strip()
LKEY = open(os.path.join(ROOT, "api_key_local.txt"), encoding="utf-8").read().strip()
OKEY = open(os.path.join(ROOT, "api_key_or.txt"), encoding="utf-8").read().strip()

def render_scene_b64():
    img = Image.new("RGB", (320, 240), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 120, 120], fill=(200, 30, 30))          # red square
    d.ellipse([180, 40, 300, 160], fill=(30, 140, 60))           # green circle
    d.polygon([(60, 220), (110, 140), (160, 220)], fill=(40, 60, 200))  # blue triangle
    d.text((210, 200), "GEO-2026", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def vision_probe():
    b64 = render_scene_b64()
    q = ("Look at this image carefully. Answer in one line, exactly this format:\n"
         "squares=<n> circles=<n> triangles=<n> square_color=<word> circle_color=<word> text=<exact text>")
    truth = {"squares=1": False, "circles=1": False, "triangles=1": False}
    print("== VISION (rendered scene: red square, green circle, blue triangle, text GEO-2026) ==")
    for name, base, key in MODELS:
        ok, dt, c, fr, err = call(base, name, key, [{"role": "user", "content": [
            {"type": "text", "text": q},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}]}],
            max_tokens=2500, timeout=120)
        low = c.lower() if ok else ""
        score = sum(1 for k in ("square_color=red", "circle_color=green", "triangles=1", "geo-2026") if k in low)
        print(f"{name:<16} {'OK ' if ok else 'ERR'} {dt:5.1f}s detail={score}/4 | {(c or err)[:130]!r}", flush=True)


MODELS = [
    ("hy3", ZEN, KEY),
    ("mimo-v2.5", ZEN, KEY),
    ("dsv4f", LOCAL, LKEY),
    ("muse-spark-1.2-contributor", ZEN, KEY),  # proxy-routed; Responses API upstream
    ("z-ai/glm-5.3-flash", OPENROUTER, OKEY),
    ("minimax/minimax-m3:free", OPENROUTER, OKEY),
]


def red_png_b64():
    """Minimal valid 8x8 red PNG, no PIL."""
    w = h = 8
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    return base64.b64encode(png).decode()


def call(base, model, key, messages, max_tokens=64, timeout=75, extra=None):
    body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0}
    if extra:
        body.update(extra)
    req = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}", "User-Agent": UA},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = json.loads(r.read().decode())
        dt = time.time() - t0
        content = (out["choices"][0]["message"].get("content") or "").strip()
        fr = out["choices"][0].get("finish_reason")
        return True, dt, content, fr
    except urllib.error.HTTPError as e:
        return False, time.time() - t0, f"HTTP {e.code}: {e.read()[:120].decode(errors='replace')}", None
    except Exception as e:
        return False, time.time() - t0, f"{type(e).__name__}: {str(e)[:100]}", None


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * 0.95))] if xs else 0


def probe(model, base, key):
    r = {"model": model}

    # --- stability -------------------------------------------------------
    oks, lats, errs = [], [], {}
    for _ in range(4):
        ok, dt, content, fr = call(base, model, key, [{"role": "user", "content": "Reply with exactly: ok"}], max_tokens=8, timeout=45)
        (oks if ok else errs).append(1) if ok else errs.__setitem__(str(content)[:60], errs.get(str(content)[:60], 0) + 1)
        if ok:
            lats.append(dt)
            if fr == "network_error" or not content:
                errs.setdefault(f"bad finish ({fr}, empty={not content})", 0)
                errs[f"bad finish ({fr}, empty={not content})"] += 1
    r["stab_ok"] = f"{len(oks)}/4"
    r["lat_ms"] = f"{int(sum(lats)/len(lats)*1000)}/{int(p95(lats)*1000)}" if lats else "-"
    r["errors"] = errs or {}

    # --- json discipline -------------------------------------------------
    jp = ('Grade this answer.\nTASK: distance travelled at 8 km/s for 240 km\nANSWER: 30\n'
          'Reply with EXACTLY one JSON object and nothing else:\n{"score": <float 0..1>, "reason": "<one line>"}')
    jok = 0
    for _ in range(2):
        ok, dt, content, fr = call(base, model, key, [{"role": "user", "content": jp}], max_tokens=120, timeout=60)
        if ok:
            try:
                v = json.loads(content.strip().removeprefix("```json").removesuffix("```").strip())
                if isinstance(v.get("score"), (int, float)) and isinstance(v.get("reason"), str):
                    jok += 1
            except Exception:
                pass
    r["json_ok"] = f"{jok}/2"

    # --- reasoning --------------------------------------------------------
    ok, dt, content, fr = call(
        base, model, key,
        [{"role": "user", "content": "A seismic wave travels 8 km/s through rock. How many seconds to cross 240 km? Reply with just the number."}],
        max_tokens=2000, timeout=120,
    )
    num = None
    if ok:
        import re
        m = re.findall(r"-?\d+(?:\.\d+)?", content.replace(",", ""))
        num = float(m[-1]) if m else None
    r["reason"] = ("OK" if ok and num is not None and abs(num - 30) < 0.51 else f"WRONG({content[:40]})") if ok else "ERR"

    # --- vision -----------------------------------------------------------
    ok, dt, content, fr = call(
        base, model, key,
        [{"role": "user", "content": [
            {"type": "text", "text": "What color is the square in this image? One word."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{red_png_b64()}"}},
        ]}],
        max_tokens=20, timeout=60,
    )
    r["vision_raw_api"] = (f"{'RED' if 'red' in content.lower() else content[:24]}" if ok else f"NO ({str(content)[:48]})")

    return r



def levels_probe():
    """Extended reasoning levels x param styles on a verifiable question."""
    import re

    MATH = ("A population grows 15% per year. After how many whole years does it first exceed "
            "double its initial size? Compute exactly, then reply with just the integer.")
    LEVELS = ["minimal", "off", "none", "low", "medium", "high", "xhigh", "max"]
    print("answer must be 5 | Y(ans,lat) accepted / N rejected", flush=True)
    for name, base, key in MODELS:
        for style, mk in (("effort", lambda lv: {"reasoning_effort": lv}),
                          ("obj", lambda lv: {"reasoning": {"effort": lv}})):
            cells = []
            for lv in LEVELS:
                ok, dt, c, _fr = call(base, name, key, [{"role": "user", "content": MATH}],
                                      max_tokens=6000, timeout=180, extra=mk(lv))
                if ok:
                    ans = (re.findall(r"-?\d+", c.replace(",", "")) or ["?"])[-1]
                    cells.append(f"{lv}:Y({ans},{dt:.0f}s)")
                else:
                    cells.append(f"{lv}:N")
            print(f"{name:<16}[{style}] " + " ".join(cells), flush=True)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["all", "stab", "vision", "levels"], default="all")
    a = ap.parse_args()
    rows = []
    if a.mode in ("all", "stab"):
        for name, base, key in MODELS:
            print(f"probing {name} ...", flush=True)
            try:
                rows.append(probe(name, base, key))
            except Exception as e:  # noqa: BLE001
                rows.append({"model": name, "stab_ok": "CRASH", "errors": {str(e)[:80]: 1}})
            print(json.dumps(rows[-1], ensure_ascii=False), flush=True)
        print()
        print("=== MATRIX ===")
        print(f"{'model':<28} {'stab':<6} {'lat(ms) mean/p95':<18} {'json':<6} {'reason':<14} vision_raw")
        for x in rows:
            print(f"{x['model']:<28} {x.get('stab_ok','-'):<6} {x.get('lat_ms','-'):<18} "
                  f"{x.get('json_ok','-'):<6} {x.get('reason','-'):<14} {x.get('vision_raw_api','-')}")
            if x.get("errors"):
                print(f"   errors: {list(x['errors'].items())[:3]}")
    if a.mode in ("all", "vision"):
        vision_probe()
    if a.mode in ("all", "levels"):
        levels_probe()
