# Geostatistical Analysis

## Task
Your task is visualizing data about children with elevated blood lead levels in a privacy-conscious manner. First, conduct Optimized Hot Spot Analysis to identify clusters without revealing individual points. Then, apply tessellation to summarize cases within hexagonal polygons. This approach protects sensitive data while clearly representing areas with higher occurrences of elevated blood lead levels. The goal is to find the area with potential blood lead rise with specific cases saved in point files. The final output, saved as "blood_lead_hotspots_hex.png", ensures stakeholders receive relevant information without accessing specific locations

## Data
dataset/High_Blood_Level_Results.shp: This shapefile contains point data representing incidents of elevated blood lead levels in children within the study area. Each point corresponds to a specific geographic location where a blood test was conducted, and the results indicated a high concentration of lead.
dataset/Sacramento_ZIP_Codes.shp: This shapefile contains polygon data representing the boundaries of ZIP codes within Sacramento. Each polygon defines the geographic extent of a specific ZIP code.

## Expected deliverable style
hex bin counts style: {"label": "Hex Bin Counts","column": <placeholder>,"scheme": "UserDefined","classification_kwds": {"bins": [1, 2]},"cmap": "Reds","legend": True,"alpha": 0.6,"edgecolor": "black","linewidth": 0.3}
sacramento ZIP codes style: {"label": "Sacramento ZIP Codes","facecolor": "none","edgecolor": "grey","linewidth": 1}

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
