# Hydrological Analysis

## Task
Your task is identifying and quantifying topographic depressions (sinks) in the study area. Starting with the raw Digital Elevation Model (DEM), first generate a depression-filled DEM to simulate a hydrologically corrected surface. Then, calculate the sink depth raster by computing the vertical difference between the filled and original elevations. Finally, visualize the resulting sink depth map to highlight the location and magnitude of filled areas, saving the output as 'Sink_Depth_Analysis.png'.

## Data
dataset/dem.tif: Raster data (Digital Elevation Model) representing the raw terrain surface, which serves as the baseline for detecting depressions.

## Expected deliverable style
style: {"cmap": "viridis", "legend": True, "legend_label": "Depth (m)"}

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
