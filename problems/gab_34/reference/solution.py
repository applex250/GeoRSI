import geopandas as gpd
import matplotlib.pyplot as plt

def main():
    roads = gpd.read_file("dataset/AllSeasonRoads.geojson")
    metropolitan = gpd.read_file("dataset/ShikokuMetropolitan.geojson")
    population = gpd.read_file("dataset/ShikokuPopulation.geojson")

    #clip population to rural area
    rural = metropolitan[metropolitan["AREATYPE"] == "RURAL"]
    population_rural = gpd.clip(population, rural)

    #buffer roads by 2km
    roads_buffered = roads.buffer(2000)
    #clip roads to rural area
    roads_rural = gpd.clip(population_rural, roads_buffered)

    #calculate the proportion of area of clipped_roads to population_rural
    roads_rural["area"] = roads_rural["geometry"].area
    population_rural["area"] = population_rural["geometry"].area
    roads_rural["proportion"] = roads_rural["area"] / population_rural["area"]
    population_rural["proportion"] = roads_rural["area"] / population_rural["area"]
    population_rural["population_proportion"] = population_rural["D0001"] * population_rural["proportion"] / population_rural["D0001"]

    fig, ax = plt.subplots(figsize=(10, 8))
    population_rural.plot(ax=ax, column="population_proportion", cmap="Greens", legend=True)
    roads.plot(ax=ax, color='black')
    ax.set_title("Proportion of Population with Access to Roads in 2km")
    fig.savefig("population_rural_proportion.png")


if __name__ == "__main__":
    main()