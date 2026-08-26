import arcpy
from arcpy.sa import *


def Model():  # Model

    # To allow overwriting outputs change overwriteOutput option to True.
    arcpy.env.overwriteOutput = True

    # Check out any necessary licenses.
    arcpy.CheckOutExtension("spatial")

    parcels_shp = "dataset/parcels.shp"
    impervious_tif = arcpy.Raster("dataset/impervious.tif")

    # Process: Tabulate Area (Tabulate Area) (sa)
    impervious_area = rf"{arcpy.env.workspace}/impervious_area"
    arcpy.sa.TabulateArea(
        parcels_shp,
        "Parcel_ID",
        impervious_tif,
        "Value",
        impervious_area,
        impervious_tif,
        "CLASSES_AS_FIELDS",
    )

    # Process: Add Join (Add Join) (management)
    parcels_Layer = arcpy.management.AddJoin(
        in_layer_or_view=parcels_shp,
        in_field="Parcel_ID",
        join_table=impervious_area,
        join_field="PARCEL_ID",
        join_type="KEEP_ALL",
        index_join_fields="NO_INDEX_JOIN_FIELDS",
        rebuild_index="NO_REBUILD_INDEX",
    )[0]

    # Process: Copy Features (Copy Features) (management)
    parcels_joint_shp = "output/parcels_joint.shp"
    arcpy.management.CopyFeatures(
        in_features=parcels_Layer, out_feature_class=parcels_joint_shp
    )


if __name__ == "__main__":
    # Global Environment settings
    with arcpy.EnvManager(
        scratchWorkspace="calculate_impervious_area.gdb", workspace="calculate_impervious_area.gdb"
    ):
        Model()
