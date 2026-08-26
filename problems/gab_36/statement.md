# Compute the change in vegetation before and after a hailstorm with the SAVI index

## Instruction
Your task is to assess the impact of hail damage on cornfields using pre- and post-storm satellite imagery. You will calculate vegetation loss due to the storm, leveraging the Soil-Adjusted Vegetation Index (SAVI) applied to multispectral imagery from the study area. The process involves determining vegetation health before and after the storm, identifying changes at the pixel level, and analyzing the average vegetation loss for each crop field. The ultimate goal is to summarize the extent of damage for each field, offering valuable insights for agricultural recovery efforts.

## Domain knowledge
SAVI is particularly useful in areas with intermediate vegetation cover and is computed using the formula:
SAVI=((NIR-Red)/(NIR+Red+L)) * (1+L), where L is a correction factor (commonly set to 0.5).

Raster-based analysis allows pixel-by-pixel calculations, such as vegetation indices, and is fundamental for spatial quantification of phenomena like crop damage.

Zonal Statistics aggregates raster data based on defined zones (e.g., polygons of field boundaries). Metrics such as the mean loss of vegetation can provide valuable insights at the field level.

## Data
dataset/Before_Storm.tif: Raster file containing multispectral satellite imagery before the hailstorm. Data shape: (9030, 9121)

dataset/After_Storm.tif: Raster file containing multispectral satellite imagery after the hailstorm. data shape: (7293,8549)


dataset/Field_Boundaries.shp: Polygon shapefile representing the boundaries of cultivated fields in the study area. columns: 'Field_ID', 'Shape_Area', 'geometry'

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
