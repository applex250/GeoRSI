# Geostatistical Analysis

## Task
Your task is to analyze COVID-19 risk in HKG. First, use similarity search to map transmission risk from hkg_constituency.shp and target_risk.shp. Second, join transmission risk map. Then do the same search and join functions for the other three risk map (susceptibility risk, healthcare resource scarcity risk, and exposure risk). Finally, use multivariate clustering to map the COVID-19 risk profiles of HKG as "hkg_covid_risk_profiles.png".

## Data
dataset/hkg_constituency.shp: This shapefile contains data for 431 Hong Kong constituencies. The data includes demographic and spatial information that can be used to assess the risk of disease transmission, COVID- 19 susceptibility, and healthcare resource scarcity.
dataset/target_risk.shp: The attributes for the target_risk shapefile are similar to those for the hkg_constituency.shp. The values in the target_risk, however, are the worst-case values found throughout Hong Kong. They include the densest population value, the largest number of seniors per 1,000 people, the highest index for tobacco, the smallest purchasing power value, and so on. These worst-case values will be used as the target against which all other constituencies will be ranked in order to determine risk.

## Expected deliverable style
style: {"column": <placeholder>,"cmap": "tab20", "edgecolor": "black", "linewidth": 0.2, "categorical": True}

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
