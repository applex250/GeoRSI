# Raster Spatial Analysis

## Task
Your task is to identify those high risk zones of groundwater vulnerable areas that need protection. First, use vulnerable_areas and land_cover to perform suitability modeling to calculate risk_zones. Next, filter out high_risk_zones, and then undeveloped_areas based on risk_zones, and visualize the result as 'undeveloped_areas.png'.
The reclassification of vulnerable_areas is standardization to [1, 10].
The reclassification of land_cover is [[11, 1],[21, 6],[22, 7],[23, 8],[24, 10],[31, 4],[41, 3],[42, 1],[43, 3],[52, 3],[71, 2],[81, 5],[82, 9],[90, 1],[95, 1]].
risk_zones = vulnerable_areas * 8 + land_cover * 10
Undeveloped areas in the high risk zones (risk_zones > 100) need more protection. Seek for the areas in land_cover masking high risk zone, use the following rule: [31, 41, 43, 52, 71, 81, 90, 95]

## Data
dataset/vulnerable_areas.tif: Raster file showing the whole groundwater vulnerable areas of study area, one band.
dataset/land_cover.tif: Raster file showing the land cover of study area, one band.

## Expected deliverable style
water risk style: {"cmap": "viridis", "alpha": 0.9, "label": "Risk", "colorbar": True}
undeveloped areas style: {"cmap": "Greys", "alpha": 0.5, "label": "Undeveloped"}

## How to submit
1. Analyze the data with python (write scripts, run_python; use start_job for
   anything longer than a couple of minutes). geopandas / rasterio / scipy are
   available in the python environment.
2. Produce the output artifact(s) the task asks for (figures as PNG, derived
   layers as geojson/tif) in the workspace root, with descriptive filenames.
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {
     "key_values": {"<descriptive label>": <number>, ...},
     "output_files": ["<filename you created>", ...],
     "summary": "<2-4 sentences: method and main findings>"
   }

## Grading
Your produced artifacts are checked for existence/non-degeneracy, and your
method + results are compared against an expert reference solution (tool
chain, expected product, cartographic style). Method correctness matters more
than pixel-exact styling.
