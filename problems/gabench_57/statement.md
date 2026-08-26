# Vector Spatial Analysis

## Task
请围绕固定目标点位开展道路网络服务范围分析。先将道路图层、目标点位图层和参考点位图层统一转换为 GeoJSON 中间数据，再基于道路网络构建有向图，并使用 MINUTES 字段作为通行成本。本次目标点位固定为市场点位图层中的“康复路批发市场”。请根据目标点位的 TYPE 字段确定服务时间阈值：一级为 8 分钟，二级为 6 分钟，三级为 4 分钟，四级为 3 分钟；若类型未命中，则默认使用 4 分钟。随后计算该目标点位沿道路网络可达的服务范围，并评估学校等参考点位是否处于该服务范围内。请输出覆盖统计和结构化结果，并生成包含道路网络、目标点位、参考点位和服务范围的总览图。最终服务范围可视化图保存为： service_area_overview.png

## Data
输入数据/道路网络图层: （dataset/network.shp）a LineString Shapefile used for service-area analysis. The MINUTES field is the travel-cost field; FT_MINUTES and TF_MINUTES are used when directional minute costs are available. METERS stores road length and ONEWAY records one-way restrictions.
输入数据/目标点位图层: (dataset/Marketplace.shp)a Point Shapefile storing target point locations. TYPE is mapped to service minutes, NAME stores the point name, and the target point is selected by name before service-area computation.
输入数据/参考点位图层:(dataset/school.shp) a Point Shapefile storing reference point locations used to evaluate whether each point is covered by the selected service range. The name field identifies each reference point in the coverage report.

## Expected deliverable style
road network style:{"color": "#c7cbd1", "linewidth": 0.55, "label": "Road network"}
school candidates style:{"color": "#1f5fbf", "markersize": 18, "alpha": 0.75, "label": "School candidates"}
marketplace candidates style:{"color": "#2f7d32", "markersize": 18, "alpha": 0.75, "label": "Marketplace candidates"}
shortest path style:{"color": "#d7191c", "linewidth": 3.0, "label": "Shortest path"}
selected start/end style:{"column": "role", "markersize": 75, "categorical": true, "label": "Selected start/end"}

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
