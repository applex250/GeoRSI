# Hydrological Analysis

## Task
Your task is performing hydrological flow accumulation analysis. First, use the pre-processed filled DEM to compute the D8 flow direction raster. Next, calculate the flow accumulation raster based on the flow direction to determine the accumulated upstream contribution for each cell. Finally, visualize the flow accumulation result using a gray colormap with the title "Flow Accumulation (D8)" and save the output map as "FlowAccumulation.png".

## Data
dataset/dem_filled.tif: Raster data (Filled Digital Elevation Model) with depressions removed to ensure hydrological connectivity

## Expected deliverable style
style: {"cmap": "gray", "legend": True, "legend_label": "Flow Accumulation"}

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
