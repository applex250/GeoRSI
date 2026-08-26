# Geostatistical Analysis

## Task
Your task is to perform spatial autocorrelation analysis on airbnb prices in Berlin. The analysis involves loading geospatial data of Berlin neighborhoods and real estate listings. You will perform a spatial join to associate listings with neighborhoods and calculate the median price for each neighborhood group. After handling missing data, you will analyze spatial similarity by creating a spatial weights matrix based on their median prices. The Local Moran's I statistic will be used to identify significant cold spots and hot spots. Finally, you will visualize these spatial patterns on a map, highlighting areas with significant spatial autocorrelation, and save the output as "moran_local.png".

## Data
dataset/berlin_neighbourhoods.geojson:Geojson file for multipolygons of neighbourhoods in Berling
dataset/berlin_listings.csv: Csv file of Berling Airbnb information, with lat and lng of Airbnb.

## Expected deliverable style
style: {"column": <placeholder>,"categorical": True,"cmap": "Set1","linewidth": 0.1,"edgecolor": "white","legend": True, "legend_kwds": {"title": "Cluster Type"}}

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
