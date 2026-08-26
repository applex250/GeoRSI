import pytz
from datetime import datetime, timedelta
import os
import geopandas as gpd
import json
from shapely.geometry import Polygon, Point, MultiPolygon
import shapefile
import re
import shapefile as shp  # Requires the pyshp package
import matplotlib.pyplot as plt
import pandas as pd
import matplotlib.colors as mcolors
import numpy as np


if __name__ == "__main__":
    # 1. Processing Twitter/X Data
    ## Read the word heat dictionary
    f = open('./data20000.txt','r')
    content = f.read()
    f.close()
    dict_word = {}
    content_list = content.split(",")
    for i in range(0,len(content_list)):
        try:
            word = content_list[i].split(":")[0].split("'")[1]
            #print(content_list[i].split(":"))
            val = float(content_list[i].split(":")[1])
            dict_word[word] = val
        except:
            pass

    #2. Retrieve All Weather-related Data

    filelist = ['12500-tweets-2021-09-24_01-48-23.json']
    ## Use the file on

    ## Create a dictionary for storing all Twitter with index = GEOID


    heat_twitter = []

    # Opening JSON file
    for filename in filelist:
        filepath = "./data/"+filename
        print(filepath)
        #print(len(heat_twitter))
        f = open(filepath)
        data = json.load(f)


        for i in range(0, len(data)):
            #if (i%50000 == 0):
            #    print(i)
            try:

                ##Need to deal with case when the shapefile is too big
                text = data[i]["text"]
                exact_loc = -1
                ## Case 1
                ## Twitter with exact geospatial location
                if (data[i]['geo']!=None):
                    lat = data[i]['geo']['coordinates'][0]
                    lon = data[i]['geo']['coordinates'][1]
                    exact_loc = Point(lon, lat)
                elif (data[i]['place']!=None):
                    ## Twitter with a polygon bounding box
                    ## We check which county the centroid of the point lies in
                    poly = data[i]['place']['bounding_box']["coordinates"][0]
                    lon = [p[0] for p in poly]
                    lat = [p[1] for p in poly]
                    centroid = (sum(lon) / len(poly), sum(lat) / len(poly))
                    exact_loc = Point(centroid)
                ## Find all the twitter with heat geotagged
                res = re.findall(r'\w+', text.lower())
                val = 0
                for word in res:
                    if word in dict_word.keys():
                        val = val + dict_word[word]
                ## remove weather-irrelevant twitter
                ## if none of the word in the heat dictionary show up
                if (val!=0):
                    heat_twitter.append((exact_loc, val))
            except:
                ## no geographical location
                pass
        # Closing file
        f.close()

    print("There are "+str(len(heat_twitter))+" weather-related Twitter")
    #3. Assign All the Collected Social Media Data to Counties in the US
    ## Get US data
    US = gpd.read_file("./US/cb_2020_us_county_20m.shp")
    twitter_in_US = {}
    ## Find which county the heat twitter data falls into
    ## This may take a while
    i = 0
    for twitter in heat_twitter:
        ## Track the progress
        if (i%1000==0):
            print("#", end='')
        #print(i)
        i = i+1
        #if (i==10):
        #    break
        try:
            exact_loc = twitter[0]
            val = twitter[1]
            for index, row in US.iterrows():
                if (row['geometry'].contains(exact_loc)):
                    ## the twitter falls into the this county
                    countyid = row["GEOID"]
                    if (countyid in twitter_in_US.keys()):
                        twitter_in_US[countyid].append(val)
                    else:
                        twitter_in_US[countyid] = [val]
                    break
        except:
            pass

    # 4. Calculate the The Heat Exposure and the Number of Posts in Each County
    ## Get the number of heat-related twitter collected in each county
    ## get the heat exposure value for each county = average value of twitter
    number_of_twitter_county = {}
    heat_exposure_county = {}
    for key in twitter_in_US.keys():
        number_of_twitter_county[key] = len(twitter_in_US[key])
        heat_exposure_county[key] = np.mean(twitter_in_US[key])

    ## append the lines to US dataframe
    US["number_of_twitter"] = 0
    US["heat_exposure"] = None

    #i = 0
    twitter_number = []
    heat_exposure = []

    for index, row in US.iterrows():
        geoid = str(row['GEOID'])
        if (geoid in heat_exposure_county.keys()):
            #print("here")
            #i = i+1
            twitter_number.append(number_of_twitter_county[geoid])
            heat_exposure.append(heat_exposure_county[geoid])
        else:
            twitter_number.append(0)
            heat_exposure.append(None)
    US["number_of_twitter"] = twitter_number
    US["heat_exposure"] = heat_exposure

    ## Normalize the heat exposure
    mx = max(list(heat_exposure_county.values()))
    mn = min(list(heat_exposure_county.values()))

    normalized_heat_exposure = []

    for i in range(0, len(heat_exposure)):
        if (heat_exposure[i]!=None):
            val = (heat_exposure[i]-mn)/(mx-mn)
            normalized_heat_exposure.append(val)
        else:
            normalized_heat_exposure.append(None)
    US["normalized_heat_exposure"] = normalized_heat_exposure

    # 5. Visualization

    ## Creating Choropleth Map with geopandas
    ## First create map for with the number of Twitter
    ## Actual Value of the the number of Twitter
    ## Natural Break
    fig, ax = plt.subplots(figsize=[20,10])
    US.plot(column = 'normalized_heat_exposure', #Assign numerical data column
                        scheme="natural_breaks",
                        k=5,
                        legend = True, #Decide to show legend or not
                        cmap = 'YlOrRd', #Name the legend
                        ax=ax)
    plt.savefig('heat_exposure_map.png', bbox_inches='tight', dpi=300)
    plt.close()