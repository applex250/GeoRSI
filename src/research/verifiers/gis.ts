/** Deterministic CRS/vector/raster/artifact gate for GIS and remote sensing. */
import { errorIssue, verificationResult, warningIssue, type ScientificVerificationResult, type VerificationIssue } from "./base.js";

export interface GisArtifactCheck {
	path: string;
	kind: "vector" | "raster" | "figure" | "table";
	bytes: number;
	sha256: string;
	crs?: string;
	bounds?: [number, number, number, number];
	featureCount?: number;
	invalidGeometryCount?: number;
	emptyGeometryCount?: number;
	nodata?: number | null;
	width?: number;
	height?: number;
}

export interface GisVerificationInput {
	inputCrs: string[];
	outputCrs?: string;
	metricOperations: boolean;
	projectedForMetricOperations: boolean;
	axisOrderChecked: boolean;
	artifacts: GisArtifactCheck[];
	requestedOutputPaths: string[];
	spatialJoinRowCount?: number;
	nullJoinCount?: number;
	replayStatisticsMatch: boolean;
}

function safeRelativePath(path: string): boolean {
	return !!path && !path.includes("..") && !/^[/\\]|^[A-Za-z]:/.test(path);
}

export function verifyGisResearch(input: GisVerificationInput): ScientificVerificationResult {
	const issues: VerificationIssue[] = [];
	if (input.inputCrs.length === 0 || input.inputCrs.some((crs) => !crs.trim())) issues.push(errorIssue("input-crs", "all GIS inputs require a CRS"));
	if (!input.axisOrderChecked) issues.push(errorIssue("axis-order", "axis order was not checked"));
	if (input.metricOperations && !input.projectedForMetricOperations) issues.push(errorIssue("metric-crs", "distance/area/buffer operations require an appropriate projected CRS"));
	if (!input.outputCrs?.trim()) issues.push(errorIssue("output-crs", "output CRS is missing"));
	const byPath = new Map(input.artifacts.map((artifact) => [artifact.path, artifact]));
	for (const path of input.requestedOutputPaths) {
		const artifact = byPath.get(path);
		if (!safeRelativePath(path)) issues.push(errorIssue("artifact-path", `unsafe artifact path: ${path}`));
		if (!artifact) issues.push(errorIssue("missing-artifact", `requested GIS artifact is missing: ${path}`));
	}
	for (const artifact of input.artifacts) {
		if (!safeRelativePath(artifact.path)) issues.push(errorIssue("artifact-path", `unsafe artifact path: ${artifact.path}`));
		if (artifact.bytes < 128) issues.push(errorIssue("degenerate-artifact", `artifact is too small: ${artifact.path}`));
		if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) issues.push(errorIssue("artifact-hash", `artifact hash is invalid: ${artifact.path}`));
		if ((artifact.kind === "vector" || artifact.kind === "raster") && !artifact.crs?.trim()) issues.push(errorIssue("artifact-crs", `spatial artifact lacks CRS: ${artifact.path}`));
		if (artifact.bounds && (!artifact.bounds.every(Number.isFinite) || artifact.bounds[0] >= artifact.bounds[2] || artifact.bounds[1] >= artifact.bounds[3])) issues.push(errorIssue("artifact-bounds", `artifact bounds are invalid: ${artifact.path}`));
		if (artifact.kind === "vector") {
			if (!Number.isSafeInteger(artifact.featureCount) || (artifact.featureCount ?? 0) <= 0) issues.push(errorIssue("feature-count", `vector has no features: ${artifact.path}`));
			if ((artifact.invalidGeometryCount ?? 0) > 0) issues.push(errorIssue("invalid-geometry", `vector contains invalid geometries: ${artifact.path}`));
			if ((artifact.emptyGeometryCount ?? 0) > 0) issues.push(warningIssue("empty-geometry", `vector contains empty geometries: ${artifact.path}`));
		}
		if (artifact.kind === "raster" && ((artifact.width ?? 0) <= 0 || (artifact.height ?? 0) <= 0)) issues.push(errorIssue("raster-shape", `raster dimensions are invalid: ${artifact.path}`));
	}
	if (input.spatialJoinRowCount !== undefined && input.spatialJoinRowCount <= 0) issues.push(errorIssue("spatial-join", "spatial join produced no rows"));
	if (input.spatialJoinRowCount && (input.nullJoinCount ?? 0) / input.spatialJoinRowCount > 0.5) issues.push(warningIssue("spatial-join-null", "more than half of spatial join results are null"));
	if (!input.replayStatisticsMatch) issues.push(errorIssue("gis-replay", "GIS replay statistics differ from the original run"));
	const checks = {
		crs: input.inputCrs.length > 0 && input.inputCrs.every(Boolean) && !!input.outputCrs,
		axisOrder: input.axisOrderChecked,
		metricProjection: !input.metricOperations || input.projectedForMetricOperations,
		artifactsPresent: input.requestedOutputPaths.every((path) => byPath.has(path)),
		artifactIntegrity: input.artifacts.every((artifact) => safeRelativePath(artifact.path) && artifact.bytes >= 128 && /^[a-f0-9]{64}$/i.test(artifact.sha256)),
		geometry: input.artifacts.filter((artifact) => artifact.kind === "vector").every((artifact) => (artifact.featureCount ?? 0) > 0 && (artifact.invalidGeometryCount ?? 0) === 0),
		rasterShape: input.artifacts.filter((artifact) => artifact.kind === "raster").every((artifact) => (artifact.width ?? 0) > 0 && (artifact.height ?? 0) > 0),
		replay: input.replayStatisticsMatch,
	};
	return verificationResult("gis-v1", issues, checks);
}
