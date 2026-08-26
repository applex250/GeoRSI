# Raster Spatial Analysis

## Task
Your task is assessing burn scars using satellite imagery and perform spatial analysis to understand the impact of wildfires. The goal is to use the satellite imagery data from 2014 and 2015 on analyzing burn scars by determining the change in Normalized Burn Ratio. Then you should generate a map that visualizes the spatial extent of the damage areas in vector data. The final output should be a visual representation of the burn scars, saved as "burn_scar_analysis.png".

## Data
dataset/G_2014.tif: Raster file of satellite imageries in 2014, taken by Landsat 8
dataset/G_2015.tif: Raster file of satellite imageries in 2015, taken by Landsat 8

## Expected deliverable style
burn severity style:{"cmap": "Reds", "label": "Burn Severity", "vmin": 0, "vmax": 0.8}
burn scar boundary style:{"facecolor": "none", "edgecolor": "black", "linewidth": 1, "label": "Burn Scar Boundary"}

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
