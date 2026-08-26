# Hydrological Analysis

## Task
Your task is analyzing the impact of land subsidence on flooding based on future elevation data of the study area with a design water level of -200. Identify flood-prone areas and estimate potential building damage to support urban planning and mitigation strategies. Save the results to "flooding_analysis.png".

## Data
dataset/Elevation_2050.tif: Raster file for storing predicted flood elevation in 2050.
dataset/StudyAreaBuildings.shp: Polygon Shapefile for shape and features of buildings in the study area.

## Expected deliverable style
flood depth style:{"label": "Flood Depth", "cmap": "Blues", "alpha": 0.6, "colorbar": True}
buildings style:{"facecolor": "none", "edgecolor": "red", "linewidth": 0.5, "alpha": 0.8, "label": "Buildings"}

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
