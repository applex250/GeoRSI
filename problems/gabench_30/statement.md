# Hydrological Analysis

## Task
Your task is analyzing the impact of land subsidence on flooding based on future elevation data of the study area. You will calculate the flood damage to building in the future given the elevation of sea level in 2050 and shapefile of study area. You need find the flood depth given the elevation and a design water level of -200. Then you will filter and select the buildings within the flooded area. The final goal is summarizing the flood depth in each building area and calculate the final flood damage. Finally, visualize the results and save the output as "Damage_Costs.png".

## Data
dataset/Elevation_2050.tif: Raster file for storing predicted flood evelation in 2050.
dataset/StudyAreaBuildings.shp: Polygon Shapefile for shape and features of buildings in the study area.

## Expected deliverable style
Flood Damage style: {"column": <placeholder>, "cmap": "YlOrRd", "edgecolor": "black", "linewidth": 0.1, "legend": True, "legend_kwds": {"label": "Damage Costs ($)", "orientation": "vertical"}}

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
