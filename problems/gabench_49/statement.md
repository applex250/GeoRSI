# Hydrological Analysis

## Task
Your task is extracting and vectorizing the stream network from a hydrologically corrected DEM. First, calculate flow direction and flow accumulation to identify areas of high runoff concentration. Next, apply a threshold to the accumulation raster to define the stream network raster. Then, convert the raster streams into a vector shapefile. Finally, visualize the extracted river network over the accumulation map and save the result as 'Vector_Stream_Network.png'

## Data
dataset/dem_filled.tif: Raster data (Filled Digital Elevation Model) with depressions removed to ensure hydrological connectivity

## Expected deliverable style
style: {"color": "blue", "linewidth": 1.0, "legend": True}

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
