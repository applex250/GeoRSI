import arcpy


def main():
    # load raster
    vulnerableAreas = arcpy.Raster("./dataset/vulnerable_areas.tif")
    landCover = arcpy.Raster("./dataset/land_cover.tif")

    # reclassify, vulnerable areas
    minValue = vulnerableAreas.minimum
    maxValue = vulnerableAreas.maximum
    reclassVulnerable = 9 * (vulnerableAreas - minValue) / (maxValue - minValue) + 1

    # reclassify, land cover
    reclassLandCover = arcpy.sa.Reclassify(
        landCover,
        "Value",
        arcpy.sa.RemapValue(
            [
                [11, 1],
                [21, 6],
                [22, 7],
                [23, 8],
                [24, 10],
                [31, 4],
                [41, 3],
                [42, 1],
                [43, 3],
                [52, 3],
                [71, 2],
                [81, 5],
                [82, 9],
                [90, 1],
                [95, 1],
            ]
        ),
        "NODATA",
    )

    # raster calculator, cal risk zones
    riskZones = (reclassVulnerable * 8) + (reclassLandCover * 10)

    highRiskZones = arcpy.sa.Con(
        in_conditional_raster=riskZones,
        in_true_raster_or_constant=riskZones,
        in_false_raster_or_constant=None,
        where_clause="VALUE > 100",
    )

    with arcpy.EnvManager(mask=highRiskZones):
        outRaster = arcpy.sa.Con(
            in_conditional_raster=landCover,
            in_true_raster_or_constant=landCover,
            in_false_raster_or_constant=None,
            where_clause="Class IN ('Deciduous Forest', 'Emergent Herbaceous Wetlands', 'Hay/Pasture', 'Herbaceous', 'Mixed Forest', 'Shrub/Scrub', 'Woody Wetlands', 'Barren Land')",
        )
        outRaster.save("./output/undeveloped_areas.tif")


if __name__ == "__main__":
    try:
        # check if arcpy has spatial extension
        arcpy.CheckOutExtension("Spatial")
        main()
    except arcpy.ExecuteError as e:
        print(f"ArcPy Error: {e}")
    except Exception as e:
        print(f"Unknown Error: {e}")