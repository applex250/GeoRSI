import arcpy

# Set up the input shapefiles and output locations
input_results_shp = r"dataset/High_Blood_Level_Results.shp"
input_zipcodes_shp = r"dataset/Sacramento_ZIP_Codes.shp"
output_folder = r"/dataset"
output_image = r"dataset/BloodLead_HotSpot_Tessellation.png"

# Perform Optimized Hot Spot Analysis
hotspot_output = r"dataset/High_Blood_Level_Results_OptimizedHotSpotAnalysis.shp"
arcpy.stats.OptimizedHotSpotAnalysis(
    input_results_shp,
    hotspot_output,
    None,  # No analysis field
    "COUNT_INCIDENTS_WITHIN_HEXAGON_POLYGONS",
    input_zipcodes_shp,
    None,  # No time aggregation
    None,  # No bounding polygon
    None,  # No polygon aggregation
    None   # No case field
)

# Add the output of the Hot Spot Analysis to the map
hotspot_layer = arcpy.management.MakeFeatureLayer(hotspot_output, "Hot_Spot_Layer")

# Create tessellation using hexagons
tessellation_output = r"dataset/Tessellated_Hexagons.shp"
arcpy.management.GenerateTessellation(tessellation_output, 
                                      hotspot_layer.getExtent(),
                                      "HEXAGON", 
                                      "1 SquareKilometers")

# Summarize the total number of features within each hexagon (polygon)
summary_output = r"dataset/Tessellation_Summary.shp"
arcpy.analysis.SummarizeWithin(tessellation_output, 
                               input_results_shp, 
                               summary_output, 
                               statistics_fields=[["FID", "COUNT"]])

# Add tessellation layer to the map
tessellation_layer = arcpy.management.MakeFeatureLayer(summary_output, "Tessellation_Layer")

# Set symbology to show total feature count within polygons (optional customization)
# Apply symbology layer if available; else skip this step
# arcpy.management.ApplySymbologyFromLayer(tessellation_layer, "Count_Symbology_Layer.lyrx")

# Export the final map as a .png image
aprx = arcpy.mp.ArcGISProject(r"dataset/BloodLeadLevels.aprx")
layout = aprx.listLayouts()[0]
layout.exportToPNG(output_image)

print(f"Output image saved at {output_image}")