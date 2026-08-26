# Calculate impervious surface area

## Instruction
Your task is calculating impervious surface area through the impervious area and lands parcel. Use tabulate area to get the area count, and join the area with land parcels, copy and save the joint result.

## Domain knowledge
Tabulate area calculate the area through the impervious raster and the land parcels. Then use add join function to combine the tabulate area result with land parcels.

## Data
dataset/parcels.shp: The parcels of land in the neighborhood.
dataset/impervious.tif: Raster file contains the impervious rates of the whole study area.

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
