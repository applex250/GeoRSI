# Geostatistical Analysis

## Task
Yout task is analyzing and visualizing Elk movements in the given dataset. The goal is to estimate home ranges and assess habitat preferences using spatial analysis techniques, including Minimum Bounding Geometry (Convex Hull), Kernel Density, and Density-based Clustering(DBSCAN). You should identify the spatial clusters of Elk movements and overlay the findings with maps and visualizations. Save the final output as "Elk_Analysis.png".

## Data
dataset/Elk_in_Southwestern_Alberta_2009.geojson: geojson files for storing points of Elk movements in Southwestern Alberta 2009.

## Expected deliverable style
density style:{"label": "Density", "cmap": "viridis", "alpha": 0.6, "colorbar": True}
convex hull style:{"facecolor": "none", "edgecolor": "red", "linewidth": 1.0, "alpha": 0.8, "label": "Convex Hull"}
clusters style:{"color": "orange", "alpha": 0.6, "label": "Clusters", "markersize": 5}

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
