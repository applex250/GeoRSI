# Analyze the street tree species data  in San Francisco

## Instruction
Your task is using the distribution data data about San Francisco street trees and shapefiles of administrative regions to analyze the tree species NULL percentage in different regions. Visualize the results in a quadtree format map. Save the figure as 'pred_results/trees_count_vis.png'.

## Domain knowledge
geoplot.quadtree() plots a choropleth map with point aggregate by quadtree neighborhoods.
geodataframe.assign() function assigns new columns to a GeoDataFrame. A new column could be the data "nullity" percentage. geoplot.polyplot() plots a polygon data layer. The DataFrame.notnull() function in Pandas is used to detect non-missing values within a DataFrame.

## Data
dataset/street_trees_sample.geojson: Point Geojson file storing tree sample locations along with their species information.
Columns of dataset/street_trees_sample.geojson
'LegalStatus', 'Species', 'Address', 'SiteOrder', 'SiteInfo',
       'PlantType', 'Caretaker', 'CareAssistant', 'PlantDate', 'DBH',
       'PlotSize', 'PermitNotes', 'geometry'

dataset/sfo_boroughs.geojson: One row of polygon Geojson file storing boroughs in the San Francisco.
Columns of dataset/sfo_boroughs.geojson:
'geometry'

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
