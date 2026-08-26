import geopandas as gpd
import os

def model():
    # Define the workspace
    workspace = "dataset"

    # List the feature classes in the workspace
    fc_list = [f for f in os.listdir(workspace) if f.endswith('.geojson')]

    # Print the list
    print(fc_list)

    for fc in fc_list:
        gdf = gpd.read_file(os.path.join(workspace, fc))
        count = len(gdf)
        print(fc, count)

    # Set overwriteOutput (this is managed by simply saving the file with geopandas)

    # Create buffer for fire stations
    fire_stations_path = os.path.join(workspace, "fire_stations.geojson")
    fire_stations = gpd.read_file(fire_stations_path)
    fire_buffer = fire_stations.buffer(2500)  # Buffer of 2500 meters

    # Save the buffered fire stations
    fire_buffer_gdf = gpd.GeoDataFrame(geometry=fire_buffer, crs=fire_stations.crs)
    fire_buffer_path = os.path.join(workspace, "fire_buffer.geojson")
    fire_buffer_gdf.to_file(fire_buffer_path, driver='GeoJSON')

    # Visualize the most compromised areas in terms of fire service
    etobicoke_path = os.path.join(workspace, "etobicoke.geojson")
    etobicoke = gpd.read_file(etobicoke_path)
    no_service = gpd.overlay(etobicoke, fire_buffer_gdf, how='difference')

    # Save the no service area
    no_service_path = os.path.join(workspace, "no_service.geojson")
    no_service.to_file(no_service_path, driver='GeoJSON')

if __name__ == '__main__':
    model()
