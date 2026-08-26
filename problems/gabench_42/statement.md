# 3D Modeling and Analysis

## Task
This task performs a 3D line-of-sight (LOS) analysis between two specified points (Observer ID 0 and Target ID 2) from a 3D point shapefile, using 3D building data as potential obstacles. The result indicates whether the target is visible from the observer’s position in 3D space, and is saved to "los_stats.json".

## Data
dataset/building.shp: MultiPatch data (representing buildings as 3D solids)
dataset/point3d.shp: 3D point vector data containing observer and target points

## Expected deliverable style
no style

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
