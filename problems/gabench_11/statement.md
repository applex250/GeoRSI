# Raster Spatial Analysis

## Task
Your task is performing raster analysis on the elevation and environmental factors influencing coral and sponge distribution at Catalina Island. Update the data with the slope and aspect analysis results. Use the updated data to visualize the mean slope and aspect distribution of each Coral and Sponge species in Catalina Island as "CoralandSponge.png".

## Data
dataset/CatalinaBathymetry.tif: Raster files for storing Bathymetry data in the Catalina Island area.
dataset/CoralandSpongeCatalina.geojson: Geojson file for storing Coral and Sponge species distributions as point along with their attributes.If the projection is undefined, reproject it to EPSG:4326.

## Expected deliverable style
slope style:{"ylabel": "Mean Slope (degrees)", "title": "Mean Slope per Species", "color": "b", "rotation": 45}
aspect style:{"ylabel": "Mean Aspect (degrees)", "title": "Mean Aspect per Species", "color": "g", "rotation": 45}

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
