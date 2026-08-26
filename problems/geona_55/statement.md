# GeoNature task (language, difficulty hard)

## Question
Aztertu higadura-arriskua Nafarroan eta konparatu Gipuzkoako balioekin.

## Available API tools
Call these by exact name, with JSON arguments matching the schema:

### list_layers
List all available raster layers with their indicator name, year, season, description, and access tier. Use this to discover what data is available before analyzing an area.
args schema: `{"type": "object", "properties": {}, "required": []}`

### get_legend
Get the legend (value → label mapping) for a specific indicator. This tells you what each pixel value means (e.g., 0 = Not eligible, 2 = Eligible). Essential for interpreting analysis results.
args schema: `{"type": "object", "properties": {"indicator": {"type": "string", "description": "Indicator name, e.g. 'co2_spain_legislation'"}}, "required": ["indicator"]}`

### analyze_area
Analyze a raster layer within a given Area of Interest (AOI). For categorical layers: returns pixel counts per category. For continuous layers: returns min, max, mean, median, std. The AOI must be a GeoJSON geometry (Polygon or MultiPolygon).
args schema: `{"type": "object", "properties": {"indicator": {"type": "string", "description": "Indicator name"}, "year": {"type": "string", "description": "Year, e.g. '2026'"}, "season": {"type": "string", "description": "Season, e.g. 'annual'"}, "aoi": {"type": "object", "description": "GeoJSON geometry (Polygon/MultiPolygon)"}}, "required": ["indicator", "year", "season", "aoi"]}`

### get_layer_bounds
Get the geographic bounding box of a layer in WGS84 coordinates. Useful to know the spatial extent of a dataset.
args schema: `{"type": "object", "properties": {"indicator": {"type": "string"}, "year": {"type": "string"}, "season": {"type": "string"}}, "required": ["indicator", "year", "season"]}`

### lookup_province
Look up a Spanish province by name and get its geographic boundary. Returns the province name, code, and bounding box. Use this when the user mentions a province name (e.g., 'Murcia', 'Barcelona', 'Sevilla'). After calling this tool, call analyze_area with an empty {} for the aoi parameter — the system will inject the province geometry automatically.
args schema: `{"type": "object", "properties": {"name": {"type": "string", "description": "Province name in Spanish (e.g., 'Murcia', 'Madrid', 'Barcelona')"}}, "required": ["name"]}`

### lookup_municipality
Look up a Spanish municipality (municipio) by name and get its geographic boundary. Returns the municipality name, code, province, CCAA, and bounding box. Use this when the user mentions a specific town or city (e.g., 'Villanueva de la Serena', 'Lorca', 'Getafe'). Optionally provide a province hint to disambiguate. After calling this tool, call analyze_area with an empty {} for the aoi parameter — the system will inject the municipality geometry automatically.
args schema: `{"type": "object", "properties": {"name": {"type": "string", "description": "Municipality name in Spanish (e.g., 'Villanueva de la Serena', 'Lorca')"}, "province": {"type": "string", "description": "Optional province name to disambiguate (e.g., 'Badajoz')"}}, "required": ["name"]}`

### compare_areas
Compare two Spanish provinces side-by-side on a single indicator. Returns statistics for both areas and a one-line comparison note. REQUIRED for any province comparison question — call once per pair. For three provinces, call this twice (e.g., A vs B, then A vs C).
args schema: `{"type": "object", "properties": {"area_a": {"type": "string", "description": "Name of the first province (e.g., 'Murcia')"}, "area_b": {"type": "string", "description": "Name of the second province (e.g., 'Córdoba')"}, "indicator": {"type": "string", "description": "Indicator to compare (e.g., 'co2_spain_legislation')"}, "year": {"type": "string", "description": "Year (e.g., '2026')"}, "season": {"type": "string", "description": "Season (e.g., 'annual')"}}, "required": ["area_a", "area_b", "indicator", "year", "season"]}`

### find_top_n
Find the top or bottom N Spanish provinces by a metric using pre-computed rankings. Instant — no raster reads needed. Use this for ranking questions ('which province has the highest CO2 eligibility?', 'top 10 erosion risk provinces'). Optionally scope results to specific provinces with filter_provinces.
args schema: `{"type": "object", "properties": {"metric": {"type": "string", "description": "Metric to rank by. Options: 'co2_eligible_pct', 'co2_conditional_pct', 'co2_not_eligible_pct', 'erosion_mean_pct', 'erosion_max_pct'"}, "n": {"type": "integer", "description": "Number of results to return (default: 10)"}, "order": {"type": "string", "description": "'desc' for top (highest first), 'asc' for bottom (lowest first). Default: 'desc'"}, "filter_provinces": {"type": "array", "items": {"type": "string"}, "description": "Optional list of province names to restrict results to (e.g., ['Murcia', 'Córdoba', 'Jaén'])"}}, "required": ["metric"]}`

### generate_chart
Create a PNG chart from data and upload it to GCS. Returns the GCS URI. Use this after any comparison or ranking analysis to produce a visual output. chart_type options: 'stacked_bar' (CO2 class breakdown per province), 'ranked_bar' (horizontal ranking), 'grouped_bar' (multi-metric side-by-side), 'bar' (simple bar).
args schema: `{"type": "object", "properties": {"chart_type": {"type": "string", "description": "Chart type: 'stacked_bar', 'ranked_bar', 'grouped_bar', or 'bar'"}, "title": {"type": "string", "description": "Chart title"}, "data": {"type": "array", "description": "Array of data objects. Each must have a 'label' key. For stacked_bar: other keys are stack segments (e.g., {label: 'Murcia', Eligible: 68.2, Conditional: 18.1}). For ranked_bar: {label: 'Ciudad Real', value: 78.9}. For grouped_bar: same as stacked_bar but rendered side-by-side.", "items": {"type": "object"}}, "x_label": {"type": "string", "description": "X-axis label"}, "y_label": {"type": "string", "description": "Y-axis label"}, "output_prefix": {"type": "string", "description": "GCS path prefix under the bucket (e.g., 'poc/experiments/exp_poc_001/visualizations')"}, "filename": {"type": "string", "description": "Filename without extension (auto-generated from title if omitted)"}}, "required": ["chart_type", "title", "data"]}`

### analyze_multi_layer
Analyze multiple indicators for the same province in one call. More efficient than separate analyze_area calls — runs raster reads in parallel. Use this for combined multi-indicator analysis (e.g., CO2 eligibility + erosion risk together for a province deep-dive).
args schema: `{"type": "object", "properties": {"province": {"type": "string", "description": "Province name (e.g., 'Córdoba')"}, "indicators": {"type": "array", "description": "List of indicators to analyze. Each item: {indicator, year, season}", "items": {"type": "object", "properties": {"indicator": {"type": "string"}, "year": {"type": "string"}, "season": {"type": "string"}}, "required": ["indicator", "year", "season"]}}}, "required": ["province", "indicators"]}`

### toggle_layer
Toggle a map layer on or off. Use this when the user asks to show, display, hide, or remove a dataset on the map. Available layers: co2_spain_legislation, rf_gully_probability, ines_erosion_potencial, ines_movimientos_masa, ines_erosion_eolica, mfe, burnt_areas, lucas_gully_channels, lucas_gully_locations, lucas_survey_points, lucas_crosscheck_random, lucas_crosscheck_omission.
args schema: `{"type": "object", "properties": {"indicator": {"type": "string", "description": "Layer indicator name (e.g., 'co2_spain_legislation', 'rf_gully_probability', 'mfe', 'burnt_areas', 'ines_erosion_potencial')"}, "visible": {"type": "boolean", "description": "True to show the layer, false to hide it"}}, "required": ["indicator", "visible"]}`

### query_erosion_stats
Query pre-computed spectral index statistics for Murcia municipalities (2018-2025). Supports timeseries (monthly values for one municipality), ranking (municipalities sorted by index value), and seasonal (average monthly pattern). Available indices: ndvi (vegetation), bsi (bare soil / erosion proxy), ndwi (water), ndbi (built-up), msi (moisture stress), savi (soil-adjusted vegetation), nbr (burn ratio), fvc (fractional vegetation cover). Use this for erosion analysis, vegetation trends, fire recovery, and seasonal pattern questions about Murcia.
args schema: `{"type": "object", "properties": {"query_type": {"type": "string", "description": "Query type: 'timeseries' (monthly values for a municipality), 'ranking' (municipalities sorted by index), 'seasonal' (average monthly pattern)"}, "indices": {"type": "array", "items": {"type": "string"}, "description": "Spectral indices to query. Options: 'ndvi', 'bsi', 'ndwi', 'ndbi', 'msi', 'savi', 'nbr', 'fvc'"}, "municipality": {"type": "string", "description": "Municipality name (required for timeseries, optional for seasonal). E.g., 'Lorca', 'Cartagena', 'Murcia'"}, "year_start": {"type": "integer", "description": "Start year (default: 2018)"}, "year_end": {"type": "integer", "description": "End year (default: 2025)"}}, "required": ["query_type", "indices"]}`

### create_buffer
Create a buffer zone around a province or municipality geometry. Returns a GeoJSON polygon representing the buffered area. Useful for proximity queries like 'what municipalities are within 50 km of Murcia?' — first buffer the source area, then use select_features_by_spatial_relationship to find intersecting features.
args schema: `{"type": "object", "properties": {"area_name": {"type": "string", "description": "Province or municipality name (e.g., 'Murcia', 'Lorca')"}, "area_type": {"type": "string", "description": "'province' or 'municipality'. Default: 'province'"}, "buffer_km": {"type": "number", "description": "Buffer distance in kilometres (e.g., 50)"}, "province_hint": {"type": "string", "description": "Optional province name to disambiguate municipalities"}}, "required": ["area_name", "buffer_km"]}`

### select_features_by_spatial_relationship
Select provinces or municipalities that satisfy a spatial relationship with a reference area. Spatial predicates: 'intersects', 'within', 'contains', 'touches', 'overlaps'. Uses OR logic — features matching ANY predicate are returned. Useful after create_buffer to find nearby areas, or to find all municipalities within a province.
args schema: `{"type": "object", "properties": {"reference_area": {"type": "string", "description": "Name of the reference province or municipality"}, "reference_type": {"type": "string", "description": "'province' or 'municipality'. Default: 'province'"}, "target_type": {"type": "string", "description": "Type of features to select: 'provinces' or 'municipalities'"}, "spatial_predicates": {"type": "array", "items": {"type": "string"}, "description": "Spatial predicates to check: 'intersects', 'within', 'contains', 'touches', 'overlaps'"}, "reference_aoi": {"type": "object", "description": "Optional GeoJSON geometry to use as reference instead of looking up by name (e.g., a buffered geometry from create_buffer)"}, "province_hint": {"type": "string", "description": "Optional province name to disambiguate reference municipality"}}, "required": ["target_type", "spatial_predicates"]}`

### get_centroids
Get the geographic centroid (center point) of one or more provinces or municipalities. Returns centroid coordinates (lat/lon) for each area. Useful for distance calculations or point-based spatial queries.
args schema: `{"type": "object", "properties": {"area_names": {"type": "array", "items": {"type": "string"}, "description": "List of province or municipality names"}, "area_type": {"type": "string", "description": "'province' or 'municipality'. Default: 'province'"}, "province_hint": {"type": "string", "description": "Optional province name to disambiguate municipalities"}}, "required": ["area_names"]}`

### reject_task
Call this tool when the user's question cannot be answered with the available tools and data. This prevents hallucinating an answer. Use when: the question requires data you don't have, asks about areas outside Spain, or needs analysis capabilities not available in the current toolset.
args schema: `{"type": "object", "properties": {"reason": {"type": "string", "description": "Brief explanation of why the task cannot be completed"}}, "required": ["reason"]}`

## How to submit
Call the submit tool with a JSON object EXACTLY of this shape:
{
  "tool_calls": [{"name": "<exact tool name>", "arguments": {...}}, ...],
  "actions": ["<map action, e.g. fly_to_bounds>", ...],
  "response": "<the textual answer a user would see, containing all key facts/values>"
}

Order matters: list tool calls in the exact order you would execute them.
Include EVERY call the analysis requires - missing calls score zero on that
step. The response must contain the concrete values/keywords a correct answer
needs, and must not contain error text.

## Grading
Fully deterministic: ordered tool-sequence match (0-0.5), required map
actions coverage (0-0.3), answer-content keyword coverage (0-0.2). Forbidden
content in the response voids the episode.
