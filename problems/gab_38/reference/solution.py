import folium
import geopandas as gpd
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np
import os
import osmnx as ox

def main():
    nhb_graph = ox.graph_from_address("1301 W Green St, Urbana, IL 61801", network_type="drive")

    nhb_graph = ox.add_edge_speeds(nhb_graph)
    nhb_graph = ox.add_edge_travel_times(nhb_graph)

    nhb_coords = (40.109442588847976, -88.22625178710955)
    nhb_node = ox.nearest_nodes(nhb_graph, X=nhb_coords[1], Y=nhb_coords[0])
    node_colors = ['red' if node == nhb_node else 'white' for node in nhb_graph.nodes()]
    distances = nx.single_source_dijkstra_path_length(nhb_graph,
                                                  nhb_node,
                                                  weight="travel_time")
    nx.set_node_attributes(nhb_graph, distances, "time2nhb")
    node_colors = ox.plot.get_node_colors_by_attr(nhb_graph, "time2nhb", cmap="RdYlBu")
    ox.plot_graph(nhb_graph, node_size=100, save=True, node_color=node_colors)



if __name__ == "__main__":
    main()