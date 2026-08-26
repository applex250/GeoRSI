import numpy as np
import pandas as pd
import libpysal as ps
from mgwr.gwr import GWR, MGWR
from mgwr.sel_bw import Sel_BW
from mgwr.utils import compare_surfaces, truncate_colormap
import geopandas as gp
import matplotlib.pyplot as plt
import matplotlib as mpl
def main():
    georgia = gp.read_file(ps.examples.get_path('G_utm.shp'))

    g_y = georgia['PctBach'].values.reshape((-1, 1))
    g_X = georgia[['PctFB', 'PctBlack', 'PctRural']].values
    u = georgia['X']
    v = georgia['Y']
    g_coords = list(zip(u, v))

    gwr_selector = Sel_BW(g_coords, g_y, g_X)
    gwr_bw = gwr_selector.search()

    gwr_model = GWR(g_coords, g_y, g_X, bw=gwr_bw)
    gwr_results = gwr_model.fit()

    fig, ax = plt.subplots(2, 3, figsize = (10, 6))
    bws = (x for x in range(25, 175, 25))
    vmins = []
    vmaxs = []
    for row in range(2):
        for col in range(3):
            bw = next(bws)
            gwr_model = GWR(g_coords, g_y, g_X, bw)
            gwr_results = gwr_model.fit()
            georgia['rural'] = gwr_results.params[:, -1]
            georgia.plot('rural', ax = ax[row, col])
            ax[row,col].set_title('Bandwidth: ' + str(bw))
            ax[row,col].get_xaxis().set_visible(False)
            ax[row,col].get_yaxis().set_visible(False)
            vmins.append(georgia['rural'].min())
            vmaxs.append(georgia['rural'].max())
    sm = plt.cm.ScalarMappable(norm=plt.Normalize(vmin=min(vmins), vmax=max(vmaxs)))
    fig.tight_layout()
    fig.subplots_adjust(right=0.9)
    cax = fig.add_axes([0.92, 0.14, 0.03, 0.75])
    sm._A = []
    cbar = fig.colorbar(sm, cax=cax)
    cbar.ax.tick_params(labelsize=10)
    plt.savefig('GWR_Bandwidth_Comparison.png', dpi=300)

if __name__ == "__main__":
    main()