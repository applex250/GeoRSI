# Raster Spatial Analysis

## Task
Your task is standardizing land cover datasets for consistency in analysis for mountain lion habitat. Reclassify this categorical dataset to a common scale using geospatial tools, and visualize the reclassified results, saving them as "reclassified_landCover.png".
The land cover data are reclassified according to the following mapping: 11 (Open Water) → 10, 21 (Developed, Open Space) → 8, 22 (Developed, Low Intensity) → 7, 23 (Developed, Medium Intensity) → 8, 24 (Developed, High Intensity) → 9, 31 (Barren Land) → 6, 41 (Deciduous Forest) → 2, 42 (Evergreen Forest) → 1, 43 (Mixed Forest) → 2, 52 (Shrub/Scrub) → 3, 71 (Grassland/Herbaceous) → 3, 72 (Sedge/Herbaceous) → 3, 81 (Hay/Pasture) → 4, 82 (Cultivated Crops) → 6, 90 (Woody Wetlands) → 4, 95 (Emergent Herbaceous Wetlands) → 4, and 255 (NoData or undefined) → 10.
These reclassification schemes align the original categorical values to a unified scale suitable for mountain lion habitat suitability modeling.

## Data
dataset/landCover.tif: GeoTiff file storing the landcover types defined by National Land Cover Database

## Expected deliverable style
style:{"cmap": "tab20", "legend": True}

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
