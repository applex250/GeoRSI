# Detect aggregation scales of geographical flows

## Instruction
Your task is to analyze the spatial aggregation patterns and scales of geographical flows using the L-function.  First, load the flow data, origin area data , and destination area data. Second, calculate the local K-function for each flow by iterating over flow pairs and applying distance-based analysis with edge correction. Third, compute the global L-function by averaging the local K-functions and transforming the result. Finally, visualize the L-function with confidence intervals and critical distance markers for interpretation.

## Domain knowledge
Complete Spatial Randomness (CSR): a baseline model in spatial analysis, assuming a uniform, random distribution of flows across space. Deviations from CSR indicate clustering or dispersion, which the L-function quantifies.

K-function: Measures the cumulative density of flows within a given distance, normalized by the total flow intensity.

L-function: A transformed version of the K-function, making it easier to interpret deviations from CSR:
L(r) > 0: Clustering, L(r)<0: Dispesion

## Data
dataset/flow.csv: Contains the geographical flows represented as connected origin-destination (OD) point pairs.
Columns: x_o: X-coordinate of the origin point; y_o: Y-coordinate of the origin point; x_d: X-coordinate of the destination point; y_d: Y-coordinate of the destination point.

dataset/o_area.csv: Contains the boundary coordinates for the region where the origin points lie.
Columns: x: X-coordinate of the boundary point; y: Y-coordinate of the boundary point.

dataset/d_area.csv: Contains the boundary coordinates for the region where the destination points lie.
Columns: x: X-coordinate of the boundary point; y: Y-coordinate of the boundary point.

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
