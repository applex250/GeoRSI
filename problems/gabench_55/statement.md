# Vector Spatial Analysis

## Task
This task requires conducting a network-level Origin-Destination (OD) analysis to evaluate how predicted traffic flows are distributed across the urban road network and to identify which network elements bear the primary load. You need to integrate the provided road network, street intersections, and supermarket location data to build an urban transportation network model that accounts for one-way restrictions. By quantifying the travel costs from origins to destinations, you will predict the overall OD flow distribution characteristics and map these flows onto the actual road network to identify high-load road corridors. Additionally, you are required to perform a structural diagnosis of the network to pinpoint the most critical transfer nodes. Finally, please output a network traffic assignment map showcasing segment flow loads and supermarket hubs, and save it as "network_traffic_assignment.png".

## Data
dataset/net.shp: A LineString Shapefile storing the urban road network of the study area with 416 road segments. The 'METERS' column stores segment length in meters. The 'ONEWAY' column encodes direction restriction ('FT' = from-to only, 'TF' = to-from only, None = bidirectional).DBF encoding: GBK.
dataset/city_Net_Junctions.shp: A Point Shapefile storing 288 road network intersections, used as origin points (TAZ centroid proxies) in OD analysis. The 'OBJECTID' column is used as point_id for origins.
dataset/supermarkets.shp: A Point Shapefile storing 15 supermarket locations, used as destination points. The 'OBJECTID' column is used as point_id for destinations. The 'NAME' column stores the Chinese supermarket name.

## Expected deliverable style
base layer style: {"color": "#EEEEEE", "linewidth": 0.5}
flow layer style: {"column": "flow_load", "cmap": "hot_r", "linewidth": 1.2, "alpha": 0.85, "legend": True, "legend_kwds": {"label": "Network Traffic Load (Assigned Flow)", "shrink": 0.5}}
hub markers style: {"color": "blue", "marker": "*", "markersize": 200, "edgecolor": "white", "linewidth": 0.5, "zorder": 10, "label": "Supermarkets (Hubs)"}

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
