# Find the deforestation rate for Rond么nia

## Instruction
Your task is finding the deforestation rate for Brazilian state of Rond么nia. The goal is calculating the deforestation area percentage in the Rond么nia within the buffer zone of 5.5km around road layers. Save the percentage result in a CSV file named "pred_results/deforestation_rate.csv" with a column title percentage_deforestation.

## Domain knowledge
"Buffer" creates buffer polygons or zones around input geometry features to a specified distance in GIS. 

Clip points, lines, or polygon geometries to the mask extent.  "Clip" is used to cut out a piece of one map layer using one or more of the features in another layer.

## Data
dataset/roads.geojson: Linestring Geojson file storing the current road map in Brazilian state of Rond么nia.
Status columns include values such as "Official", "Unofficial".
Column of dataset/roads.geojson:
OBJECTID        Name        Status        Shape_Length        geometry


dataset/deforestedArea.geojson: Polygon Geojson file include the entire deforested area as one row of polygon.

Columns of dataset/deforestedArea.geojson:
OBJECTID        Shape_Length        Shape_Area        geometry

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
