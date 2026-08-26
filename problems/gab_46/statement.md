# Identify hot spots for peak crashes

## Instruction
Your task is identifying hot spots for peak crashes in Brevard County, Florida, 2010 - 2015. The first step is select all the crashes based on peak time zone. Create a copy of selected crashes data. Then, snap the crashes points to the road network and spatial join with the road. Calculate the crash rate based on the joint data and use hot spot analysis to get crash hot spot map as the result.

## Domain knowledge
We consider traffic between time zone 3pm to 5pm in weekdays as peak. For snap process, the recommend buffer on roads is 0.25 miles. Hot spot analysis looks for high crash rates that cluster close together, accurate distance measurements based on the road network are essential.

## Data
dataset/crashes.shp: The locations of crashes in Brevard County, Florida between 2010 and 2015.
dataset/roads.shp: The road network of Brevard County.
dataset/nwswm360ft.swm: Spatial weights matrix file created using the Generate Network Spatial Weights tool and a street network built from Brevard County road polylines.

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
