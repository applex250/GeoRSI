"""Fetch real Southern California earthquake catalogs from USGS ComCat (FDSN API)
in half-year chunks (the API caps single queries at 20k events), then convert
to the GeoRSI catalog format (event_id,magnitude).

Main period:      2010-01-01 .. 2024-12-31  (the problem dataset)
Reference period: 1990-01-01 .. 2009-12-31  (public-reference dataset)

Region: 32.5–36.0 N, -121.0 – -114.5 E (Southern California)
Magnitudes: M >= 2.0 (local magnitude ml from the SCSN `ci` network).

Usage: python fetch.py [--private <dir>]   (downloads into ./data, ~1-2 min)
"""
import csv
import io
import json
import math
import os
import time
import urllib.request

BASE = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv"
        "&minlatitude=32.5&maxlatitude=36.0&minlongitude=-121.0&maxlongitude=-114.5"
        "&minmagnitude=2.0")

PERIODS = {
    "catalog.csv": ("2010-01-01", "2024-12-31"),        # main (private truth)
    "reference_catalog.csv": ("1990-01-01", "2009-12-31"),  # reference (public)
}

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


def half_years(start, end):
    (y0, y1) = int(start[:4]), int(end[:4])
    out = []
    for y in range(y0, y1 + 1):
        out.append((f"{y}-01-01", f"{y}-06-30"))
        out.append((f"{y}-07-01", f"{y}-12-31"))
    return [(s, e) for (s, e) in out if s <= end and e >= start]


def fetch(url, retries=5):
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            if i == retries - 1:
                raise
            wait = 5 * (i + 1)
            print(f"  retry {i+1}: {e}; wait {wait}s")
            time.sleep(wait)


def fetch_period(start, end):
    rows = []
    seen = set()
    for (s, e) in half_years(start, end):
        url = f"{BASE}&starttime={s}&endtime={e}"
        txt = fetch(url)
        rd = list(csv.DictReader(io.StringIO(txt)))
        kept = [r for r in rd if r.get("mag") and r.get("type") == "earthquake"]
        for r in kept:
            eid = r.get("id") or f"{r['time']}"
            if eid in seen:
                continue
            seen.add(eid)
            rows.append((eid, float(r["mag"])))
        print(f"  {s[:4]}H{'1' if s[5:7] == '01' else '2'}: +{len(kept)} (total {len(rows)})")
        time.sleep(0.4)
    return rows


def aki_b(mags, mc, d=0.1):
    """Canonical estimator: Aki (1965) MLE with binned magnitudes."""
    sel = [m for m in mags if m >= mc - 1e-9]
    if len(sel) < 30:
        return None
    mean = sum(sel) / len(sel)
    return math.log10(math.e) / (mean - (mc - d / 2.0))  # binned-Mc correction


def max_curvature_mc(mags, dmin=2.0):
    """Mc via maximum curvature of the FMD (standard practice, Wiemer & Wyss 2002)."""
    bins = {}
    m0 = int(dmin * 10)
    for m in mags:
        k = int(round(m * 10))
        bins[k] = bins.get(k, 0) + 1
    best, best_k = -1.0, None
    for k in sorted(bins)[:-1]:
        curv = float(bins.get(k + 1, 0)) - float(bins.get(k, 0))
        if k / 10.0 >= dmin and curv > best:
            best, best_k = curv, k
    return (best_k / 10.0) if best_k else dmin


def main():
    os.makedirs(DATA, exist_ok=True)
    truths = {}
    for fname, (start, end) in PERIODS.items():
        print(f"fetching {fname}: {start} .. {end}")
        rows = fetch_period(start, end)
        rows.sort(key=lambda r: r[1])
        with open(os.path.join(DATA, fname), "w", newline="\n") as fh:
            fh.write("event_id,magnitude\n")
            for i, (eid, m) in enumerate(rows):
                fh.write(f"{eid},{m:.2f}\n")
        mags = [m for _, m in rows]
        mc = max_curvature_mc(mags)
        b = aki_b(mags, mc)
        truths[fname] = {"n": len(rows), "Mc_maxcurv": mc, "b_Aki": round(b, 4) if b else None,
                         "min": min(mags), "max": max(mags)}
        print(f"  -> n={len(rows)} Mc={mc} b={b:.4f}")
    print(json.dumps(truths, indent=1))
    if "--private" in os.sys.argv:
        out = os.sys.argv[os.sys.argv.index("--private") + 1]
        os.makedirs(out, exist_ok=True)
        b = truths["catalog.csv"]["b_Aki"]
        open(os.path.join(out, "quake_b_real.txt"), "w").write(f"{b:.4f}\n")
        print(f"private truth written: b={b:.4f}")


if __name__ == "__main__":
    main()
