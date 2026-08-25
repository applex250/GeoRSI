# Use animal GPS tracks to model home range to understand where they are and how they move over time.

## Instruction
Yout task is analyzing and visualizing Elk movements in the given dataset. The goal is to estimate home ranges and assess habitat preferences using spatial analysis techniques, including Minimum Bounding Geometry (Convex Hull), Kernel Density, and Density-based Clustering(DBSCAN). You should identify the spatial clusters of Elk movements and overlay the findings with maps and visualizations. Save the final output as "pred_results/Elk_Analysis.png".

## Domain knowledge
"Home range" can be defined as the area within which an animal normally lives and finds what it needs for survival. Basically, the home range is the area that an animal travels for its normal daily activities. 

"Minimum Bounding Geometry" creates a feature class containing polygons which represent a specified minimum bounding geometry enclosing each input feature or each group of input features. 

"Convex hull" is the smallest convex polygon that can enclose a group of objects, such as a group of points.

"Kernel Density Mapping" calculates and visualizes features's density in a given area.

"DBSCAN", Density-Based Spatial Clustering of Applications with Noise that cluster the points based on density criterion.

## Data
dataset/Elk_in_Southwestern_Alberta_2009.geojson: geojson files for storing points of Elk movements in Southwestern Alberta 2009.

Columns of dataset/Elk_in_Southwestern_Alberta_2009.geojson:
'OBJECTID', 'timestamp', 'long', 'lat', 'comments', 'external_t', 'dop',
'fix_type_r', 'satellite_', 'height', 'crc_status', 'outlier_ma',
'sensor_typ', 'individual', 'tag_ident', 'ind_ident', 'study_name',
'date', 'time', 'timestamp_Converted', 'summer_indicator', 'geometry'

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
