# 3D Modeling and Analysis

## Task
To calculate tsunami travel time, set up your project with bathymetric and coastal data, then identify the tsunami origin. Simulate wave travel over the bathymetric surface to create an arrival time map. Visualize and analyze the results, and save the final visualization as "TsunamiRiskMap.png".

## Data
dataset/AtlanticDEM.tif: A raster Digital Elevation Model (DEM) representing bathymetry (seafloor depth) of the Atlantic Ocean. This dataset is essential for modeling tsunami wave propagation, as ocean depth directly influences wave speed and travel time.
dataset/TsunamiPaths.shp: A polyline shapefile containing precomputed tsunami travel paths and associated attributes. It is used to visualize and analyze potential tsunami wave routes and their estimated arrival characteristics along coastal regions.

## Expected deliverable style
elevation background style: {"cmap": "terrain", "alpha": 0.6}
tsunami travel time style: {"column": <placeholder>, "cmap": "viridis", "linewidth": 3, "legend": True, "legend_kwds": {"label": "Travel Time (Hours)"}}

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
