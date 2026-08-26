# Vector Spatial Analysis

## Task
Your task is using the distribution data data about San Francisco street trees and shapefiles of administrative regions to analyze the tree species NULL percentage in different regions. Visualize the results in a quadtree format map. Save the figure as 'trees_count_vis.png'.

## Data
dataset/street_trees_sample.geojson: Point Geojson file storing tree sample locations along with their species information.
dataset/sfo_boroughs.geojson: One row of polygon Geojson file storing boroughs in the San Francisco.

## Expected deliverable style
tree density style: {"column": "<placeholder>","cmap": "Greens","legend": True,"scheme": "Quantiles","k": 5,"edgecolor": "white","linewidth": 1, "label": "Tree Density"}
boroughs style: {"facecolor": "none","edgecolor": "gray","linewidth": 1,"zorder": 2, "label": "Boroughs"}

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
