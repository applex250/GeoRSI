# Geostatistical Analysis

## Task
Your task is to analyze the spatial aggregation patterns and scales of geographical flows using the L-function.  First, load the flow data, origin area data , and destination area data. Second, calculate the local K-function for each flow by iterating over flow pairs and applying distance-based analysis with edge correction. Third, compute the global L-function by averaging the local K-functions and transforming the result. Finally, visualize the L-function as "l_function.png".

## Data
dataset/flow.csv: Contains the geographical flows represented as connected origin-destination (OD) point pairs.
dataset/o_area.csv: Contains the boundary coordinates for the region where the origin points lie.
dataset/d_area.csv: Contains the boundary coordinates for the region where the destination points lie.

## Expected deliverable style
style: {"x_col": "r", "y_col": "L", "label": "L(r)", "color": "blue", "linewidth": 2}

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
