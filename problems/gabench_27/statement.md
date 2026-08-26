# Geostatistical Analysis

## Task
Your task is to estimate the interaction strengths between subregions using a Random Forest model. First, load the OD flow data and socio-economic attribute data for each subregion. Second, aggregate the OD flow data to the subregion scale to create subregion spatial interaction data. Third, prepare the dataset by merging the aggregated OD flows with the socio-economic attributes of origin and destination subregions. Finally, build a Random Forest model with hyperparameter tuning using GridSearchCV to predict interaction strengths and evaluate the model performance using mean squared error. Save the resulting MSE score in a JSON file named "model_performance.json" with a key "mse".

## Data
dataset/od_data.csv: Represents the movement volume between subregions, used for analyzing interaction strengths and regional connectivity.
dataset/socioeconomic_data.csv: Contains socio-economic details for each subregion, providing contextual data that can be merged with OD flow data to enhance analysis by incorporating socio-economic factors influencing interactions.

## Expected deliverable style
no style

## How to submit
1. Analyze the data with python (write scripts, run_python; use start_job for
   anything longer than a couple of minutes). geopandas / rasterio / scipy are
   available in the python environment.
2. Produce the output artifact(s) the task asks for (figures as PNG, derived
   layers as geojson/tif) in the workspace root, with descriptive filenames.
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {
     "key_values": {"<descriptive label>": <number>, ...},
     "output_files": ["<filename you created>", ...],
     "summary": "<2-4 sentences: method and main findings>"
   }

## Grading
Your produced artifacts are checked for existence/non-degeneracy, and your
method + results are compared against an expert reference solution (tool
chain, expected product, cartographic style). Method correctness matters more
than pixel-exact styling.
