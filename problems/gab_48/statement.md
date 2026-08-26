# Determine how location impacts interest rates

## Instruction
Your task is to analyze how location impacts interest rates. First, select and copy the tracts with at least 30 loans. Find interest rate hot spots on the selected loan tracts. Then create a Generalized Weighted Regression model on the selected data to determine how location impacts interest rates.

## Domain knowledge
Select the attribute "AcceptedLo" larger or equal to 30 in load tracts. The key field in load data is "AveInteres". In GWR model, use NUMBER_OF_NEIGHBORS as neighborhood_type, and set neighbor numbers to 22.

## Data
dataset/loan_data.shp: The loan data from August 2007 to September 2015, obtained from LendingClub Statistics.

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
