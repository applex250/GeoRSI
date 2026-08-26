# GeoBenchX task 529248

## Task
Which African countries have the most efficient distribution of power stations relative to population?

## Your toolkit (solution vocabulary)
Solutions are expressed as an ordered chain of tool calls. You do NOT call these
tools directly — you work with python (run_python / start_job; geopandas,
rasterio, pandas available) on the local files listed in the catalogs below,
then REPORT the chain you followed using this vocabulary:

| function | what it does |
|---|---|
| load_data(dataset, output_dataframe_name) | load a statistical dataset from DATA_CATALOG into a pandas DataFrame |
| load_geodata(geodataset, output_geodataframe_name) | load vector geodata from GEO_CATALOG into a GeoDataFrame |
| get_raster_path(rasterdataset) | resolve the path of a raster dataset from RASTER_CATALOG |
| get_raster_description(rasterdataset) | raster metadata (crs, bounds, nodata, dtype) |
| analyze_raster_overlap(raster1, raster2) | overlap statistics between two rasters |
| get_values_from_raster_with_geometries(rasterdataset, geodataframe, statistics, nodataval) | zonal statistics of a raster over geometries |
| merge_dataframes(dataframe_name, geodataframe_name, statkey, geokey, output_dataframe_name) | join statistical + geospatial tables on key columns |
| get_unique_values(dataframe_name, column_name) | unique values of a column (e.g. exact country/region spellings) |
| filter_categorical(dataframe_name, filters, output_dataframe_name) | keep rows matching categorical values |
| filter_numerical(dataframe_name, query, output_dataframe_name) | keep rows matching a numerical query expression |
| calculate_column_statistics(dataframe_name, column_name) | count/min/max/mean/std of a column |
| create_buffer(geodataframe_name, buffer_size, output_geodataframe_name) | buffer zones around geometries |
| make_choropleth_map(dataframe_name, mappingkey, legendtext, colormap) | choropleth map of a column |
| filter_points_by_raster_values(rasterdataset, geodataframe_name, filter_condition, ...) | sample raster at points and filter by threshold |
| select_features_by_spatial_relationship(input_geodataframe, related_geodataframe, spatial_predicates, ...) | spatial join/selection (intersects, within, ...) |
| calculate_line_lengths(geodataframe_name, output_column_name) | line feature lengths in km (UTM) |
| calculate_columns(output_column_name, operation, ...) | column arithmetic (multiply/divide/add/subtract) |
| scale_column_by_value(geodataframe_name, column_name, operation, scale_factor) | scale a column by a constant |
| make_heatmap(geodataframe_name, heat_column, heat_map_ws) | interactive heatmap of point data |
| visualize_geographies(geodataframe_name, ...) | draw geodata layers with custom styling |
| get_centroids(geodataframe_name, output_column_name) | polygon centroids |
| plot_contour_lines(rasterdataset, interval) | contour lines from a raster |
| generate_contours_display(rasterdataset, interval) | contour generation via GDAL |
| make_bivariate_map(x, y, ...) | bivariate choropleth of two variables |
| reject_task() | declare the task unsolvable with the available datasets/tools |


## Available datasets (catalogs)
The catalogs below are the complete list of datasets that exist. A task that
needs data not listed here cannot be solved with the toolkit and must be
rejected (see How to submit).

DATA_CATALOG (statistical tables, `data/StatData/`):
- `Forest area (sq. km)` -> `API_AG.LND.FRST.K2_DS2_en_csv_v2_2627`
- `Forest area (% of land area)` -> `API_AG.LND.FRST.ZS_DS2_en_csv_v2_102`
- `Electric power consumption (kWh per capita)` -> `API_EG.USE.ELEC.KH.PC_DS2_en_csv_v2_2767`
- `Annual freshwater withdrawals, total (billion cubic meters)` -> `API_ER.H2O.FWTL.K3_DS2_en_csv_v2_8364`
- `Annual freshwater withdrawals, total (% of internal resources)` -> `API_ER.H2O.FWTL.ZS_DS2_en_csv_v2_7098`
- `Agriculture, value added (% of GDP)` -> `API_NV.AGR.TOTL.ZS_DS2_en_csv_v2_4614`
- `GDP per capita (current US$)` -> `API_NY.GDP.PCAP.CD_DS2_en_csv_v2_77536`
- `Labor force, total` -> `API_SL.TLF.TOTL.IN_DS2_en_csv_v2_4341`
- `Net migration` -> `API_SM.POP.NETM_DS2_en_csv_v2_91`
- `Fertility rate, births per woman` -> `API_SP.DYN.TFRT.IN_DS2_en_csv_v2_821`
- `Population, total` -> `API_SP.POP.TOTL_DS2_en_csv_v2_56`
- `Rural population, total` -> `API_SP.RUR.TOTL_DS2_en_csv_v2_6835`
- `Greenhouse gases emission, per capita, tons of carbon dioxide-equivalents ` -> `GHG_emissions_OWID_wide.csv`
- `CO2 emissions per capita, tons` -> `per-capita-co-emissions_OWID_tons.csv`
- `Incidence of Tuberculosis Disease, 2023, Massachusetts Counties` -> `Incidence of Tuberculosis Disease 2023 Massachusetts Counties.csv`
- `Incidence of Tuberculosis Disease, 2023, New York State Counties` -> `NYS TB cases 2023.csv`
- `Rail lines (total route-km)` -> `API_IS.RRS.TOTL.KM_DS2_en_csv_v2_1937`
- `Regional GDP in departments (provinces) of Peru, constant prices 2007, thousand of soles` -> `Regional GDPs Peru.csv`

GEO_CATALOG (vector geodata, `data/Geodata/`):
- `Countries` -> `WB_countries_Admin0_10m.shp`
- `Amtrak railway stations` -> `Amtrak_Stations.shp`
- `Railway lines in Bangladesh` -> `Bangladesh_gis_osm_railways_free_1.shp`
- `Cities and Towns of the United States, 2014` -> `bx729wr3020.shp`
- `Railway Network of North America` -> `North_American_Rail_Network_Lines.shp`
- `Current Wildland Fire Incident Locations, size in acres` -> `Incidents.shp`
- `Rivers in North America` -> `northamerica_rivers_cec_2023.shp`
- `Lakes in North America` -> `northamerica_lakes_cec_2023.shp`
- `USA counties borders` -> `tl_2024_us_county.shp`
- `USA states borders` -> `tl_2024_us_state.shp`
- `Earthquakes occurences and magnitude March 15- February 14 2025` -> `earthquakes_30_days_Feb142025.shp`
- `Rivers in South America` -> `rivers_samerica_37330.shp`
- `Seaports of Latin America` -> `Ports_Latin_America.shp`
- `Railways in Brazil` -> `hotosm_bra_railways_lines_shp.shp`
- `Mineral extraction facilities in Africa` -> `Africa mineral facilities.shp`
- `Power stations in Africa` -> `Africa Power Stations.shp`
- `Railways in Africa` -> `Africa railways.shp`
- `Municipalities of Brazil` -> `bra_admbnda_adm2_ibge_2020.shp`
- `Regions of Peru` -> `per_admbnda_adm1_ign_20200714.shp`
- `Provinces of Peru` -> `per_admbnda_adm2_ign_20200714.shp`

## How to work
1. Decide whether the task is a geospatial task solvable with the catalog
   datasets and the toolkit above.
   - Not a geospatial task / does not need the provided datasets: just answer it
     directly (steps = [], reject = false).
   - Geospatial but NOT solvable with the available datasets or tools: submit
     reject = true (this is a valid, correct outcome — do not force an answer).
2. If solvable: actually do the analysis with python on the local files
   (inspect them, compute, produce any figure the task asks for). The datasets
   for the catalog live under `data/StatData/` and `data/Geodata/`
   (shapefile sidecar files are included).
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {
     "steps": [{"function_name": "<tool>", "arguments": {...}}, ...],
     "reject": false,
     "answer": "<the direct answer to the question, 1-3 sentences with key numbers>",
     "summary": "<method + main results, 2-4 sentences>"
   }
   For a rejection: {"steps": [], "reject": true, "reason": "<what is missing>"}

## Grading
Your reported chain is compared against expert reference solutions for this
task: same datasets and tool usage with correct results scores full; right
approach with minor discrepancies scores partial; wrong data/tools or a forced
answer where rejection was correct scores zero. A correct rejection scores
full. The public score only checks that your submission is well-formed.
