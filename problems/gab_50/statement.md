# Predict seagrass habitats

## Instruction
Your task is to predict seagrass habitats with machine learning methods. First, dissolve the USA seagrass, and create 5000 random points on the dissolved result. Then, use the empirical Bayesian kriging geostatistical method to interpolate raster surfaces for the environmental values stored in the Global ocean measurements layer, for temp and salinity, separately. Finally, use the two kriging result as explanatory rasters to perform presence-only prediction (MaxEnt), get the train features and seagrass predict raster as the outputs.

## Domain knowledge
Empirical Bayesian kriging (EBK) is a geostatistical interpolation method that automates the most difficult aspects of building a valid kriging model.
The Presence-only Prediction (MaxEnt) tool uses a maximum entropy approach (MaxEnt) to estimate the probability of presence of a phenomenon. The tool uses known occurrence points and explanatory variables in the form of fields, rasters, or distance features to provide an estimate of presence across a study area.

## Data
dataset/Global_ocean_measurements.shp: Ecological Marine Units point data that contains ocean measurements up to a 90-meter water depth.
dataset/Global_shallow_waters.shp: Global shallow bathymetry polygon used to predict seagrass globally.
dataset/USA_seagrass.shp: For seagrass occurrence, every polygon in USA seagrass is an identified seagrass habitat.
dataset/USA_shallow_waters.shp: Shallow bathymetry polygon for the continental United States used as the study area for model training.

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
