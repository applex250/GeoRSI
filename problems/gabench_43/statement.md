# 3D Modeling and Analysis

## Task
Your task is processing 3D building data to create a unified 2D coverage map. First, flatten the 3D polygons to generate 2D footprints, then dissolve them into a unified layer to eliminate overlaps. Finally, visualize the merged geometry and save the result as 'buildings_viz.png'.

## Data
dataset/building.shp: MultiPatch data (representing buildings as 3D solids)

## Expected deliverable style
style: {"color": "lightblue", "edgecolor": "blue", "alpha": 0.7}

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
