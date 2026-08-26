# Raster Spatial Analysis

## Task
Your task is evaluating mountain lion habitat suitability, and the first step is calculating terrain ruggedness using elevation data. Visualizing the ruggedness and save the outputs as "ruggedness.png".

## Data
dataset/Elevation.tif: Raster files for storing elevation data.

## Expected deliverable style
ruggedness style:{"cmap": "viridis", "legend": True, "legend_label": "Ruggedness"}

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
