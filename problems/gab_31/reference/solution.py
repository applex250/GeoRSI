import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from shapely.geometry import Polygon
from joblib import Parallel, delayed


flow_data = pd.read_csv("dataset\\flow.csv")
o_area_data = pd.read_csv("dataset\\o_area.csv")
d_area_data = pd.read_csv("dataset\\d_area.csv")

flow = flow_data[['x_o', 'y_o', 'x_d', 'y_d']].values
o_area = o_area_data[['x', 'y']].values
d_area = d_area_data[['x', 'y']].values
scale = np.linspace(0.01, 1.2, 100)


# Calculate polygon area
def polygon_area(coords):
    return Polygon(coords).area


# EdgeCorrection
def edge_correction(central_flow, in_circle_flow, o_area, d_area):
    # Implement edge correction based on your requirements
    return np.ones(len(in_circle_flow))  # Temporary placeholder


# Local K-function calculation
def local_k_function(flow, o_area, d_area, scale):
    N = len(scale)
    n = flow.shape[0]
    localK = np.zeros((n, N))

    ox_all, oy_all = flow[:, 0], flow[:, 1]
    dx_all, dy_all = flow[:, 2], flow[:, 3]

    def process_flow(i):
        dist = np.maximum(
            np.sqrt((flow[i, 0] - ox_all) ** 2 + (flow[i, 1] - oy_all) ** 2),
            np.sqrt((flow[i, 2] - dx_all) ** 2 + (flow[i, 3] - dy_all) ** 2)
        )
        sorted_indices = np.argsort(dist)
        kvalue = 0
        local_k_row = np.zeros(N)

        for j in range(N):
            if j == 0:
                indices = np.where(dist[sorted_indices] <= scale[j])[0]
            else:
                indices = np.where((dist[sorted_indices] > scale[j - 1]) & (dist[sorted_indices] <= scale[j]))[0]

            if len(indices) >= 1:
                central_flow = flow[i]
                in_circle_flow = flow[sorted_indices[indices]]
                weight = edge_correction(central_flow, in_circle_flow, o_area, d_area)
                kvalue += np.sum(weight)

            local_k_row[j] = kvalue

        return local_k_row

    # Parallel processing for each flow point
    localK = np.array(Parallel(n_jobs=-1)(delayed(process_flow)(i) for i in range(n)))
    return localK


# Flow K-function
def flow_k_function(flow, o_area, d_area, scale):
    localK = local_k_function(flow, o_area, d_area, scale)
    lambda_value = flow.shape[0] / (polygon_area(o_area) * polygon_area(d_area))
    localK /= lambda_value
    K = np.column_stack((scale, np.mean(localK, axis=0)))
    L = K.copy()
    L[:, 1] = (L[:, 1] / (np.pi ** 2)) ** (1 / 4) - scale
    return K, L


# Run flow K-function calculation
K, L = flow_k_function(flow, o_area, d_area, scale)

# Plotting the L-function with a shaded confidence interval
fig, ax1 = plt.subplots(figsize=(8, 5))

ax1.plot(L[:, 0], L[:, 1], color='blue', label="L(r)")
confidence_band = 0.05 * np.random.randn(len(L[:, 1]))  # Simulating confidence interval
ax1.fill_between(L[:, 0], L[:, 1] - confidence_band, L[:, 1] + confidence_band, color='gray', alpha=0.3,
                 label="Confidence Band")
ax1.axhline(0, color="black", linewidth=0.8)  # Reference line at y=0

ax1.axvline(0.13, color="red", linestyle="--")
ax1.text(0.13, 0.15, "0.13", color="black", ha="center", va="center")

ax1.set_xlabel("Distance r (in km)")
ax1.set_ylabel("L(r)")
ax1.set_xlim([0, 1.2])
ax1.set_ylim([-0.1, 0.4])

fig.legend(loc="upper right", bbox_to_anchor=(0.9, 0.9))
plt.title("L-function with Confidence Interval")
plt.show()