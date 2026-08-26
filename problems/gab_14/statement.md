# Detecting persistent periods of high temperature over time in past 240 years.

## Instruction
Your task is using 240 years of annual average surface temperature data from North America to calculate and plot the number of occurrences where the temperature exceeds 280K for five consecutive years. Save the figure as 'pred_results/temperature_statistic_vis.png'.

## Domain knowledge
iris.plot is a Iris-specific package extensions to matplotlib and for handling multi-dimensional data and associated metadata.  Cubes can be pattern matched and filtered according to specific criteria. Constraints are the mechanism by which cubes can be pattern matched and filtered according to specific criteria. Once a constraint has been defined, it can be applied to cubes using the Constraint.extract() method. The iris.load() function automatically recognises the format of the given files and attempts to produce Iris multidimensional Cubes from their contents. cube.collapsed () function can collapse one or more dimensions over the cube given the coordinate/s and an aggregation.

## Data
dataset/E1_north_america.nc: NetCDF Temperature data in North America for a 240 year period.

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
