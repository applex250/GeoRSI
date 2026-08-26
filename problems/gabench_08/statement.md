# Vector Spatial Analysis

## Task
Your task is analyzing Toronto fire stations and their service coverage. The goal is visualize the current fire station coverage in Etobicoke by buffering to identify coverage gaps. Save the figure as "Fire_Service_Analysis.png".
Note: If any input GeoJSON file does not explicitly define a coordinate reference system (CRS), assume and assign it as WGS84 (EPSG:4326).

## Data
dataset/etobicoke.geojson: Polygon Geojson file for neighborhood region for Etobicoke.
dataset/fire_stations.geojson: Point Geojson file for current fire stations distribution as points.

## Expected deliverable style
etobicoke area style:{"facecolor": "lightgrey", "edgecolor": "black", "alpha": 0.8, "label": "Etobicoke Area"}
no service area style:{"facecolor": "blue", "edgecolor": "black", "alpha": 0.5, "label": "No Service Area"}

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
