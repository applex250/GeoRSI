"""Eval script: score = max(0, 1 - |est - truth| / 1.0) in log10(k) units.
Usage: python eval.py --submission <path> --split public|private"""
import argparse, json, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if a.split == "public":
        truth = 0.0  # reference: a=-2.0, b=8.0 -> at phi=0.25
    else:
        truth_file = os.environ.get(
            "RSILAB_PRIVATE_TRUTH",
            os.path.join(script_dir, "..", "..", "..", "rsi-lab-private", "poro_perm.txt"),
        )
        try:
            truth = float(open(truth_file).read().strip())
        except Exception as e:
            print("##SCORE##0"); print(json.dumps({"error": f"truth read fail: {e}"})); return

    try:
        sub = json.load(open(a.submission))
        v = float(sub["log10_k_at_phi025"])
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"submission parse fail: {e}"})); return

    score = max(0.0, 1.0 - abs(v - truth) / 1.0)
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), "est": v, "truth": truth}))

if __name__ == "__main__":
    main()
