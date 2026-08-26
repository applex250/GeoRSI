import geopandas as gpd
import pandas as pd
from shapely.geometry import Point
import matplotlib.pyplot as plt

# Load the data
point_data_path = 'dataset/High_Blood_Level_Results.shp'
zip_data_path = 'dataset/Sacramento_ZIP_Codes.shp'
points_gdf = gpd.read_file(point_data_path)
zip_gdf = gpd.read_file(zip_data_path)

if points_gdf.crs != 'EPSG:4326':
    points_gdf = points_gdf.to_crs('EPSG:4326')
    
points_gdf['Latitude'] = points_gdf.geometry.y
points_gdf['Longitude'] = points_gdf.geometry.x


points_gdf['LatitudeRound'] = points_gdf['Latitude'].round(2)
points_gdf['LongitudeRound'] = points_gdf['Longitude'].round(2)

points_gdf['RoundedGeometry'] = points_gdf.apply(
    lambda row: Point(row['LongitudeRound'], row['LatitudeRound']), axis=1
)

points_gdf = gpd.GeoDataFrame(points_gdf, geometry='RoundedGeometry', crs='EPSG:4326')
rounded_points_count = points_gdf[['LongitudeRound', 'LatitudeRound']].drop_duplicates().shape[0]
original_points_count = points_gdf.shape[0]


reduction = (original_points_count - rounded_points_count) / original_points_count * 100
output_path = 'dataset/High_Blood_Level_Results_Rounded.shp'
points_gdf.to_file(output_path)


points_gdf.plot(marker='o', color='blue', markersize=5)
plt.title("Rounded Points")
plt.show()