# Estimate the accessibility of roads to rural areas in Japan.

## Instruction
To promote sustainable development in the nation's rural areas, your task is estimating access to all-season roads. First, you'll add population and road data and limit your study area to rural regions. With the shape of rural area, you will clip the regional population of the rural areas.Then, you'll create a 2-kilometer buffer around all-season roads and clip the rural area out.  The final goal is calculating the percentage of the rural population within that buffer to get the percentage of population in the rural area that has access to roads in 2km. Finally, visualize the population percentage in each rural area with a choropleth map. Save the result as "pred_results/accessibility.png".

## Domain knowledge
"Buffer" creates buffer polygons or zones around input geometry features to a specified distance in GIS. 

Clip points, lines, or polygon geometries to the mask extent.  "Clip" is used to cut out a piece of one map layer using one or more of the features in another layer.

## Data
dataset/ShikokuMetropolitan.geojson: Geojson file that stores the shape and features for towns in Shikoku area of Japan as polygons. Area type indicate whether an area is rural.

Key Fields: 'OBJECTID', 'JISCODE', 'PNAME', 'MEACODE', 'MEANAME', 'AREANAME',
       'AREATYPE', 'Shape__Area', 'Shape__Length', 'geometry'

dataset/AllSeasonRoads.geojson: Geojson file that stores all season emergency roads in Shikoku area as lines.

Key Fields: 'OBJECTID', 'PrefectureNum', 'EmergencyRoadCategory', 'Road', 'ER_Road',
       'Dependency', 'LastUpdated', 'Shape__Length', 'geometry'

dataset/ShikokuPopulation.geojson: Geojson file that stores the shape and features for areas in Shikoku. D0001 columns refers to population of that area in 2015.

Key Fields: 'OBJECTID', 'ID', 'D0001', 'Shape__Area', 'Shape__Length', 'geometry'

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
