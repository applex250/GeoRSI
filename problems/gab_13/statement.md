# Understand the relationship between ocean temperature and salinity at various depths in the South Atlantic Ocean.

## Instruction
Your task is using sea temperature and salinity data from the South Atlantic Ocean to calculate and analyze a vertical temperature-salinity profile within a specified range of latitude, longitude, and depth. Plot the profile and save the figure as 'pred_results/ocean_profiles_vis.png'.

## Domain knowledge
iris.plot is a Iris-specific package extensions to matplotlib and for handling multi-dimensional data and associated metadata. Cubes can be pattern matched and filtered according to specific criteria. Constraints are the mechanism by which cubes can be pattern matched and filtered according to specific criteria. Once a constraint has been defined, it can be applied to cubes using the Constraint.extract() method. The iris.load() function automatically recognises the format of the given files and attempts to produce Iris multidimensional Cubes from their contents.

## Data
dataset/atlantic_profiles.nc: NetCDF profile data of partial Atlantic ocean with temperature and salinity data.

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
