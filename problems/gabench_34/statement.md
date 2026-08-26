# Raster Spatial Analysis

## Task
Your task is to analyze changes in malaria prevalence among children aged 2–10 in Sub-Saharan Africa from 2000 to 2015. Using raster data from the Malaria Atlas Project, calculate the difference between the prevalence rates in 2015 and 2000 using the Minus raster function (i.e., 2015 minus 2000). Then, visualize the resulting change in malaria prevalence with a diverging color scheme (e.g., blue for decreases, red for increases) and adjust the symbology to clearly highlight areas where malaria prevalence has increased or decreased. Finally, save the visualization as "Malaria_Change.png"

## Data
dataset/2015_Nature_Africa_PR.2000.tif: GeoTIFF raster file storing malaria prevalence rates among children aged 2–10 in Sub-Saharan Africa for the year 2000.
dataset/2015_Nature_Africa_PR.2015.tif: GeoTIFF raster file storing malaria prevalence rates among children aged 2–10 in Sub-Saharan Africa for the year 2015.

## Expected deliverable style
style: {"cmap": "RdBu_r","vmin": -1.0,"vmax": 1.0,"legend": True,"legend_label":"Change in Prevalence"}

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
