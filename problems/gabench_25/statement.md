# Raster Spatial Analysis

## Task
Your task is to identify groundwater-vulnerable areas that require protection. First, project mc_soils.shp, mc_boundary.shp, and mc_land_cover.tif to the Lambert Conformal Conic projection (EPSG:32126). Next, using mc_boundary.shp as the processing extent and mc_land_cover.tif as both the cell size and snap raster, extract drainage conditions and water depth from mc_soils.shp as raster layers. Use these two rasters to perform suitability modeling and calculate the vulnerable_areas. Finally, visualize the resulting vulnerable areas and save the map as "vulnerable_areas.png".
Suitability modeling is an analytical process used to identify the optimal location or suitability of geographic areas. It generally consists of three steps: data preparation, data reclassification, and weighted overlay. 
For preparation: Polygon data needs to be converted into Raster before suitability modeling.
For reclassification: The reclassification of drainage_conditions is [[1, 3], [2, 1], [3, 4], [4, 5], [5, 2]]. The reclassification of water_depth is [[0, 10, 5], [10, 33, 4], [33, 61, 3], [61, 80, 2], [80, 92, 1]].
For weighted overlay: vulnerable_areas = drainage_conditions * 5 + water_depth * 4

## Data
dataset/mc_soils.shp: In this shapefile, three fields are important in groundwater analysis: Drainage Class – Dominant Conditions, Hydrologic Group – Dominant Conditions, and Water Table Depth – Annual – Minimum.
When converting the drainage class to raster, the following mapping is used to assign numeric values:{"well drained": 1, "moderately well drained": 2, "somewhat poorly drained": 3, "poorly drained": 4, "very poorly drained": 5}
dataset/mc_boundary.shp: This shapefile contains the polygon region of study area.
dataset/mc_land_cover.tif: Raster file showing the land cover of study area, one band.

## Expected deliverable style
style: {"cmap": "inferno", "legend": True}

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
