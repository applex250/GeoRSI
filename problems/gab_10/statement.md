# Analyze the potential impact of proposed roads on local environment

## Instruction
Your task is predicting the effect of future proposed roads on the deforestation of in the Brazilian state of Rond么nia. A planned road network will be added to Rond么nia, create a buffer zone of 5.5km around the new roads. Visualize the change created by the roads with the planned roads, existing roads, deforested area, and protected forest along with the boundary of Rond么nia. Save the output as "pred_results/predictedRiskyArea.png".

## Domain knowledge
"Buffer" creates buffer polygons or zones around input geometry features to a specified distance.

Clip points, lines, or polygon geometries to the mask extent.  "Clip" is used to cut out a piece of one map layer using one or more of the features in another layer.

The Overlay toolset contains tools to overlay multiple feature classes to combine, erase, modify, or update spatial features, resulting in a new feature class. The "overlay" function manipulations two feature layers using the language of sets 閳?intersection, union, difference and symmetrical difference.

## Data
dataset/roads.geojson: Linestring Geojson file storing the current road map in Brazilian state of Rond么nia.
Status columns include values such as "Official", "Unofficial".
Column of dataset/roads.geojson:
OBJECTID        Name        Status        Shape_Length        geometry

dataset/deforestedArea.geojson: Polygon Geojson file include the entire deforested area as one row of polygon.

Columns of dataset/deforestedArea.geojson:
OBJECTID        Shape_Length        Shape_Area        geometry

dataset/protectedForest.geojson: Polygon Geojson file storing mutiple natural reservation areas.
Columns of dataset/protectedForest.geojson:
OBJECTID_1        Name        Category        Jurisdiction        Created        Shape_Length        Shape_Area        geometry

dataset/planned_road.geojson: One row of proposed road in the future urban planning process, saved in linestring Geojson format/
Columns of dataset/planned_road.geojson
OBJECTID        Shape_Length        Name        Status        geometry

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
