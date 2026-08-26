# Raster Spatial Analysis

## Task
Your task is integrating ruggedness, road distance, land cover, and protected status into a single cost surface. Assign weights to each criterion—specifically, weight 1.0 for road distance, 1.25 for ruggedness, 1.0 for protected status, and 1.25 for land cover—to create a comprehensive habitat suitability map. Save the composite cost surface as "mountainLionCorridor.png".

## Data
dataset/landCover_reclassified.tif: GeoTiff file storing the reclassified and normalized landcover types.
dataset/Protected_Status_reclassified.tif: GeoTiff file storing the reclassified Protected status in 5 levels as well as the null data.
dataset/distance.tif: GeoTiff file storing the distance of each location to the nearest mountain lion habitats.
dataset/ruggedness.tif: GeoTiff file storing the calculated ruggedness of the area.

## Expected deliverable style
style: {"cmap": "viridis", "legend": True}

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
