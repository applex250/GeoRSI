# Raster Spatial Analysis

## Task
Your task is to calculate impervious surface area by combining the impervious surface raster data with land parcel polygons. Use the Tabulate Area tool to compute the area of impervious surfaces within each parcel, then join these area statistics back to the parcel layer. Finally, visualize the resulting impervious surface distribution and save the map as "impervious_area.png".

## Data
dataset/parcels.shp: The parcels of land in the neighborhood.
dataset/impervious.tif: Raster file contains the impervious rates of the whole study area.

## Expected deliverable style
style: {"column":<placeholder>,"cmap": "Reds", "edgecolor": "black","linewidth":0.5, "legend": True, "legend_kwds": {"label": "Impervious Area (m²)"}}

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
