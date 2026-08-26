# Geostatistical Analysis

## Task
Your task is to model water quality using spatial interpolation techniques. The analysis should focus on understanding spatial patterns of water quality by using point sample data and interpolating these values across a broader area, including unsampled locations. Your goal is to load the water quality sample data and apply Kernel Density Estimation (KDE) as the interpolation method to predict water quality across the region. The final output should be a map showing the KDE-interpolated water quality surface, saved as "interploated_water_quality.png".

## Data
dataset/DissolvedO2.geojson: Point Geojson file storing sampled O2 data in different area of the given bay area.
dataset/Bay.geojson: One row of Multipolygon Geojson file storing the shape of the Bay area.

## Expected deliverable style
dissolved O2 style:{"cmap": "Spectral", "label": "Dissolved O2", "colorbar": True}
bay boundary style:{"facecolor": "none", "edgecolor": "white", "linewidth": 2, "label": "Bay Boundary"}

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
