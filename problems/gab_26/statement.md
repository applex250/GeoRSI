# Use drainage conditions and water depth to calculate groundwater vulnerable areas.

## Instruction
Your task is to calculate groundwater vulnerable areas using the Arcpy. First, project 'mc_land_cover.tif' and 'mc_soils.shp' to Lambert Conformal Conic. Next, using 'mc_boundary.shp' as the extent, land_cover as the cellSize and snapRaster, extract the drainage_conditions and water_depth respectively from 'mc_soils.shp'. Then, use drainage_conditions and water_depth to perform suitability modeling to calculate vulnerable_areas.

## Domain knowledge
Suitability modeling is an analytical process used to identify the optimal location or suitability of geographic areas. It generally consists of three steps: data preparation, data reclassification, and weighted overlay. In ArcGIS Pro, suitability modeling is implemented through an integrated Modeler, but in Arcpy, it needs to be carried out step by step using basic functions.

For preparation:
Polygon data needs to be converted into Raster before suitability modeling.

For reclassification:
The reclassification of drainage_conditions is [[1, 3], [2, 1], [3, 4], [4, 5], [5, 2]].
The reclassification of water_depth is [[0, 10, 5], [10, 33, 4], [33, 61, 3], [61, 80, 2], [80, 92, 1]].

For weighted overlay:
vulnerable_areas = drainage_conditions * 5 + water_depth * 4

## Data
dataset/mc_soils.shp: In this shapefile, three fields are important in groundwater analysis: Drainage Class 鈥?Dominant Conditions, Hydrologic Group 鈥?Dominant Conditions, and Water Table Depth 鈥?Annual 鈥?Minimum.
Key Fields:
'FID', 'Shape', 'AREASYMBOL', 'SPATIALVER', 'MUSYM', 'MUKEY', 'drclassdcd', 'hydgrpdcd', 'wdepannmin'

dataset/mc_boundary.shp: This shapefile contains the polygon region of study area.
Key Fields:
'FID', 'Shape', 'OBJECTID_1', 'AREA', 'PERIMETER', 'BLMCNTYO_', 'BLMCNTYO_I', 'COUNTY_NAM', 'COBCODE'

dataset/mc_land_cover.tif: Raster file showing the land cover of study area, one band.

## How to submit
1. Analyze the data with python (write scripts, run_python; use start_job for
   anything longer than a couple of minutes).
2. Produce the outputs the instruction asks for (figures/maps as files).
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {
     "key_values": {"<descriptive label>": <number>, ...},
     "output_files": ["<filename you created>", ...],
     "summary": "<2-3 sentences: method and main findings>"
   }
   key_values: every important numeric result you computed, with clear labels.
   output_files: the figures/maps you saved (relative filenames).

## Grading
Your key numeric results are compared against an expert reference (labels do
not need to match; values matter, small tolerance). Output files must exist.
