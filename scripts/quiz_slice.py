"""Create a small, deterministic quiz pilot from an existing quiz problem.

The source problem remains untouched. The slice keeps a small public
calibration prefix and copies the source evaluator plus any supporting data.
Private answers stay in the problem directory and are never copied into the
agent workspace by the runtime.
"""
import argparse
import json
import os
import shutil


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="existing problem id, e.g. stepgame_c005")
    ap.add_argument("--target", required=True, help="new problem id")
    ap.add_argument("--genre", required=True, help="quiz genre, e.g. quiz-stepgame")
    ap.add_argument("--public-count", type=int, default=5)
    ap.add_argument("--private-count", type=int, default=15)
    ap.add_argument("--private-offset", type=int, default=40)
    ap.add_argument("--max-turns", type=int, default=8)
    ap.add_argument("--eval-cap", type=int, default=2)
    ap.add_argument("--eval-timeout-s", type=int, default=900)
    ap.add_argument("--judge", action="store_true")
    ap.add_argument(
        "--data-mode",
        choices=["all", "task"],
        default="all",
        help="copy all supporting data or only files inferred from selected MapQA qids",
    )
    args = ap.parse_args()

    source_dir = os.path.join(ROOT, "problems", args.source)
    target_dir = os.path.join(ROOT, "problems", args.target)
    if os.path.exists(target_dir):
        raise SystemExit(f"target already exists: {target_dir}")

    questions = read_jsonl(os.path.join(source_dir, "data", "quiz.jsonl"))
    gold = read_jsonl(os.path.join(source_dir, "answers.private.jsonl"))
    if len(gold) != len(questions):
        raise SystemExit("question and private-answer line counts differ")

    indices = list(range(args.public_count)) + list(
        range(args.private_offset, args.private_offset + args.private_count)
    )
    if len(indices) != args.public_count + args.private_count or max(indices) >= len(questions):
        raise SystemExit("source quiz is too short for the requested slice")

    selected = []
    selected_gold = []
    occurrences = {}
    collisions = 0
    for index in indices:
        question = dict(questions[index])
        answer = dict(gold[index])
        if question.get("qid") != answer.get("qid"):
            raise SystemExit(f"question/gold qid mismatch at source line {index + 1}")
        source_qid = str(question["qid"])
        occurrence = occurrences.get(source_qid, 0)
        occurrences[source_qid] = occurrence + 1
        if occurrence:
            collisions += 1
            new_qid = f"{source_qid}__slice{occurrence + 1}"
            question["qid"] = new_qid
            answer["qid"] = new_qid
        selected.append(question)
        selected_gold.append(answer)

    if sum(bool(row.get("dev")) for row in selected_gold) != args.public_count:
        raise SystemExit("selected gold does not preserve the requested public calibration count")

    os.makedirs(os.path.join(target_dir, "data"), exist_ok=False)
    write_jsonl(os.path.join(target_dir, "data", "quiz.jsonl"), selected)
    write_jsonl(os.path.join(target_dir, "answers.private.jsonl"), selected_gold)
    shutil.copyfile(os.path.join(source_dir, "eval.py"), os.path.join(target_dir, "eval.py"))

    source_statement = open(os.path.join(source_dir, "statement.md"), encoding="utf-8").read()
    source_lines = source_statement.splitlines()
    if source_lines:
        source_lines[0] = f"# Quiz pilot batch: {args.target}"
    source_statement = "\n".join(source_lines) + "\n"
    with open(os.path.join(target_dir, "statement.md"), "w", encoding="utf-8") as f:
        f.write(source_statement)

    metadata = {
        "type": "quiz",
        "genre": args.genre,
        "max_turns": args.max_turns,
        "eval_cap": args.eval_cap,
        "episode_timeout_s": args.eval_timeout_s,
        "patience": 2,
        "eval_timeout_s": args.eval_timeout_s,
    }
    if args.judge:
        metadata["judge"] = True
    with open(os.path.join(target_dir, "problem.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        f.write("\n")

    source_data = os.path.join(source_dir, "data")
    target_data = os.path.join(target_dir, "data")
    selected_qids = [str(row["qid"]) for row in selected]
    task_files = set()
    task_map = {
        "distance": "distance_dataset_json",
        "intersection": "intersection_dataset_json",
        "nearest_amenity": "nearest_amenity_dataset_json",
        "direction_nearest": "direction_nearest_dataset_json",
        "amenities-around-specific": "amenities-around-specific_json",
        "amenities_around": "amenities_around_dataset_json",
        "amenities_": "amenities_dataset_json",
        "compare-closer": "compare-closer_json",
        "adjacent": "adjacent_dataset_json",
    }
    if args.data_mode == "task":
        for qid in selected_qids:
            for marker, filename in task_map.items():
                if marker in qid:
                    task_files.add(filename)
        task_files.add("amenities_csv")
    for name in os.listdir(source_data):
        if name == "quiz.jsonl":
            continue
        if args.data_mode == "task" and name not in task_files:
            continue
        src = os.path.join(source_data, name)
        dst = os.path.join(target_data, name)
        if os.path.isfile(src):
            shutil.copyfile(src, dst)

    print(
        f"{args.target}: {len(selected)} questions "
        f"(public={args.public_count}, private_only={args.private_count}, "
        f"qid_collisions_renamed={collisions}) from {args.source}"
    )


if __name__ == "__main__":
    main()
