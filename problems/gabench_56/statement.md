# Vector Spatial Analysis

## Task
请基于道路网络开展固定起终点最短路径分析。先将道路图层和点位图层转换为统一的 GeoJSON 中间数据，再基于道路网络构建有向图，并使用 MINUTES 字段作为通行成本。本次分析的起点固定为学校点位图层中的“附属中学”，终点固定为市场点位图层中的“康复路批发市场”。请求解两者之间的最短路径，输出最终路线总览图start_end_overview_map.png

## Data
输入数据/道路网络图层: （dataset/network.shp）a LineString Shapefile used for routing. The MINUTES field is the travel-cost field; FT_MINUTES and TF_MINUTES are used when directional minute costs are available. METERS stores road length in meters, ONEWAY records one-way restrictions, and NAME / TYPE describe road attributes.
输入数据/起点候选图层: (dataset/school.shp)a Point Shapefile storing candidate start points. The name field is used as the start-point label.
输入数据/终点候选图层:(dataset/Marketplace.shp) a Point Shapefile storing candidate end points. The NAME field is used as the end-point label.

## Expected deliverable style
road network style:{"color": "#c7cbd1", "linewidth": 0.45, "label": "Road network"}
other marketplaces style:{"color": "#8e8e8e", "markersize": 18, "alpha": 0.45, "label": "Other marketplaces"}
service area style:{"column": "facility_l", "linewidth": 2.0, "alpha": 0.82, "categorical": true, "label": "Service area"}
selected marketplaces style:{"column": "facility_l", "markersize": 75, "categorical": true, "label": "Selected marketplaces"}
schools style:{"color": "#1f5fbf", "markersize": 30, "label": "Schools"}

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
