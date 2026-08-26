# Train a Geographically Weighted Regression model to predict Georgia's Bachelor's degree rate.

## Instruction
Your task is to train a Geographically Weighted Regression(GWR) model with demographical data in the state of Georgia. The target variable is the percentage of bachelor's degree in each county while the indepdent variables are the percentage of foreign-born population, black population, and rural populations. You should search for the optimal bandwidth for the GWR models and plot their differences in the same graph. Save the plots as "pred_results/GA_GWR.png".

## Domain knowledge
Geographically Weighted Regression Model: A spatial technique that analyzes the relationship between variables by considering their geographical locations. It can be used in python by Multiscale Geographically Weighted Regression (MGWR) packages.

## Data
N/A

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
