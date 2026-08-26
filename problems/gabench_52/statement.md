# Hydrological Analysis

## Task
Your task is delineating watershed basins to identify independent catchment areas within the study region. Using the D8 flow direction raster, partition the landscape into distinct basins where all connected cells drain to a common outlet. Finally, visualize the spatial relationship between the hydrological units and the river system by creating a multi-layer map. Use the generated basin raster as the semi-transparent base layer (using the 'tab20b' colormap) and overlay the provided vector stream network on top. Save the combined visualization as 'Watershed_Basins.png'.

## Data
dataset/flow_direction.tif: Raster data (D8 Flow Direction) used to trace flow paths and determine basin boundaries.
dataset/streamfea.shp: Vector line data (Stream Network) representing the river system, used for overlay visualization.

## Expected deliverable style
Watershed Basins style: {"cmap": "tab20b", "alpha": 0.8, "label": "Watershed Basins"}
Stream Network style: {"color": "black", "linewidth": 0.8, "label": "Stream Network"}

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
