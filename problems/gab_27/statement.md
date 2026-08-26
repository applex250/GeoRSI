# Identify undeveloped areas from groundwater risk zones.

## Instruction
Your task is to identify those high risk zones of groundwater vulnerable areas that need protection using the Arcpy. First, use vulnerable_areas and land_cover to perform suitability modeling to calculate risk_zones. Next, filter out high_risk_zones, and then undeveloped_areas based on risk_zones, and save the result to 'output/undeveloped_areas.tif'.

## Domain knowledge
Suitability modeling is an analytical process used to identify the optimal location or suitability of geographic areas. It generally consists of three steps: data preparation, data reclassification, and weighted overlay. In ArcGIS Pro, suitability modeling is implemented through an integrated Modeler, but in Arcpy, it needs to be carried out step by step using basic functions.

The reclassification of vulnerable_areas is standardization to [1, 10].
The reclassification of land_cover is [[11, 1],[21, 6],[22, 7],[23, 8],[24, 10],[31, 4],[41, 3],[42, 1],[43, 3],[52, 3],[71, 2],[81, 5],[82, 9],[90, 1],[95, 1]].

risk_zones = vulnerable_areas * 8 + land_cover * 10

Undeveloped areas in the high risk zones (risk_zones > 100) need more protection. Seek for the areas in land_cover masking high risk zone, use the following rule: where_clause="Class IN ('Deciduous Forest', 'Emergent Herbaceous Wetlands', 'Hay/Pasture', 'Herbaceous', 'Mixed Forest', 'Shrub/Scrub', 'Woody Wetlands', 'Barren Land')"

## Data
dataset/vulnerable_areas.tif: Raster file showing the whole groundwater vulnerable areas of study area, one band.

dataset/land_cover.tif: Raster file showing the land cover of study area, one band.

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
