/**
 * Canonical task taxonomy shared by evaluation, routing, prompt assembly and
 * reporting. Keeping this decision in one pure module prevents independent
 * string heuristics from drifting between the bench and inner runner.
 */
export type TaskKind = "standard" | "quiz" | "judge" | "self-graded";

export interface TaskProfile {
	id: string;
	genre: string;
	kind: TaskKind;
	isQuiz: boolean;
	usesJudge: boolean;
	usesOutsideTruth: boolean;
	preferredInnerRole: "quantitative" | "quiz" | "gis";
}

export interface TaskProfileInput {
	id: string;
	genre?: string;
	overrides?: {
		type?: "standard" | "quiz";
		judge?: boolean;
		self_graded?: boolean;
	};
}

export function profileTask(input: TaskProfileInput): TaskProfile {
	const genre = input.genre ?? "general";
	const overrides = input.overrides ?? {};
	const isQuiz = overrides.type === "quiz" || genre.toLowerCase().startsWith("quiz-");
	const usesJudge = overrides.judge === true;
	const selfGraded = overrides.self_graded === true;
	const kind: TaskKind = isQuiz ? "quiz" : usesJudge ? "judge" : selfGraded ? "self-graded" : "standard";
	const lowerGenre = genre.toLowerCase();
	const isGis = /gis|geoanalyst|geobench|geona|gabench/.test(lowerGenre);
	return {
		id: input.id,
		genre,
		kind,
		isQuiz,
		usesJudge,
		usesOutsideTruth: !isQuiz && !usesJudge && !selfGraded,
		preferredInnerRole: isQuiz ? "quiz" : isGis ? "gis" : "quantitative",
	};
}
