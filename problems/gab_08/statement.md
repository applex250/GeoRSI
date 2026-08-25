# Find gap for Toronto fire station service coverage.

## Instruction
Your task is analyzing Toronto fire stations and their service coverage. The goal is visualize the current fire station coverage in Etobicoke by buffering to identify coverage gaps. Save the figure as "pred_results/Fire_Service_Analysis.png".

## Domain knowledge
"Service Area" or "Service Coverage" is a region that encompasses all accessible locations within the study area. It is usually used to identify how much land, how many people, or how much of anything else is within the neighborhood or a region and served by certain facilities.

The Overlay toolset contains tools to overlay multiple feature classes to combine, erase, modify, or update spatial features, resulting in a new feature class. The "overlay" function manipulations two feature layers using the language of sets, intersection, union, difference and symmetrical difference.

"Buffer" creates buffer polygons or zones around input geometry features to a specified distance in GIS.

## Data
dataset/etobicoke.geojson: Polygon Geojson file for neighborhood region for Etobicoke.

Columns of dataset/etobicoke.geojson
'OBJECTID_1', 'LCODE_NAME', 'SECTION', 'DISTRICT', 'DIVISION',
       'OBJECTID', 'Shape_Length', 'Shape_Area', 'geometry'

dataset/fire_stations.geojson: Point Geojson file for current fire stations distribution as points.

Columns of dataset/fire_stations.geojson:
'OBJECTID_1', 'NAME', 'ADDRESS', 'WARD_NAME', 'MUN_NAME', 'geometry

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
