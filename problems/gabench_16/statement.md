# Geostatistical Analysis

## Task
Load North America climate data in NetCDF file and extract temperature data along the time series, then perform a quadratic polynomial fit analysis on the temperature data, finally plot the curve as 'polynomial_fit_pred.png'.

## Data
dataset/A1B_north_america.nc: NetCDF data of climate data and temperature data in North America.

## Expected deliverable style
fitted style: {"x_col": "Year", "y_col": "Fitted_Temperature", "label": "Fitted", "color": "red", "linewidth": 2}

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
