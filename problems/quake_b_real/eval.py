"""Eval script: score = max(0, 1 - |b_est - b_true| / 0.5).
Usage: python eval.py --submission <path> --split public|private

Truths are canonical Aki-MLE estimates at Mc from maximum curvature:
  public  = reference period 1990-2009 (0.9291, stated in the problem)
  private = main period 2010-2024 (from RSILAB_PRIVATE_TRUTH / tree-external file)
"""
import argparse, json, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if a.split == "public":
        truth = 0.9291  # reference catalog (1990-2009), canonical Aki MLE
    else:
        truth_file = os.environ.get(
            "RSILAB_PRIVATE_TRUTH",
            os.path.join(script_dir, "..", "..", "..", "rsi-lab-private", "quake_b_real.txt"),
        )
        try:
            truth = float(open(truth_file).read().strip())
        except Exception as e:
            print("##SCORE##0"); print(json.dumps({"error": f"truth read fail: {e}"})); return

    try:
        sub = json.load(open(a.submission))
        b = float(sub["b"])
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"submission parse fail: {e}"})); return

    if not (0.2 <= b <= 2.0):
        print("##SCORE##0"); print(json.dumps({"error": f"b={b} outside plausible [0.2, 2.0]"})); return

    score = max(0.0, 1.0 - abs(b - truth) / 0.5)
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), "b_est": b, "b_true": truth}))

if __name__ == "__main__":
    main()
