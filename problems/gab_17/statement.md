# Analyze the geographical distribution of fatal car crashes in New York City during 2016

## Instruction
Your task is using data on the locations and related information of fatal car crashes in New York City to analyze fatal car crash distribution in 2016. You will use the car crash data along with the GeoJSON data of NYC administrative regions to plot the geographical distribution of fatal crashes in 2016 on a map by geoplot. Save the figure as 'pred_results/collisions_map_vis.png'.

## Domain knowledge
geoplot is a high-level Python geospatial plotting library. It is an extension to cartopy and matplotlib. The geoplot.pointplot() is a geospatial scatter plot function that plots each observation in your dataset as a single point on a map.

## Data
dataset/nyc_boroughs.geojson:Multipolygon Geojson file storing boroughs in the NewYork city.
Columns of dataset/nyc_boroughs.geojson:
'BoroCode', 'BoroName', 'Shape_Leng', 'Shape_Area', 'geometry'

dataset/fatal_collisions.geojson: Point Geojson file storing fatal collisions in each boroughs along with the number of persons killed in 2016.
Columns of dataset/fatal_collisions.geojson:
'id', 'NUMBER OF PERSONS KILLED', 'BOROUGH', 'geometry'

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
