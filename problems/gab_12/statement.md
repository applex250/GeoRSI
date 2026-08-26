# Find optimal corridors to connect dwindling mountain lion populations.

## Instruction
Your task is evaluating mountain lion habitat suitability, and the first step is calculating terrain ruggedness using elevation data. Visualizing the ruggedness and save the outputs as "pred_results/ruggedness.png".

## Domain knowledge
Terrain Ruggedness Index (TRI) expresses the amount of elevation difference between adjacent cells of a DEM. The TRI function measures the difference in elevation values from a center cell and eight cells directly surrounding it. Then, the eight elevation differences are squared and averaged. The square root of this average results is a TRI measurement for the center cell. This calculation is then conducted on every cell of the DEM. The "generic_filter" function imported from the "scipy.ndimage" package can calculate a multidimensional filter using a given "filter_range" function.

## Data
dataset/Elevation.tif: Raster files for storing elevation data.
Shape of dataset/Elevation.tif: (2494, 3062)

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
