# Designate bike routes for commuting professionals

## Instruction
Your task is to design optimal bike routes for a commuter network. Analyze demand hotspots using spatial clustering tools.Evaluate existing infrastructure by overlaying bike lane and road network data. Apply suitability analysis by combining traffic volume, road slope, and safety data using a weighted overlay. Use Network Analyst to propose new routes, ensuring connectivity to major employment centers and evaluating the solution through accessibility metrics like coverage within a half-mile radius.

## Domain knowledge
The City of Seattle plans to construct protected bike lanes, prioritizing busier streets to identify direct routes. Using attribute selection, all arterial roads were filtered with codes 1 for segment type and 1 for arterial roads, creating a new layer with copied features and clearing selections in the street network attribute table.  The design divides into three sections: East, where E Madison St in Capitol Hill and Madison St downtown were identified; West, where 10th Ave E offers excellent coverage across the western side; and Central, where 23rd Ave, 23rd Ave E, 24th Ave E, and Turner Way E align with E Madison St. Most of the block lies within a half-mile of these selected streets.

## Data
dataset/Neighborhoods: Spatial polygons representing different urban and suburban areas, often linked with demographic or socioeconomic data.
dataset/Streets: Line features depicting road networks, including attributes like road type, traffic volume, and bike lane presence.
dataset/Zoning: Polygons indicating land use designations such as residential, commercial, industrial, or mixed-use, often tied to urban planning and development policies.

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
