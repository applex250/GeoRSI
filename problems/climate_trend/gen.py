"""Generate climate_trend data: linear trend + AR(1) noise.

Reference (public truth):  slope 0.020 C/yr, phi=0.6, sigma=0.12, n=100
Main (private truth):      slope 0.017 C/yr, phi=0.6, sigma=0.13, n=120
"""
import numpy as np, os, sys

rng = np.random.default_rng(777)
here = os.path.dirname(os.path.abspath(__file__))
data_dir = os.path.join(here, "data")
os.makedirs(data_dir, exist_ok=True)

def series(slope, phi, sigma, n):
    t = np.arange(n, dtype=float)
    e = np.zeros(n)
    for i in range(1, n):
        e[i] = phi * e[i - 1] + rng.normal(0, sigma)
    return slope * t + e

def save(path, v):
    lines = ["year,anomaly_C"]
    for i, x in enumerate(v):
        lines.append(f"{1900 + i},{x:.4f}")
    open(path, "w").write("\n".join(lines))

ref = series(0.020, 0.6, 0.12, 100)
save(os.path.join(data_dir, "reference_anomaly.csv"), ref)
main = series(0.017, 0.6, 0.13, 120)
save(os.path.join(data_dir, "anomaly.csv"), main)

# naive OLS on the main series (what the agent roughly recovers)
t = np.arange(120, dtype=float)
print(f"reference truth slope: 0.020 (public)")
print(f"main     truth slope: 0.017 (private); naive OLS gives {np.polyfit(t, main, 1)[0]:.5f}")
if "--private" in sys.argv:
    out = sys.argv[sys.argv.index("--private") + 1]
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "climate_trend.txt"), "w").write("0.017\n")
    print("private truth written")
