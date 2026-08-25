# Find future bus stop locations in Hamilton, Tennessee

## Instruction
Your task is performing analysis on public transit access in Hamilton County Tennessee. The goal is to map out existing bus stops鈥榮 service area with enriched map layers for different census blocks, including poverty, population density, and accessibility to a vehicle. You should overlay the three demographical factors with the bus service area using different transparent color schemes. Visualizing the resulting data as "pred_results/transit_access.png".

## Domain knowledge
The Overlay toolset contains tools to overlay multiple feature classes to combine, erase, modify, or update spatial features, resulting in a new feature class. The "overlay" function manipulations two feature layers using the language of sets, intersection, union, difference and symmetrical difference.

## Data
dataset/BusServiceArea.geojson: Geojson file stores the bus stop service areas in polygons

Columns of dataset/BusServiceArea.geojson:
   OBJECTID FacilityID  ...   Shape_Area, geometry

dataset/HamiltonDemographics.geojson: Geojson file that stores census block demographic information in polygons. 'populationToPolygonSizeRating' column represents population density. 'households_ACSHHBPOV' represents poverty rate. 'AtRisk_ACSOVEH0' represents population without ownership to vehicles.

Columns of dataset/HamiltonDemographics.geojson:
OBJECTID', 'AREALAND', 'AREAWATER', 'BASENAME', 'BLKGRP', 'CENTLAT',
'CENTLON', 'COUNTY', 'FUNCSTAT', 'GEOID', 'INTPTLAT', 'INTPTLON',
'LSADC', 'MTFCC', 'NAME', 'ObjID', 'STATE', 'TRACT', 'UR', 'HU100',
'POP100', 'ALANDHIST', 'AWATERHIST', 'EFFDATE', 'ESTABDATE', 'VINTAGE',
'STGEOMETRY_AREA', 'STGEOMETRY_LEN', 'aggregationMethod', 'HasData',
'ORIGINAL_OID', 'sourceCountry', 'apportionmentConfidence',
'populationToPolygonSizeRating', 'populationtotals_TOTPOP_CY',
'households_ACSHHBPOV', 'AtRisk_ACSOVEH0', 'Shape_Length', 'Shape_Area',
'geometry'

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
