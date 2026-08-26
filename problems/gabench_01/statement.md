# Geostatistical Analysis

## Task
Your task is analyzing urban heat using Kriging interpolation techniques. The analysis should focus on understanding spatial patterns of urban heat islands by using point temperature data and interpolating these values across a city. You will have to use a demographic layer to extract and enhance the data visualization on the elder group. The goal is to apply the Kriging method to predict temperature across the urban area, and generate a choropleth map showing the average interpolated temperature surface in each census block group.  Highlighting areas with interpolated temperatures greater than 60 and elderly population densities exceeding 100,000.  The final output should be saved as "interpolated_urban_heat.png".

## Data
dataset/Temperature.geojson: Geojson file that stores temperature at different coordinates as points. 'TemperatureF'' Column stores the temperature information in Fahrenheit.
dataset/CensusBlock.geojson: Geojson file that stores the census block of Madison as polygons. "Block_Groups_Over65Density" column stores the density of the elderly population per census block.

## Expected deliverable style
heat distribution style:{"column": <placeholder>, "cmap": "OrRd", "alpha": 0.9, "label": "Heat Distribution"}
high risk areas style:{"facecolor": "none", "edgecolor": "blue", "linewidth": 2, "label": "High Risk Areas (>60F, Dense Elderly)"}

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
