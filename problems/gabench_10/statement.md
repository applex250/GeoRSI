# Vector Spatial Analysis

## Task
Your task is to predict the effect of future proposed roads on deforestation in the Brazilian state of Rondônia. A planned road network will be added to Rondônia; create a 5.5 km buffer zone around these new roads. Visualize the potential impact by overlaying the planned roads, existing roads, deforested areas, protected forests, and the administrative boundary of Rondônia. Save the output map as "predictedRiskyArea.png".
Note: If any input GeoJSON file does not explicitly define a coordinate reference system (CRS), assume and assign it as WGS84 (EPSG:4326).

## Data
dataset/roads.geojson: A LineString GeoJSON file storing the current road network in the Brazilian state of Rondônia.
dataset/deforestedArea.geojson: A Polygon GeoJSON file containing the entire deforested area in Rondônia as a single polygon feature.
dataset/protectedForest.geojson: A Polygon GeoJSON file storing multiple legally designated natural reserve or protected forest areas in Rondônia.
dataset/planned_road.geojson: A LineString GeoJSON file containing a single proposed road from future urban planning documents.

## Expected deliverable style
protected forest style: {"color": "green", "label": "Protected Forest"}
roads style: {"color": "grey", "label": "Roads"}
 risky area style: {"color": "red", "label": "Risky Area"}
proposed road style: {"color": "yellow", "label": "Proposed Road"}

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
