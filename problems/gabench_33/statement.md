# Vector Spatial Analysis

## Task
Your task is to calculate the travel time from Natural History Building(Geography department) at University of Illinois Urbana-Champaign to the other buildings on the campus. Natural History Building's location is latitude = 40.109442588847976, longitude = -88.22625178710955. You will retrieve the place information as graph from Open Street Map network data. Using the graph, you will find out the speeds and required travel time between nodes. Calculate the driving-time distances for the location nodes from the nearest node next to Natural History Building. Set the node attributes with the travel time. Finally, visualize the travel time by plotting the nodes with specific colors and save the graph as "travel_time.png".

## Data
dataset/street_graph.graphml: GraphML file containing the street network of UIUC campus extracted from Open Street Map, with nodes representing intersections and edges representing road segments including attributes like length and speed limits.
dataset/distances.pkl: Pickle file containing pre-calculated mappings between campus buildings and their nearest nodes in the street network, along with spatial relationships and distance metrics.

## Expected deliverable style
edge layer style:{"column": <placeholder>, "cmap": "RdYlBu", "linewidth": 0.6, "alpha": 0.7, "legend": True, "legend_kwds": {"label": "Edge Travel Time (s)", "orientation": "horizontal", "pad": 0.01}}
node layer style:{"column": <placeholder>, "cmap": "RdYlBu", "markersize": 3, "alpha": 0.9, "legend": True, "legend_kwds": {"label": "Node Travel Time", "orientation": "vertical"}}

## How to submit
1. Analyze the data with python (write scripts, run_python; use start_job for
   anything longer than a couple of minutes). geopandas / rasterio / scipy are
   available in the python environment.
2. Produce the output artifact(s) the task asks for (figures as PNG, derived
   layers as geojson/tif) in the workspace root, with descriptive filenames.
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {
     "key_values": {"<descriptive label>": <number>, ...},
     "output_files": ["<filename you created>", ...],
     "summary": "<2-4 sentences: method and main findings>"
   }

## Grading
Your produced artifacts are checked for existence/non-degeneracy, and your
method + results are compared against an expert reference solution (tool
chain, expected product, cartographic style). Method correctness matters more
than pixel-exact styling.
