# Raster Spatial Analysis

## Task
Your task is analyzing the distribution of Total Electron Content. Load Total Electron Content (TEC) data from a space weather NetCDF file and visualize it. Save the figure as 'TEC_vis.png'.

## Data
dataset/space_weather.nc: Total ELectron Content data in netCDF format.

## Expected deliverable style
total electron content style: {"cmap": "viridis","title": "Total Electron Content", "legend": True, "legend_label": "TEC"}

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
