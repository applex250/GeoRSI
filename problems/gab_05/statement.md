# Visualize the data about children with elevated blood lead levels in a manner that protects individual privacy

## Instruction
Your task is visualizing data about children with elevated blood lead levels in a privacy-conscious manner. First, conduct Optimized Hot Spot Analysis to identify clusters without revealing individual points. Then, apply tessellation to summarize cases within hexagonal polygons. This approach protects sensitive data while clearly representing areas with higher occurrences of elevated blood lead levels. The goal is to find the area with potential blood lead rise with specific cases saved in point files. The final output, saved as "pred_results/transit_access.png", ensures stakeholders receive relevant information without accessing specific locations.

## Domain knowledge
Hot spot analysis is based on mathematical calculations that identify statistically significant spatial clusters of high values (hot spots) and low values (cold spots).

Tessellation is a method of tiling a surface with identical, non-overlapping geometric shapes, like squares, triangles, or hexagons.

## Data
High_Blood_Level_Results.shp: This shapefile contains point data representing incidents of elevated blood lead levels in children within the study area. Each point corresponds to a specific geographic location where a blood test was conducted, and the results indicated a high concentration of lead.

Columns of High_Blood_Level_Results.shp
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
