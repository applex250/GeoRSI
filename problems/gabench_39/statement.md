# Spatial Data Management

## Task
Your task is to analyze homelessness trends in North Dakota during the 2013 oil boom. Join the homelessness tabular data to the U.S. states spatial layer using state abbreviations, and save the resulting map as "us_homeless_2013.png".

## Data
dataset/homeless_data.xlsx: containing state-level homelessness data in the United States for 2013. The dataset includes the following columns:State, Change, Pop13, Homeless13
dataset/USA_States.shp: This shapefile contains polygon boundaries for the U.S. states, providing geographic reference for spatial analysis.

## Expected deliverable style
style: {"column": <placeholder>, "legend": True, "cmap": "Reds"}

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
