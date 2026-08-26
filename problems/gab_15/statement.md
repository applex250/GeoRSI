# Understand the geographical distribution of Total Electron Content (TEC) in the ionosphere.

## Instruction
Your task is analyzing the distribution of Total Electron Content. Load Total Electron Content (TEC) data from a space weather NetCDF file and visualize it as a filled contour map with a geographical and coastline background. Save the figure as 'pred_results/TEC_vis.png'.

## Domain knowledge
matplotlib.pyplot.contour() draw contour lines while matplotlib.pyplot.contourf() draw filled contours. NetCDF (Network Common Data Form) files are commonly used to store multi-dimensional scientific data such as temperature, humidity, wind speed, etc.

## Data
dataset/space_weather.nc: Total ELectron Content data in netCDF format.

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
