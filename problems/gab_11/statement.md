# Create charts using Python to better explore the distribution of corals and sponges around Catalina Island.

## Instruction
Your task is performing raster analysis on the elevation and environmental factors influencing coral and sponge distribution at Catalina Island. Update the database with the slope and aspect analysis results. Use the updated database to visualize the mean slope and aspect distribution of each Coral and Sponge species in Catalina Island as "pred_results/CoralandSponge.png".

## Domain knowledge
The Slope tool identifies the steepness at each cell of a raster surface. The lower the slope value, the flatter the terrain; the higher the slope value, the steeper the terrain. 

The Aspect tool identifies the direction the downhill slope faces. The values of each cell in the output raster indicate the compass direction the surface faces at that location. It is measured clockwise in degrees from 0 (due north) to 360 (again due north), coming full circle. Flat areas having no downslope direction are given a value of -1.

## Data
dataset/CatalinaBathymetry.tif: Raster files for storing Bathymetry data in the Catalina Island area.
Shape of dataset/CatalinaBathymetry.tif:(664, 853)

dataset/CoralandSpongeCatalina.geojson: Geojson file for storing Coral and Sponge species distributions as point along with their attributes.

Columns of dataset/CoralandSpongeCatalina.geojson:
'OBJECTID', 'ShallowFlag', 'DatasetID', 'CatalogNumber', 'SampleID',
'Repository', 'ScientificName', 'VernacularNameCategory', 'TaxonRank',
'IdentificationQualifier', 'Locality', 'latitude', 'longitude',
'DepthInMeters', 'DepthMethod', 'ObservationDate', 'SurveyID',
'Station', 'EventID', 'SamplingEquipment', 'LocationAccuracy',
'RecordType', 'DataProvider', 'geometry'

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
