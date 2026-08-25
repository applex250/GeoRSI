# Find heat islands and at-risk populations in Madison, Wisconsin

## Instruction
Your task is analyzing urban heat using Kriging interpolation techniques in Python. The analysis should focus on understanding spatial patterns of urban heat islands by using point temperature data and interpolating these values across a city. You will have to use a demographic layer to extract and enhance the data visualization on the elder group(Age>65). The goal is to load the temperature sample data, apply the Kriging method to predict temperature across the urban area, and generate a choropleth map showing the average interpolated temperature surface in each census block group.  Highlighting the area with high interpolated area as well as high density of the elder population. The final output should be saved as "pred_results/interpolated_urban_heat.png".

## Domain knowledge
Kriging is a commonly used spatial interpolation method in soil science and geology. It is based on statistical models that include autocorrelation. It involves fitting into a variogram and using weights derived from covariance to interpolate. 

A choropleth map is a thematic map that is used to represent statistical data using the color mapping symbology technique. It displays enumeration units, or divided geographical areas or regions that are colored, shaded or patterned in relation to a data variable.

Attribute joins are accomplished using the pandas.merge() method. In general, it is recommended to use the merge() method called from the GeoDataFrame in the left argument.

## Data
dataset/Temperature.geojson: Geojson file that stores temperature at different coordinates as points. 'TemperatureF'' Column stores the temperature information in Fahrenheit.
Columns of dataset/Temperature.geojson:
Columns: OBJECTID  SID   LATITUDE  LONGITUDE  TemperatureF geometry

dataset/CensusBlock.geojson: Geojson file that stores the census block of Madison as polygons. "Block_Groups_Over65Density" column stores the density of the elderly population per census block.
Columns of dataset/CensusBlock.geojson:
OBJECTID, Block_Groups_TOTPOP10, Block_Groups_PopOver65, Block_Groups_Over65Density, Shape_Length, Shape_Area, geometry

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
