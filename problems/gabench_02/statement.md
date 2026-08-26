# Vector Spatial Analysis

## Task
Your task is performing analysis on public transit access in Hamilton County Tennessee. The goal is to map out existing bus stops service area with enriched map layers for different census blocks, including poverty, population density, and accessibility to a vehicle. You should overlay the three demographical factors with the bus service area using different transparent color schemes. Visualizing the resulting data as "transit_access.png".

## Data
dataset/BusServiceArea.geojson: Geojson file stores the bus stop service areas in polygons
dataset/HamiltonDemographics.geojson: Geojson file that stores census block demographic information in polygons. 'populationToPolygonSizeRating' column represents population density. 'households_ACSHHBPOV' represents poverty rate. 'AtRisk_ACSOVEH0' represents population without ownership to vehicles.

## Expected deliverable style
population density style:{"column": <placeholder>, "cmap": "Greens", "linewidth": 0.1, "alpha": 0.5, "label": "Population Density"}
no vehicle access style:{"column": <placeholder>, "cmap": "Blues", "linewidth": 0.1, "alpha": 0.5, "label": "No Vehicle Access"}
poverty households style:{"column": <placeholder>, "cmap": "Reds", "linewidth": 0.1, "alpha": 0.5, "label": "Poverty Households"}
bus service area style:{"color": "none", "edgecolor": "black", "linewidth": 1.5, "label": "Bus Service Area"}

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
