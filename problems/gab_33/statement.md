# Analyze the impacts of land subsidence on flooding.

## Instruction
Your task is analyzing the impact of land subsidence on flooding based on future elevation data of the study area. Your will calculate the flood damage to building in the future given the elevation of sea level in 2050 and shapefile of study area. You need find the flood depth given the elevation. Then you will filter and select the buildings within the flooded area. The final goal is summarizing the flood depth in each building area and calculate the final flood damage.

## Domain knowledge
Raster Calculator:Build and run a single map algebra expression using Python syntax.

Raster to Polygon:Converts a raster dataset to polygon features.

Select Layer By Location:Selects features based on a spatial relationship to features in another dataset or the same dataset.

Summarize Within:Overlays a polygon layer with another layer to summarize the number of points, length of the lines, or area of the polygons within each polygon, and calculate attribute field statistics about the features within the polygons.

Calculate Fied:Calculates the values of a field for a feature class, feature layer, or raster.

Flood depth calculation equation: Int(("%flooded_area_2050%" + 200)*-1)

Cost Calculation Equation: if ($feature.MEAN_gridcode > 1) {
     (0.298 * (Log(0.01 * $feature.MEAN_gridcode)) + 1.4502) * 271 * $feature.Shape_Area
}
else {
     0
}

## Data
dataset/Elevation_2050.tif: Raster file for storing predicted flood evelation in 2050.
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
