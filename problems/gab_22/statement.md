# Find optimal corridors to connect dwindling mountain lion populations.

## Instruction
Your task is integrating ruggedness, road distance, land cover, and protected status into a single cost surface. Assign weights to each criterion to create a comprehensive habitat suitability map. Save the composite cost surface as "pred_results/mountainLionCorridor.png".

## Domain knowledge
The Raster Calculator tool allows you to create and run map algebra expressions in a tool.  The map algebra expressions allow users to enter mathematical (addition, division, and so on) and logical (greater than, equal to, and so on) operators in the expression to operate on raster layers. The general structure of a map algebra statement is an assignment operator (=), which is used to separate the action to its right from the name of the output (a raster object) to its left. The input raster layers need to have same size (col, row).

Weight of each layer:
distance: 1
ruggedness: 1.25
ProtectedStatus: 1
landCover: 1.25

## Data
dataset/landCover_reclassified.tif: GeoTiff file storing the reclassified and normalized landcover types.
Shape of dataset/landcover_reclassified.tif: (2494, 3062)

dataset/Protected_Status_reclassified.tif: GeoTiff file storing the reclassified Protected status in 5 levels as well as the null data.
Shape of dataset/Protected_Status_reclassified.tif: (2494, 3062)

dataset/distance.tif: GeoTiff file storing the distance of each location to the nearest mountain lion habitats.
Shape of dataset/distance.tif: (2494, 3062)

dataset/ruggedness.tif: GeoTiff file storing the calculated ruggedness of the area.
Shape of dataset/ruggedness.tif: (2494, 3062)

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
