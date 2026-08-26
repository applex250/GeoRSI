# Geostatistical Analysis

## Task
Your task is using data on the locations and related information of fatal car crashes in New York City to analyze fatal car crash distribution in 2016. You will use the car crash data along with the GeoJSON data of NYC administrative regions to plot the geographical distribution of fatal crashes in 2016 on a map. Save the figure as 'collisions_map_vis.png'.

## Data
dataset/nyc_boroughs.geojson:Multipolygon Geojson file storing boroughs in the NewYork city.
dataset/fatal_collisions.geojson: Point Geojson file storing fatal collisions in each boroughs along with the number of persons killed in 2016.

## Expected deliverable style
boroughs style:{"facecolor": "none", "edgecolor": "black", "linewidth": 1, "label": "Boroughs"}
fatal collisions style:{"color": "red", "markersize": 5, "label": "Fatal Collisions"}

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
