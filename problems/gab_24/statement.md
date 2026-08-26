# Providing with a de-identified point-level dataset that includes all the variables of interest for each child, as well as their general location.

## Instruction
Your task is providing with a de-identified point-level dataset that includes all the variables of interest for each child, as well as their general location. You should load the point data and ensure Consistent Coordinate Reference System (CRS). You need to round the coordinates to two decimals and create new points features based on the added fields. The goal is to calculate and document the reduction in unique locations, Save the updated shapefile as a result.

## Domain knowledge
Coordinate Reference Systems (CRS): Understanding the importance of using a consistent CRS (WGS 1984 in this case) for accurate spatial analysis and comparison.
Spatial De-identification: Rounding coordinates is a common method for spatial de-identification to protect individual privacy while maintaining general geographic patterns for analysis.

## Data
High_Blood_Level_Results.shp: This shapefile contains point data representing incidents of elevated blood lead levels in children within the study area. Each point corresponds to a specific geographic location where a blood test was conducted, and the results indicated a high concentration of lead.

Columns of High_Blood_Level_Results.shp:
'Address: House', 'Address: Street Name', 'Address: Unit', 'Address: City', 'Address:  ZIP', 'First Name', 'Last Name', 'Bday', 'Address: State', 'Blood Level', 'Blood Level Test Year', 'Race', 'Gender', 'Age'

Sacramento_ZIP_Codes.shp: This shapefile contains polygon data representing the boundaries of ZIP codes within Sacramento. Each polygon defines the geographic extent of a specific ZIP code.

Columns of Sacramento_ZIP_Codes.shp:
'Zip Code', 'Post Office Name', 'State Name', '2021 Total Population', 'Area in square miles',  'Shape_Length', 'Shape_Area'

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
