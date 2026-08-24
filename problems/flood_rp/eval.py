"""Eval script: score = max(0, 1 - |q100_est - q100_true| / (0.25*q100_true)).
Usage: python eval.py --submission <path> --split public|private"""
import argparse, json, math, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if a.split == "public":
        truth = 235.0045  # reference basin: mu=120, beta=25
    else:
        truth_file = os.environ.get(
            "RSILAB_PRIVATE_TRUTH",
            os.path.join(script_dir, "..", "..", "..", "rsi-lab-private", "flood_rp.txt"),
        )
        try:
            truth = float(open(truth_file).read().strip())
        except Exception as e:
            print("##SCORE##0"); print(json.dumps({"error": f"truth read fail: {e}"})); return

    try:
        sub = json.load(open(a.submission))
        q = abs(float(sub["q100"]))
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"submission parse fail: {e}"})); return

    score = max(0.0, 1.0 - abs(q - truth) / (0.25 * truth))
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), "q100_est": q, "q100_true": truth}))

if __name__ == "__main__":
    main()
