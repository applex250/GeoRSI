# Assess Open Space to Lower Flood Insurance Cost

## Instruction
Your task is assessing open space to lower flood insurance cost. The goal is to calculate the predominant land cover in each parcel and estimate open space area with accuracy of 85%. You should pay attention that small parcels contributed minimally can be excluded. You should integrate all information of OSP into a single table.

## Domain knowledge
Zonal Statistics as Table is summarizes the values of a raster within the zones of another dataset and reports the results as a table.
In this example, the 2011 National Land Cover Database (NLCD) Impervious Surface Estimation layer has a measured accuracy of 85%.

## Data
dataset/PADUS_CRS_final.tif: a raster file derived from the Protected Areas Database of the United States (PAD-US). It represents areas potentially eligible for open space preservation (OSP) within Georgetown County, South Carolina. 
dataset/GeorgetownCo_Parcels comprises vector data of property parcels within Georgetown County. Each parcel is delineated with its boundaries and associated attributes, such as parcel identification numbers (PARCEL_ID).
dataset/PADUS_CRS_attrib.csv: serves as an attribute table for the PADUS_CRS_final.tif raster. It contains detailed information about each protected area, including attributes like OBJECTID, Category, and Ownership Type.

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
