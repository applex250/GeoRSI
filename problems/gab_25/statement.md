# Create risk maps for transmission, susceptibility, and resource scarcity. Then create a map of risk profiles to help pinpoint targeted intervention areas.

## Instruction
Your task is to analyze COVID-19 risk in HKG using Arcpy. First, use similarity search to map transmission risk from hkg_constituency.shp and target_risk.shp. Second, use add join, calculate field and remove join to join transmission risk map to the hkg_constituency.shp. Then do the same search and join functions for the other three risk map (susceptibility risk, healthcare resource scarcity risk, and exposure risk). Finally, use multivariate clustering to map the COVID-19 risk profiles of HKG.

## Domain knowledge
For Search Similarity:
Number Of Results = 0
Fields To Append To Output = "ID"
Attributes Of Interest:
"PopDensity;SpInterIdx" for transmission risk.
"PopDensity;Seniors60t;spending_c;keyfacts_p" for susceptibility risk.
"Seniors60t;SUM_Beds" for insufficient resource risk.
"RelativeCa" for exposure risk.

For Join Functions: use "ID" as join field, and calculate the new field using the expression "432 - !join_table.SIMRANK!"

For Multivariate Clustering: select the four target fields and use K means as clustering method, "SEEDS" as initialization fields.

## Data
dataset/hkg_constituency.shp: This shapefile contains data for 431 Hong Kong constituencies. The data includes demographic and spatial information that can be used to assess the risk of disease transmission, COVID- 19 susceptibility, and healthcare resource scarcity.
Key Features:
'ID', 'Constituen', 'TotalPop', 'PopDensity', 'Seniors60t', 'spending_c', 'keyfacts_p', 'SUM_Beds', 'SpInterIdx', 'RelativeCa', 'SEEDS'

dataset/target_risk.shp: The attributes for the target_risk shapefile are similar to those for the hkg_constituency.shp. The values in the target_risk, however, are the worst-case values found throughout Hong Kong. They include the densest population value, the largest number of seniors per 1,000 people, the highest index for tobacco, the smallest purchasing power value, and so on. These worst-case values will be used as the target against which all other constituencies will be ranked in order to determine risk.
Key Features:
'ID', 'Constituen', 'TotalPop', 'PopDensity', 'Seniors60t', 'spending_c', 'keyfacts_p', 'SUM_Beds', 'SpInterIdx', 'RelativeCa'

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
