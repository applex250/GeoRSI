# Hydrological Analysis

## Task
Your task is analyzing the discharge magnitude of the river network using the Shreve stream ordering method. Starting from a hydrologically corrected DEM, first generate the stream network raster. Then, apply the Shreve ordering algorithm, which treats the stream network as a magnitude system where downstream orders are the sum of upstream tributaries (e.g., 1+1=2, 2+1=3). Finally, visualize the result using a spectral colormap to represent accumulation intensity and save the map as 'Shreve_Order.png'.

## Data
dataset/dem_filled.tif: Raster data (Filled Digital Elevation Model) with depressions removed to ensure hydrological connectivity

## Expected deliverable style
style: {"cmap": "jet", "legend": True, "legend_label": "Stream Magnitude"}

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
