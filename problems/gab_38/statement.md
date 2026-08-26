# Calculate travel time from one location to others in a neighborhood.

## Instruction
Your task is to calculate the travel time from Natural History Building(Geography department) at University of Illinois Urbana-Champaign to the other buildings on the campus. You will retreive the place information as graph from Open Street Map networkdata. Using the graph, you will find out the speeds and required travel time between nodes. Calculate the driving-time distances for the location nodes from the nearest node next to Natural History Building. Set the node attributes with the travel time. Finally, visualize the travel time by plotting the nodes with specific colors and save the graph as "pred_results/travel_time.png".

## Domain knowledge
Travel-time Calculation: The amount of time traveling from one place to another. It can be calculated by using add_edge_speed and add_edge_travel_times functions in osmnx package, which return the speed limit and total travel time between nodes.

OSM Network data: osmnx.graph_from_address function returns the network graph around a specific location. In this case, the address is "1301 W Green St, Urbana, IL 61801" and the network_type should be "drive".

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
