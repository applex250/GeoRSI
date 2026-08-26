# 3D Modeling and Analysis

## Task
Your task is using sea temperature and salinity data from the South Atlantic Ocean to calculate and analyze a vertical temperature-salinity profile within a specified range of latitude, longitude, and depth. Plot the profile and save the figure as 'ocean_profiles_vis.png'.

## Data
dataset/atlantic_profiles.nc: NetCDF profile data of partial Atlantic ocean with temperature and salinity data.

## Expected deliverable style
temperature style:{"x_col": <placeholder>, "y_col": "depth", "label": "Temperature", "color": (0.3, 0.4, 0.5), "linewidth": 2, "axis": "primary"}
salinity style:{"x_col": <placeholder>, "y_col": "depth", "label": "Salinity", "color": (0.6, 0.1, 0.15), "linewidth": 2, "axis": "secondary"}

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
