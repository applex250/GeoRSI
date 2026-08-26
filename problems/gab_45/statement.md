# Find optimal corridors to connect dwindling mountain lion populations.

## Instruction
Your task is to evaluate mountain lion habitat suitability by calculating terrain ruggedness from elevation data. The analysis applies focal statistics with a 3x3 moving window to measure terrain variation, followed by rescaling to standardize the ruggedness values. The results are saved in the geodatabase.

## Domain knowledge
Terrain Ruggedness Index (TRI) expresses the amount of elevation difference between adjacent cells of a DEM. The TRI function measures the difference in elevation values from a center cell and eight cells directly surrounding it. Then, the eight elevation differences are squared and averaged. The square root of this average results is a TRI measurement for the center cell. This calculation is then conducted on every cell of the DEM.

Distance Accumulation: Calculates accumulated distance for each cell to sources, allowing for straight-line distance, cost distance, and true surface distance, as well as vertical and horizontal cost factors.

Focal Statistic: Calculates for each input cell location a statistic of the values within a specified neighborhood around it.

Rescale by Function: Rescales the input raster values by applying a selected transformation function and transforming the resulting values onto a specified continuous evaluation scale.

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
