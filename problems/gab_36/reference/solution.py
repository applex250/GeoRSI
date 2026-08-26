import arcpy

# Allow overwriting outputs
arcpy.env.overwriteOutput = True

# Check out necessary licenses
arcpy.CheckOutExtension("spatial")
arcpy.CheckOutExtension("ImageExt")
arcpy.CheckOutExtension("ImageAnalyst")

# Step 1. Load data
field_boundaries = r"dataset\Field_Boundaries.shp"
before_storm = r"dataset\Before_Storm.tif"
after_storm = r"dataset\After_Storm.tif"

# Step 2. Calculate SAVI for before and after storm
savi_before = "SAVI_Before"
savi_after = "SAVI_After"
savi_expression = "((Float(NIR) - Float(RED)) / (Float(NIR) + Float(RED) + 0.5)) * 1.5"
arcpy.sa.RasterCalculator([[before_storm, "NIR", 4], [before_storm, "RED", 3]], savi_expression).save(savi_before)
arcpy.sa.RasterCalculator([[after_storm, "NIR", 4], [after_storm, "RED", 3]], savi_expression).save(savi_after)

# Step 3. Compute vegetation loss
veg_loss = "Vegetation_Loss"
arcpy.sa.Minus(savi_before, savi_after).save(veg_loss)

# Step 4. Remap vegetation loss to remove negative values
remapped_loss = "Remapped_Veg_Loss"
arcpy.sa.Reclassify(veg_loss, "Value", arcpy.sa.RemapRange([[-0.6, 0, "NoData"], [0, 1.5, "DATA"]])).save(remapped_loss)

# Step 5. Perform Zonal Statistics
veg_loss_table = r"Vegation_loss_table.dbf"
arcpy.ia.ZonalStatisticsAsTable(
        in_zone_data=field_boundaries,
        zone_field="Field_ID",
        in_value_raster=remapped_loss,
        out_table=veg_loss_table,
        ignore_nodata="DATA",
        statistics_type="MEAN"
                )

# Step 6. Join Zonal Statistics table to field boundaries
arcpy.management.AddJoin(field_boundaries, "Field_ID", veg_loss_table, "Field_ID")

# Step 7. Visualize Results
arcpy.management.ApplySymbologyFromLayer(field_boundaries, r"Symbology.lyrx")
arcpy.management.SaveToLayerFile(field_boundaries, r"Field_Boundaries_Results.lyrx", "ABSOLUTE")