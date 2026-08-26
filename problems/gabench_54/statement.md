# Vector Spatial Analysis

## Task
Your task is to conduct an Origin-Destination (OD) mobility analysis on the urban road network to investigate the spatial interaction patterns between street intersections and supermarkets. The focus of this analysis is to accurately associate discrete origins and destinations with network nodes by constructing a directed road network model and utilizing batch node-matching techniques. You are required to quantify the travel costs from intersections to supermarkets and apply a spatial interaction model to predict overall flow distribution characteristics. Specifically, your goal is to identify dominant high-flow OD pairs, evaluate structural network metrics and supermarket attraction hubs, and visualize the top 100 core mobility desire lines. Please save the final output as ""mobility_desire_lines.png"

## Data
dataset/net.shp: A LineString Shapefile storing the urban road network of the study area with 416 road segments. The 'METERS' column stores segment length in meters. The 'ONEWAY' column encodes direction restriction ('FT' = from-to only, 'TF' = to-from only, None = bidirectional).DBF encoding: GBK.
dataset/city_Net_Junctions.shp: A Point Shapefile storing 288 road network intersections, used as origin points (TAZ centroid proxies) in OD analysis. The 'OBJECTID' column is used as point_id for origins.
dataset/supermarkets.shp: A Point Shapefile storing 14 supermarket locations, used as destination points. The 'OBJECTID' column is used as point_id for destinations. The 'NAME' column stores the Chinese supermarket name.

## Expected deliverable style
base layer style: {"color": "lightgray", "linewidth": 0.4, "alpha": 0.5}
desire lines style: {"color": "cyan", "linewidth": 0.8, "alpha": 0.6, "label": "Top 100 Mobility Desire Lines"}
destinations style: {"color": "red", "marker": "D", "markersize": 50, "label": "Supermarkets"}

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
