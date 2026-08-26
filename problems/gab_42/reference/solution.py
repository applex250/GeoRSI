import esda
import pandas as pd
import geopandas as gpd
from geopandas import GeoDataFrame
import libpysal as lps
import matplotlib.pyplot as plt
from shapely.geometry import Point
import matplotlib.colors as colors
def main():
    gdf = gpd.read_file('dataset/berlin-neighbourhoods.geojson')
    bl_df = pd.read_csv('dataset/berlin-listings.csv')
    geometry = [Point(xy) for xy in zip(bl_df.longitude, bl_df.latitude)]
    crs = {'init': 'epsg:4326'}
    bl_gdf = GeoDataFrame(bl_df, crs=crs, geometry=geometry)

    bl_gdf['price'] = bl_gdf['price'].astype('float32')
    sj_gdf = gpd.sjoin(gdf, bl_gdf, how='inner', op='intersects', lsuffix='left', rsuffix='right')
    median_price_gb = sj_gdf['price'].groupby([sj_gdf['neighbourhood_group']]).mean()

    gdf = gdf.join(median_price_gb, on='neighbourhood_group')
    gdf.rename(columns={'price': 'median_pri'}, inplace=True)


    gdf['median_pri'].fillna((gdf['median_pri'].mean()), inplace=True)


    #Spatial Similarity
    df = gdf
    wq =  lps.weights.Queen.from_dataframe(df)
    wq.transform = 'r'

    y = df['median_pri']

    li = esda.moran.Moran_Local(y, wq)
    sig = 1 * (li.p_sim < 0.05)
    hotspot = 1 * (sig * li.q==1)
    coldspot = 3 * (sig * li.q==3)
    doughnut = 2 * (sig * li.q==2)
    diamond = 4 * (sig * li.q==4)
    spots = hotspot + coldspot + doughnut + diamond

    spot_labels = [ '0 ns', '1 hot spot', '2 doughnut', '3 cold spot', '4 diamond']
    labels = [spot_labels[i] for i in spots]
    hmap = colors.ListedColormap([ 'lightgrey', 'red', 'lightblue', 'blue', 'pink'])
    f, ax = plt.subplots(1, figsize=(9, 9))
    df.assign(cl=labels).plot(column='cl', categorical=True, \
            k=2, cmap=hmap, linewidth=0.1, ax=ax, \
            edgecolor='white', legend=True)
    ax.set_axis_off()
    plt.title('Moran Local Spatial Autocorrelation')
    plt.savefig('moran_local.png')

if __name__ == "__main__":
    main()