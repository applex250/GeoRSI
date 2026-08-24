"""Eval script: score = max(0, 1 - |b_est - b_true| / 0.5).
Usage: python eval.py --submission <path> --split public|private"""
import argparse, json, math, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if a.split == "public":
        truth_file = os.path.join(script_dir, "data", "reference_true_b.txt")
    else:
        # private truth lives OUTSIDE the lab tree so agents cannot peek at it
        truth_file = os.environ.get(
            "RSILAB_PRIVATE_TRUTH",
            os.path.join(script_dir, "..", "..", "..", "rsi-lab-private", "true_b.txt"),
        )

    try:
        t = float(open(truth_file).read().strip())
    except Exception as e:
        print(f"##SCORE##0"); print(json.dumps({"error": f"truth read fail: {e}"})); return

    try:
        sub = json.load(open(a.submission))
        b = abs(float(sub["b"]))
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"submission parse fail: {e}"})); return

    score = max(0.0, 1.0 - abs(b - t) / 0.5)
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), "b_est": b, "b_true": t}))

if __name__ == "__main__":
    main()
