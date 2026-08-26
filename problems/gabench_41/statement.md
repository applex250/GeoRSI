# Raster Spatial Analysis

## Task
Your task is standardizing protected status datasets for consistency in analysis for mountain lion habitat. Reclassify this categorical dataset to a common scale using geospatial tools, and visualize the reclassified results, saving them as "reclassified_protectedStatus.png".
The protected status data are reclassified as follows: 0 (Unprotected) → 1, 1 (Low protection) → 3, 2 (Moderate protection) → 6, 3 (High protection) → 9, 4 (Highest/strict protection) → 10, and 255 (NoData or undefined) → 10.
These reclassification schemes align the original categorical values to a unified scale suitable for mountain lion habitat suitability modeling.

## Data
dataset/Protected_Status.tif: GeoTiff file storing the Protected status in 5 levels as well as the null data.

## Expected deliverable style
style:{"cmap": "tab20", "legend": True}

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
