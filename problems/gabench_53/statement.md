# Raster Spatial Analysis

## Task
Your task is performing a random forest prospectivity analysis for tin-tungsten deposits in Tasmania. The analysis should focus on training and evaluating a model using tools on some mineral ocurrence point data and geo-related evidence raster layers. Your goal is to load and inspect the data, build a random forest classifier model to calculate the performance metrics. The final auc should be at least 0.9.

## Data
dataset/sn_w_minoccs.gpkg: gpkg file storing point data of mineral ocurrence, similar to point Geojson file.
Several GeoTIFF files with geo-related evidence raster layers:
dataset/tasgrav_IR_1VD.tif
dataset/tasgrav_IR.tif
dataset/tasmag_TMI_1VD.tif
dataset/tasmag_TMI.tif
dataset/tasrad_K_pct.tif
dataset/tasrad_Th_ppm.tif
dataset/tasrad_U_ppm.tif

## Expected deliverable style


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
