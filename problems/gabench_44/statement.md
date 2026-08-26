# Hydrological Analysis

## Task
Your task is generating a hydrologically corrected Digital Elevation Model (DEM) by removing surface depressions. Apply a depression-filling algorithm to the original DEM to ensure water can flow continuously across the terrain. Finally, visualize the resulting depressionless DEM using a terrain colormap and save the output map as 'dem_filled_viz.png'.

## Data
dataset/dem.tif: Raster data (Digital Elevation Model) representing the raw terrain surface with elevation values

## Expected deliverable style
style: {"cmap": "terrain", "legend": True, "legend_label": "Elevation (m)"}

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
