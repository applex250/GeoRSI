# Modeling spatial patterns of water quality

## Instruction
Your task is model water quality using spatial interpolation techniques in Python. The analysis should focus on understanding spatial patterns of water quality by using point sample data and interpolating these values across a broader area including unsampled locations. Your goal is to load the water quality sample data, and apply appropriate spatial interpolation methods to predict water quality across the region. The final output should be a map showing the interpolated water quality surface, saved as "pred_results/interploated_water_quality.png"

## Domain knowledge
Kernel Density Estimation (KDE) is a statistical method used in spatial analysis to estimate the probability density of a dataset. Unlike Kriging, KDE is non-parametric and does not rely on variogram modeling or assumptions about autocorrelation. It creates a smooth surface by applying a kernel function to each data point and summing their contributions over a spatial grid, making it ideal for interpolating values like water quality or species distribution without requiring strict assumptions about the data.

## Data
dataset/DissolvedO2.geojson: Point Geojson file storing sampled O2 data in different area of the given bay area.
Columns of dataset/DissolvedO2.geojson:
'OBJECTID', 'HUC8', 'EventId', 'Cruise', 'Program', 'Project', 'Agency',
       'Source', 'Station', 'SampleDate', 'TotalDepth', 'UpperPycnocline',
       'LowerPycnocline', 'Depth', 'Layer', 'SampleType',
       'SampleReplicateType', 'Parameter', 'Qualifier', 'MeasureValue', 'Unit',
       'Method', 'Lab', 'Problem', 'PrecisionPC', 'BiasPC', 'Details',
       'Latitude', 'Longitude', 'geometry'

dataset/Bay.geojson: One row of Multipolygon Geojson file storing the shape of the Bay area.
Columns of dataset/Bay.geojson:
'OBJECTID', 'Shape_Length', 'Shape_Area', 'geometry'

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
