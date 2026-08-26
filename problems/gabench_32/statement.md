# Raster Spatial Analysis

## Task
Your task is to assess the impact of hail damage on cornfields using pre- and post-storm satellite imagery. You will calculate vegetation loss due to the storm by applying the Soil-Adjusted Vegetation Index (SAVI) to multispectral imagery from the study area. This involves computing SAVI for both the pre-storm and post-storm images, then subtracting them to obtain a pixel-level vegetation loss map. Finally, visualize the vegetation loss and save the output as "Veg_Loss.png".

## Data
dataset/Before_Storm.tif: Raster file containing multispectral satellite imagery before the hailstorm.
dataset/After_Storm.tif: Raster file containing multispectral satellite imagery after the hailstorm.

## Expected deliverable style
style: vegetation loss style: {"cmap": "RdYlGn_r", "vmin": -1.0, "vmax": 1.0, "legend": True, "legend_label": "Vegetation Loss (Before - After)"}

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
