/** Deterministic score aggregation shared by training and exam reports. */

export interface FitnessValue {
	fitness: number | null;
	weight?: number;
}

/**
 * Fixed-denominator weighted mean: a null fitness is a failed task and
 * contributes zero, while its weight remains in the denominator.
 */
export function weightedFitnessMean(values: FitnessValue[]): number | null {
	if (values.length === 0) return null;
	const totalWeight = values.reduce((sum, value) => sum + (value.weight ?? 1), 0);
	if (!(totalWeight > 0)) return null;
	return values.reduce((sum, value) => sum + (value.fitness ?? 0) * (value.weight ?? 1), 0) / totalWeight;
}

export function meanWithFailures(values: (number | null)[]): number | null {
	return weightedFitnessMean(values.map((fitness) => ({ fitness })));
}
