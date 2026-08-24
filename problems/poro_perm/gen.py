"""Generate poro_perm data: log10 k = a + b*phi + noise.

Reference (public truth):  a=-2.0, b=8.0, sigma=0.12, n=90
Main (private truth):      a=-3.0, b=9.5, sigma=0.15, n=120
"""
import numpy as np, os, sys

rng = np.random.default_rng(4242)
here = os.path.dirname(os.path.abspath(__file__))
data_dir = os.path.join(here, "data")
os.makedirs(data_dir, exist_ok=True)

def core(a, b, sigma, n):
    phi = rng.uniform(0.05, 0.35, n)
    logk = a + b * phi + rng.normal(0, sigma, n)
    k = 10 ** logk
    order = np.argsort(phi)
    return phi[order], k[order]

def save(path, phi, k):
    lines = ["porosity_frac,perm_mD"]
    for p, x in zip(phi, k):
        lines.append(f"{p:.4f},{x:.4f}")
    open(path, "w").write("\n".join(lines))

rphi, rk = core(-2.0, 8.0, 0.12, 90)
save(os.path.join(data_dir, "reference_core.csv"), rphi, rk)
mph, mk = core(-3.0, 9.5, 0.15, 120)
save(os.path.join(data_dir, "core.csv"), mph, mk)

truth = -3.0 + 9.5 * 0.25
print(f"reference truth at phi=0.25: 0.0000 (public)")
print(f"main     truth at phi=0.25: {truth:.4f} (private)")
if "--private" in sys.argv:
    out = sys.argv[sys.argv.index("--private") + 1]
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "poro_perm.txt"), "w").write(f"{truth:.4f}\n")
    print("private truth written")
