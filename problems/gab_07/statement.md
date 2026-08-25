# Analyze the impacts of land subsidence on flooding

## Instruction
Your task is analyzing the impact of land subsidence on flooding based on future elevation data of the study area. Identify flood-prone areas and estimate potential building damage to support urban planning and mitigation strategies. Save the results to "pred_results/flooding_analysis.png".

## Domain knowledge
Estimate potential building damage based on factors such as flood depth, building type, flood risk classification and economic cost/loss.
The cost calculation can be done by:(0.298 * (Log(0.01 *  mean depth)) + 1.4502) * 271 * shape area

Raster calculation involves creating a algebra expression that outputs a raster file.

The Overlay toolset contains tools to overlay multiple feature classes to combine, erase, modify, or update spatial features, resulting in a new feature class. The "overlay" function manipulations two feature layers using the language of sets, intersection, union, difference and symmetrical difference.

## Data
dataset/Elevation_2050.tif: Raster file for storing predicted flood elevation in 2050.
data shape: (878, 1196)

dataset/StudyAreaBuildings.shp: Polygon Shapefile for shape and features of buildings in the study area.

Columns of dataset/StudyAreaBuildings.shp:
'Shape_Leng', 'Shape_Area', 'geometry'

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
