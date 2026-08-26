# Hydrological Analysis

## Task
Your task is performing an upstream flow length analysis to determine the distance from each cell to its flow source. Using the provided D8 flow direction raster, calculate the maximum distance along the flow path from each cell back to its upstream starting point (watershed divide). Finally, visualize the upstream flow length result using a 'Greens' colormap and save the output map as 'FlowLength_Upstream.png'.

## Data
dataset/flow_direction.tif: Raster data (D8 Flow Direction) where pixel values (1, 2, 4, ..., 128) represent the direction of flow from each cell to its steepest downslope neighbor.

## Expected deliverable style
style: {"cmap": "Greens", "legend": True, "legend_label": "Upstream Length (m)"}

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
