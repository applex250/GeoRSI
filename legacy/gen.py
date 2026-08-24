import numpy as np, os
rng = np.random.default_rng(42)
data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "problems", "quake_b", "data")
os.makedirs(data_dir, exist_ok=True)

def sample(b, mc, n):
    D = 3.0; u = rng.random(n)
    x = -(1.0/b) * np.log10(1.0 - u * (1.0 - 10**(-b*D)))
    return np.round(mc + x, 2)

def save(path, mags, prefix):
    lines = ["event_id,magnitude"]
    for i, m in enumerate(mags): lines.append(f"{prefix}-{i:04d},{m:.2f}")
    open(path, "w").write("\n".join(lines))

main = sample(0.85, 1.2, 900); save(os.path.join(data_dir,"catalog.csv"), main, "QC")
ref = sample(1.00, 1.5, 600); save(os.path.join(data_dir,"reference_catalog.csv"), ref, "REF")
open(os.path.join(data_dir,"reference_true_b.txt"),"w").write("1.00\n")
for name, arr, mc in [("main",main,1.2),("ref",ref,1.5)]:
    sel = arr[arr>=mc]; b_hat = np.log10(np.e)/(sel.mean()-mc)
    print(f"{name}: n={len(arr)} MLE_b={b_hat:.3f}")
print("OK")
