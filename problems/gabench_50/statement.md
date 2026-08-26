# Hydrological Analysis

## Task
Your task is analyzing the hierarchical structure of the river network using the Strahler stream ordering method. Starting from a hydrologically corrected DEM, first generate the stream network raster by calculating flow direction and accumulation. Then, apply the Strahler ordering algorithm to assign a hierarchy level to each stream segment, where 1st order streams are headwaters and order increases only at intersections of same-order streams. Finally, visualize the result using a categorical colormap and save the map as 'Strahler_Order.png'.

## Data
dataset/dem_filled.tif: Raster data (Filled Digital Elevation Model) with depressions removed to ensure hydrological connectivity

## Expected deliverable style
style: {"cmap": "Set1", "legend": True, "legend_label": "Stream Order"}

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
