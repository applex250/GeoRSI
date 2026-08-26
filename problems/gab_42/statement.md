# Investigate spatial patterns for Airbnb prices in Berlin

## Instruction
Your task is to perform spatial autocorrelation analysis on airbnb prices in Berlin using Python. The analysis involves loading geospatial data of Berlin neighborhoods and real estate listings, and then converting to GeoDataFrame. You will perform a spatial join to associate listings with neighborhoods and calculate the median price for each neighborhood group. After handling missing data, you will analyze spatial similarity by creating a spatial weights matrix based on their median prices. The Local Moran's I statistic will be used to identify significant cold spots and hot spots. Finally, you will visualize these spatial patterns on a map, highlighting areas with significant spatial autocorrelation, and save the output as "moran_local.png".

## Domain knowledge
esda package: ESDA is an open-source Python library for the exploratory analysis of spatial data.

Spatial Similarity: Using queen contiguity to calculate spatial weight, which can be done by lps.weights.Queen function.

Moran's I: Measures spatial autocorrelation based on feature locations and attribute values using the Moran's I statistic. Can be calculated by esda.moran.Moran_Local function.

## Data
dataset/berling_neighbourhoods.geojson:Geojson file for multipolygons of neighbourhoods in Berling, properties include "neighbourhood" and "neighbourhood_group".

dataset/berlin-listings.csv: Csv file of Berling Airbnb information, with lat and lng of Airbnb.
Key Columns:	id scrape_id city state zipcode smart_location country_code	country latitude longitude price

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
