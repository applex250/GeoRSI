# Mapping the Impact of Housing Shortage on Oil Workers

## Instruction
Your task is to analyze homelessness trends in North Dakota during the 2013 oil boom. Join homelessness tabular data to the U.S. states spatial layer using state abbreviations. Then, save the maps for analysis.

## Domain knowledge
Tabular Data Joining: Joining tabular data to spatial layers using a common field (e.g., state abbreviation) is crucial for mapping.

The North Dakota oil boom (2012鈥?013) attracted thousands of workers due to high-paying jobs in the energy sector.

## Data
dataset/homeless_data.xlsx: containing state-level homelessness data in the United States for 2013. The dataset includes the following columns:State, Change, Pop13, Homeless13

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
