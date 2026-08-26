import arcpy

# Check out necessary extensions
arcpy.CheckOutExtension("3D")
arcpy.CheckOutExtension("spatial")
arcpy.CheckOutExtension("ImageAnalyst")

# Set paths for input data and outputs
raster_2000 = "dataset\2015_Nature_Africa_PR.2000.tif"
raster_2015 = "dataset\2015_Nature_Africa_PR.2015.tif"
output_difference = "dataset\Malaria_Change.tif"
output_classified = "dataset\Malaria_Change_Classified.tif"
 

# Step 1: Load Data (Automatically handled when specifying inputs in arcpy)
raster_2015 = arcpy.Raster(input_2015)
raster_2000 = arcpy.Raster(input_2000)


# Step 2: Calculate difference using the Minus tool
print("Calculating the difference between 2015 and 2000...")
arcpy.ddd.Minus(
        in_raster_or_constant1=raster_2015,
        in_raster_or_constant2=raster_2000,
        out_raster=output_difference
		)

# Step 3: Classify the difference into categories
remap_table = arcpy.sa.RemapRange([
    [-1.0, -0.3, 1],  # Significant decrease
    [-0.3, -0.1, 2],  # Slight decrease
    [-0.1, 0.1, 3],   # No change
    [0.1, 0.3, 4],    # Slight increase
    [0.3, 1.0, 5]     # Significant increase
	])
classified_raster = arcpy.sa.Reclassify(output_difference, "VALUE", remap_table)

#Step 4: Visualize Results
classified_raster.save(output_classified)
		