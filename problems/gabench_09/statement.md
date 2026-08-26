# Vector Spatial Analysis

## Task
Your task is to find the deforestation rate for the Brazilian state of Rondônia. The goal is to calculate the percentage of deforested area within a 5.5 km buffer zone around road layers in Rondônia. Optimization Requirement : Since the road network is complex and the dataset is large, please optimize the processing workflow to minimize execution time. Consider simplifying or merging geometric features before intersection analysis to avoid performance bottlenecks.
Save the percentage result in a CSV file named "deforestation_rate.csv".
Note: If any input GeoJSON file does not explicitly define a coordinate reference system (CRS), assume and assign it as WGS84 (EPSG:4326).

## Data
dataset/roads.geojson: A LineString GeoJSON file representing the current road network in the Brazilian state of Rondônia.
dataset/deforestedArea.geojson: A Polygon GeoJSON file containing the total deforested area in Rondônia as a single polygon feature.

## Expected deliverable style


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
