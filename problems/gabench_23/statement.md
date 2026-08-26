# Spatial Data Management

## Task
Your task is to process a de-identified point-level dataset that includes all variables of interest for each child as well as their approximate locations. You need to load the point data, ensure a consistent Coordinate Reference System (CRS), round the coordinates to two decimal places, save the result as "rounded_points_plot.png", and visualize it.

## Data
dataset/High_Blood_Level_Results.shp: This shapefile contains point data representing incidents of elevated blood lead levels in children within the study area. Each point corresponds to a specific geographic location where a blood test was conducted, and the results indicated a high concentration of lead.
dataset/Sacramento_ZIP_Codes.shp: This shapefile contains polygon data representing the boundaries of ZIP codes within Sacramento. Each polygon defines the geographic extent of a specific ZIP code.

## Expected deliverable style
style: {"color": "blue","markersize": 5,"alpha": 1.0}

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
