"""Eval script: score = max(0, 1 - |slope_est - slope_true| / 0.010).
Usage: python eval.py --submission <path> --split public|private"""
import argparse, json, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if a.split == "public":
        truth = 0.020  # reference series forcing trend
    else:
        truth_file = os.environ.get(
            "RSILAB_PRIVATE_TRUTH",
            os.path.join(script_dir, "..", "..", "..", "rsi-lab-private", "climate_trend.txt"),
        )
        try:
            truth = float(open(truth_file).read().strip())
        except Exception as e:
            print("##SCORE##0"); print(json.dumps({"error": f"truth read fail: {e}"})); return

    try:
        sub = json.load(open(a.submission))
        s = float(sub["slope_per_year"])
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"submission parse fail: {e}"})); return

    score = max(0.0, 1.0 - abs(s - truth) / 0.010)
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), "slope_est": s, "slope_true": truth}))

if __name__ == "__main__":
    main()
