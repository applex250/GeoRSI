# Calculate Travel Time for a Tsunami

## Instruction
To calculate tsunami travel time, set up your project with bathymetric and coastal data, then identify the tsunami origin. Simulate wave travel over the bathymetric surface to create an arrival time map. Visualize and analyze the results, adjust for accuracy, and prepare a report to aid in preparedness and response planning.

## Domain knowledge
To calculate tsunami speed using 鈭?g*d) , where d is ocean depth, you'll need positive depth values. Since AtlanticDEM has negative values for ocean depths (below sea level), you'll modify the expression to invert these values, making ocean areas positive for accurate calculations.
Geodetic Densify creates new features by replacing the segments of the input features with densified approximations of geodesic segments. 
Extract by Mask tool is used to extract cell values from a raster using the shape of a feature or another raster as a mask.

## Data
dataset/AtlanticDEM.lyrx: A DEM layer representing Atlantic Ocean bathymetry, essential for analyzing how ocean depth affects tsunami wave propagation. Raster data
dataset/Tsunami Paths.lyrx:
A layer showing precomputed tsunami travel paths and travel times, used to visualize and analyze tsunami wave routes and their impact on coastal areas. Attributes: OBJECTID, Shape, lengthkm, Shape_Length, Route

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
