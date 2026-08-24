"""Generate flood_rp data: Gumbel annual maximum series.

Main series (private truth):  mu=100, beta=30 -> Q100 = 238.007 m3/s
Reference series (public):    mu=120, beta=25 -> Q100 = 235.004 m3/s
"""
import numpy as np, os

rng = np.random.default_rng(20260824)
here = os.path.dirname(os.path.abspath(__file__))
data_dir = os.path.join(here, "data")
os.makedirs(data_dir, exist_ok=True)

def gumbel(mu, beta, n):
    u = rng.random(n)
    return mu - beta * np.log(-np.log(u))

def save(path, v, start_year):
    lines = ["year,peak_m3s"]
    for i, x in enumerate(v):
        lines.append(f"{start_year + i},{x:.2f}")
    open(path, "w").write("\n".join(lines))

q99 = -np.log(-np.log(0.99))
main = gumbel(100.0, 30.0, 70)
save(os.path.join(data_dir, "peaks.csv"), main, 1950)
ref = gumbel(120.0, 25.0, 50)
save(os.path.join(data_dir, "reference_peaks.csv"), ref, 1950)

print(f"reference Q100 truth: {120 + 25*q99:.4f} (public)")
print(f"main     Q100 truth: {100 + 30*q99:.4f} (private)")
print("write private truth with: python gen.py --private <dir>")
if "--private" in os.sys.argv:
    out = os.sys.argv[os.sys.argv.index("--private") + 1]
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "flood_rp.txt"), "w").write(f"{100 + 30*q99:.4f}\n")
    print("private truth written")
