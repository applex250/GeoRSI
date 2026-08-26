# Analyze of human sentiments of heat exposure using social media data

## Instruction
Your task is to do a national-scale analysis of human sentiments of heat exposure using location-based social media Twitter data. Based on a heat vocab dictionary file, you will construct a dictionary to store the values of each vocabulary. You will retrieve all weather related tweets from the loaded json file. Then you will assign the tweets to counties in USA. You will count the number of tweet to sum their values and find the mean to be the heat exposure value. You will also have to normalize the heat exposure values with max and min. Finally, visualize the results in a choropleth map using natural break and save the results as "pred_results/US_heat_exposure_map.png".

## Domain knowledge
Human Sentiments: Emotions, opinions, and attitude from posts on social media platform, which reflects people's sentiments.

Heat Exposure锛欵xtreme heat related weather condition.

## Data
dataset/data20000.txt: Stores 20000 weather related vocabularies along with their sentiment scores in the form of "term: 0.42".

dataset/12500-tweets-2021-09-24_01-48-23.json: Json file that stores 12500 tweets in United states on 2021/09/25. Some of the tweets are geotagged that it has longitudes and latitudes.

dataset/cb_2020_us_county_20m.shp: County Shapefiles for USA. It has polygon geometry for each county.

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
