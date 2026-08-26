# Vector Spatial Analysis

## Task
To promote sustainable development in the nation's rural areas, your task is estimating access to all-season roads. First, you'll add population and road data and limit your study area to rural regions. With the shape of rural area, you will clip the regional population of the rural areas.Then, you'll create a 2-kilometer buffer around all-season roads and clip the rural area out.  The final goal is calculating the percentage of the rural population within that buffer to get the percentage of population in the rural area that has access to roads in 2km. Finally, visualize the population percentage in each rural area with a choropleth map. Save the result as "accessibility.png".

## Data
dataset/ShikokuMetropolitan.geojson: Geojson file that stores the shape and features for towns in Shikoku area of Japan as polygons. Area type indicate whether an area is rural.
dataset/AllSeasonRoads.geojson: Geojson file that stores all season emergency roads in Shikoku area as lines.
dataset/ShikokuPopulation.geojson: Geojson file that stores the shape and features for areas in Shikoku. D0001 columns refers to population of that area in 2015.

## Expected deliverable style
population proportion style: {"column": <placeholder>, "cmap": "Greens", "legend": True, "vmin": 0, "vmax": 1.0, "legend_kwds": {"label": "Access Proportion", "orientation": "vertical"}}
roads style: {"color": "black", "linewidth": 0.5, "label": "Roads"}

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
