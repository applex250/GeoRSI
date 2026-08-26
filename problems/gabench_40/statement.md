# Geostatistical Analysis

## Task
Your task is to predict seagrass habitats with machine learning methods. First, dissolve the USA seagrass layer and generate 5,000 random points within the dissolved polygon. Then, use the Empirical Bayesian Kriging (EBK) geostatistical method to interpolate raster surfaces for the environmental variables—temperature and salinity—stored in the Global ocean measurements point layer, processing each variable separately. Finally, use the two resulting kriging rasters as explanatory variables in a presence-only habitat suitability model (MaxEnt). The outputs should include the training feature data and the predicted seagrass habitat raster. Visualize the final seagrass prediction raster as "seagrass_prediction.png".

## Data
dataset/Global_ocean_measurements.shp: Ecological Marine Units point data that contains ocean measurements up to a 90-meter water depth.
dataset/Global_shallow_waters.shp: Global shallow bathymetry polygon used to predict seagrass globally.
dataset/USA_seagrass.shp: For seagrass occurrence, every polygon in USA seagrass is an identified seagrass habitat.
dataset/USA_shallow_waters.shp: Shallow bathymetry polygon for the continental United States used as the study area for model training.

## Expected deliverable style
style: {"cmap": "YlGn", "legend": true, "legend_label": "Habitat Suitability Probability"}

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
