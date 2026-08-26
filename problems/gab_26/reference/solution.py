
import arcpy


def main():
    # project, raster
    arcpy.management.ProjectRaster(
        in_raster="./dataset/mc_land_cover.tif",
        out_raster="in_memory/land_cover",
        in_coor_system='PROJCS["Albers_Conical_Equal_Area",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers"],PARAMETER["false_easting",0.0],PARAMETER["false_northing",0.0],PARAMETER["central_meridian",-96.0],PARAMETER["standard_parallel_1",29.5],PARAMETER["standard_parallel_2",45.5],PARAMETER["latitude_of_origin",23.0],UNIT["Meter",1.0]]',
        # in_coor_system=102008,  # Albers_Conical_Equal_Area
        out_coor_system=32126,  # NAD_1983_StatePlane_Oregon_North_FIPS_3601_Feet
        geographic_transform="WGS_1984_(ITRF00)_To_NAD_1983",
        resampling_type="NEAREST",
        Registration_Point=None,
        vertical="NO_VERTICAL",
    )

    # project, shp
    arcpy.management.Project(
        in_dataset="./dataset/mc_soils.shp",
        out_dataset="in_memory/soils",
        in_coor_system=102039,  # NAD_1983_Contiguous_USA_Albers
        out_coor_system=32126,  # NAD_1983_StatePlane_Oregon_North_FIPS_3601_Feet
        transform_method=None,
        preserve_shape="NO_PRESERVE_SHAPE",
        max_deviation=None,
        vertical="NO_VERTICAL",
    )

    # set env
    arcpy.env.outputCoordinateSystem = arcpy.SpatialReference(
        "NAD 1983 StatePlane Oregon North FIPS 3601 (US Feet)"
    )
    arcpy.env.extent = arcpy.Describe("./dataset/mc_boundary.shp").extent
    arcpy.env.cellSize = arcpy.Describe("in_memory/land_cover").meanCellWidth
    arcpy.env.snapRaster = "in_memory/land_cover"

    # convert, get drainage conditions from soils
    arcpy.conversion.PolygonToRaster(
        in_features="in_memory/soils",
        out_rasterdataset="in_memory/drainage_conditions",
        value_field="drclassdcd",
        cell_assignment="CELL_CENTER",
        priority_field="NONE",
        cellsize="in_memory/land_cover",
        build_rat="BUILD",
    )

    # convert, get water depth from soils
    arcpy.conversion.PolygonToRaster(
        in_features="in_memory/soils",
        out_rasterdataset="in_memory/water_depth",
        value_field="wdepannmin",
        cell_assignment="CELL_CENTER",
        priority_field="NONE",
        cellsize="in_memory/land_cover",
        build_rat="BUILD",
    )

    arcpy.ResetEnvironments()

    # reclassify, drainage conditions
    reclassDrainageConditions = arcpy.sa.Reclassify(
        "in_memory/drainage_conditions",
        "Value",
        arcpy.sa.RemapValue([[1, 3], [2, 1], [3, 4], [4, 5], [5, 2]]),
        "NODATA",
    )

    # reclassify, water depth
    reclassWaterDepth = arcpy.sa.Reclassify(
        "in_memory/water_depth",
        "Value",
        arcpy.sa.RemapRange(
            [[0, 10, 5], [10, 33, 4], [33, 61, 3], [61, 80, 2], [80, 92, 1]]
        ),
        "NODATA",
    )

    # raster calculator, cal vulnerable areas
    vulnerableAreas = (reclassDrainageConditions * 5) + (reclassWaterDepth * 4)
    vulnerableAreas.save("./output/vulnerable_areas.tif")


if __name__ == "__main__":
    try:
        # check if arcpy has spatial extension
        arcpy.CheckOutExtension("Spatial")
        main()
    except arcpy.ExecuteError as e:
        print(f"ArcPy Error: {e}")
    except Exception as e:
        print(f"Unknown Error: {e}")