# Analyze climate change trends in North America using spatial temporal data

## Instruction
Load North America climate data in NetCDF file and extract temperature data along the time series, then perform a quadratic polynomial fit analysis on the temperature data, and output the fitting results by year in 'pred_results/polynomial_fit_pred.csv'.

## Domain knowledge
NetCDF (Network Common Data Form) files are commonly used to store multi-dimensional scientific data such as temperature, humidity, wind speed, etc.  numpy.polyfit() is a least squares polynomial fitting function. numpy.polyval() estimates polynomial Y values at specific input X values.

## Data
dataset/A1B_north_america.nc: NetCDF data of climate data and temperature data in North America.

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
