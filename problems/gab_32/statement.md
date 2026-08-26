# Find optimal corridors to connect dwindling mountain lion populations.

## Instruction
Your task is to find the optimal path between mountain lion habitats given the local roads, land cover, elevations, and protected status data. You need to calculate the cost of elevation(ruggedness), distances to road and assign right values and reclassify land cover types and protected status. Then you will add them together with different weights. Finally, you will find the optimal region connections using the final cost layer and habitat information. Visualize and save the final output as "optimal_path.png".

## Domain knowledge
Distance Accumulation: Arcgis Pro tool that calculates accumulated distance for each cell to sources.

Focal Statistics: Arcgis Pro tool that calculates the statistics within a given area.

Weighted Sum:The Raster Calculator tool allows you to create and run map algebra expressions in a tool.  The map algebra expressions allow users to enter mathematical (addition, division, and so on) and logical (greater than, equal to, and so on) operators in the expression to operate on raster layers. The general structure of a map algebra statement is an assignment operator (=), which is used to separate the action to its right from the name of the output (a raster object) to its left. The input raster layers need to have same size (col, row).

Optimal Region Connections:Arcgis tool that calculates optimal connectivity network between two or more input regions.

## Data
dataset/landCover.tif: GeoTiff file storing the landcover types defined by National Land Cover Database
Shape of dataset/landcover.tif: (2494, 3062)

dataset/Protected_Status.tif: GeoTiff file storing the Protected status in 5 levels as well as the null data.
Shape of dataset/Protected_Status.tif: (2494, 3062)

dataset/Elevation.tif: GeoTiff file storing the elevation data.
Shape of dataset/Protected_Status.tif: (2494, 3062)

dataset/Roads.geojson: Geojson file storing major roads.

dataset/habitat.geojson: Geojson file storing major habitats for mountain lions.

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
