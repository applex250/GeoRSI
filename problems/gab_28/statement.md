# Estimate the origin-destination (OD) flows between regions based on the socioeconomic attributes of regions and the mobility data.

## Instruction
Your task is to estimate the interaction strengths between subregions using a Random Forest model. First, load the OD flow data and socio-economic attribute data for each subregion. Second, aggregate the OD flow data to the subregion scale to create subregion spatial interaction data. Third, prepare the dataset by merging the aggregated OD flows with the socio-economic attributes of origin and destination subregions. Finally, build a Random Forest model with hyperparameter tuning using GridSearchCV to predict interaction strengths and evaluate the model performance using mean squared error.

## Domain knowledge
OD Flows: Origin-Destination (OD) flows represent the movement volume between locations, crucial for understanding regional connectivity, transportation, and economic interactions.

Random Forest (RF) Model: An ensemble machine learning method that builds multiple decision trees to improve prediction accuracy and feature importance analysis. RF is effective for modeling complex, non-linear relationships, making it suitable for analyzing factors influencing OD flows.

GridSearchCV: GridSearchCV is a hyperparameter tuning tool that systematically tests combinations of specified hyperparameter values to find the best configuration for a machine learning model. It performs cross-validation for each parameter set to evaluate performance, ensuring robust and optimal model settings for improved accuracy and generalization.

## Data
dataset/od_data.csv: Represents the movement volume between subregions, used for analyzing interaction strengths and regional connectivity.
Columns of dataset/od_data.csv include Origin, Destination, and FlowVolume.

dataset/socioeconomic_data.csv: Contains socio-economic details for each subregion, providing contextual data that can be merged with OD flow data to enhance analysis by incorporating socio-economic factors influencing interactions.
Columns of dataset/socioeconomic_data.csv include Subregion, Population, GDP, EmploymentRate, AverageIncome, EducationIndex, and HealthcareAccess.

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
