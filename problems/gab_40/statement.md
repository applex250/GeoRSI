# Calculate and visualize changes in malaria prevalence

## Instruction
Your task is to analyze changes in malaria prevalence among children aged 2鈥?0 in Sub-Saharan Africa from 2000 to 2015. Using raster data from the Malaria Atlas Project, calculate the difference between the prevalence rates in 2000 and 2015 using the Minus raster function. Then, visualize the change in malaria prevalence with a diverging color scheme and adjust the symbology to highlight areas of increase and decrease.

## Domain knowledge
Malaria Prevalence Analysis: Understanding malaria's spatial distribution and temporal changes, especially among children in Sub-Saharan Africa.

Raster Analysis Techniques: Applying raster functions (e.g., Minus) to calculate changes over time. Remapping raster values into meaningful categories for analysis and visualization.

## Data
dataset/2015_Nature_Africa_PR.2000.tif: GeoTIFF file storing malaria prevalence rates among children aged 2鈥?0 in Sub-Saharan Africa for the year 2000.  Data shape: (1741, 1681)

dataset/2015_Nature_Africa_PR.2015.tif: GeoTIFF file storing malaria prevalence rates among children aged 2鈥?0 in Sub-Saharan Africa for the year 2015.  Data shape:(1741, 1681)

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
