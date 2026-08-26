# Geostatistical Analysis

## Task
Your task is to analyze how location impacts interest rates. First, select and copy the tracts with at least 30 loans. Find interest rate hot spots on the selected loan tracts. Then create a Geographically Weighted Regression (GWR) model on the selected data to determine how location impacts interest rates. Finally, visualize the interest rate hot spots and save the output as "loan_hot_spots.png".

## Data
dataset/loan_data.shp: The loan data from August 2007 to September 2015, obtained from LendingClub Statistics.

## Expected deliverable style
style: {"column": <placeholder>,"categorical": True,"cmap":"RdYlBu_r","legend": True,"legend_kwds": {"title": "Hot Spot Type"}}

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
