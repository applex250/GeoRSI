# Geostatistical Analysis

## Task
Your task is using 240 years of annual average surface temperature data from North America to calculate and plot the number of occurrences where the temperature exceeds 280K for five consecutive years. Save the figure as 'temperature_statistic_vis.png'.

## Data
dataset/E1_north_america.nc: NetCDF Temperature data in North America for a 240 year period.

## Expected deliverable style
warm spells style: {"cmap": "RdYlBu_r", "title":"Warm Spells", "legend": True, "legend_label": "Warm spell count"}

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
