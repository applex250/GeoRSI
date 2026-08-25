import arcpy
from arcpy.sa import *
from arcpy.sa import *
from arcpy.sa import *
from arcpy.sa import *
from arcpy.sa import *
from arcpy.sa import *
from arcpy.sa import *
from arcpy.sa import *


def Model():  # Model

    # To allow overwriting outputs change overwriteOutput option to True.
    arcpy.env.overwriteOutput = True

    # Check out any necessary licenses.
    arcpy.CheckOutExtension("3D")
    arcpy.CheckOutExtension("spatial")
    arcpy.CheckOutExtension("ImageAnalyst")

    mc_boundary_shp = "dataset/mc_boundary.shp"
    land_cover_tif = "dataset/land_cover.tif"
    mc_soils_shp = "dataset/mc_soils.shp"

    # Process: Project (Project) (management)
    soils = rf"{arcpy.env.workspace}/soils"
    arcpy.management.Project(
        in_dataset=mc_soils_shp,
        out_dataset=soils,
        out_coor_system='PROJCS["NAD_1983_StatePlane_Oregon_North_FIPS_3601",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",2500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-120.5],PARAMETER["Standard_Parallel_1",44.33333333333334],PARAMETER["Standard_Parallel_2",46.0],PARAMETER["Latitude_Of_Origin",43.66666666666666],UNIT["Meter",1.0]]',
    )

    # Process: Polygon to Raster (Polygon to Raster) (conversion)
    drainage_conditions = rf"{arcpy.env.workspace}/drainage_conditions"
    arcpy.conversion.PolygonToRaster(
        in_features=soils,
        value_field="drclassdcd",
        out_rasterdataset=drainage_conditions,
        cellsize=land_cover_tif,
    )

    # Process: Reclassify (Reclassify) (sa)
    reclass_drainage_conditions = rf"{arcpy.env.workspace}/reclass_drainage_conditions"
    Reclassify = reclass_drainage_conditions
    reclass_drainage_conditions = arcpy.sa.Reclassify(
        drainage_conditions, "VALUE", "1 3;2 1;3 4;4 5;5 2", "NODATA"
    )
    reclass_drainage_conditions.save(Reclassify)

    # Process: Polygon to Raster (2) (Polygon to Raster) (conversion)
    water_depth = rf"{arcpy.env.workspace}/water_depth"
    with arcpy.EnvManager(
        outputCoordinateSystem='PROJCS["NAD_1983_StatePlane_Oregon_North_FIPS_3601",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",2500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-120.5],PARAMETER["Standard_Parallel_1",44.33333333333334],PARAMETER["Standard_Parallel_2",46.0],PARAMETER["Latitude_Of_Origin",43.66666666666666],UNIT["Meter",1.0]]'
    ):
        arcpy.conversion.PolygonToRaster(
            in_features=soils,
            value_field="wdepannmin",
            out_rasterdataset=water_depth,
            cellsize=land_cover_tif,
        )

    # Process: Reclassify (2) (Reclassify) (sa)
    reclass_water_depth = rf"{arcpy.env.workspace}/reclass_water_depth"
    Reclassify_2_ = reclass_water_depth
    reclass_water_depth = arcpy.sa.Reclassify(
        water_depth, "VALUE", "0 10 5;10 33 4;33 61 3;61 80 2;80 92 1", "NODATA"
    )
    reclass_water_depth.save(Reclassify_2_)

    # Process: Raster Calculator (Raster Calculator) (sa)
    vulnerable_areas = rf"{arcpy.env.workspace}/vulnerable_areas"
    Raster_Calculator = vulnerable_areas
    vulnerable_areas = reclass_drainage_conditions * 5 + reclass_water_depth * 4
    vulnerable_areas.save(Raster_Calculator)

    # Process: Raster Calculator (2) (Raster Calculator) (sa)
    reclass_vulnerable = rf"{arcpy.env.workspace}/reclass_vulnerable"
    Raster_Calculator_2_ = reclass_vulnerable
    reclass_vulnerable = 1 + 9 * (vulnerable_areas - vulnerable_areas.minimum) / (
        vulnerable_areas.maximum - vulnerable_areas.minimum
    )
    reclass_vulnerable.save(Raster_Calculator_2_)

    # Process: Reclassify (3) (Reclassify) (sa)
    reclass_land_cover = rf"{arcpy.env.workspace}/reclass_land_cover"
    Reclassify_3_ = reclass_land_cover
    reclass_land_cover = arcpy.sa.Reclassify(
        land_cover_tif,
        "Value",
        "11 1;21 6;22 7;23 8;24 10;31 4;41 3;42 1;43 3;52 3;71 2;81 5;82 9;90 1;95 1",
        "NODATA",
    )
    reclass_land_cover.save(Reclassify_3_)

    # Process: Raster Calculator (3) (Raster Calculator) (sa)
    risk_zones = rf"{arcpy.env.workspace}/risk_zones"
    Raster_Calculator_3_ = risk_zones
    risk_zones = reclass_vulnerable * 8 + reclass_land_cover * 10
    risk_zones.save(Raster_Calculator_3_)

    # Process: Con (Con) (sa)
    high_risk_zones = rf"{arcpy.env.workspace}/high_risk_zones"
    Con = high_risk_zones
    high_risk_zones = arcpy.sa.Con(risk_zones, risk_zones, "", "VALUE > 100")
    high_risk_zones.save(Con)

    # Process: Con (2) (Con) (sa)
    undeveloped_areas_tif = "output/undeveloped_areas.tif"
    Con_2_ = undeveloped_areas_tif
    with arcpy.EnvManager(mask=high_risk_zones):
        undeveloped_areas_tif = arcpy.sa.Con(
            land_cover_tif,
            land_cover_tif,
            "",
            "Class IN ('Deciduous Forest', 'Emergent Herbaceous Wetlands', 'Hay/Pasture', 'Herbaceous', 'Mixed Forest', 'Shrub/Scrub', 'Woody Wetlands', 'Barren Land')",
        )
        undeveloped_areas_tif.save(Con_2_)


if __name__ == "__main__":
    # Global Environment settings
    with arcpy.EnvManager(scratchWorkspace="groundwater_risk_zones.gdb", workspace="groundwater_risk_zones.gdb"):
        Model()