#ArcPy Code
import arcpy
from arcpy.sa import *

def Model():  # Model

    # To allow overwriting outputs change overwriteOutput option to True.
    arcpy.env.overwriteOutput = False

    # Check out any necessary licenses.
    arcpy.CheckOutExtension("spatial")

    Elk_in_Southwestern_Alberta_2009 = "dataset/Elk_in_Southwestern_Alberta_2009"

    # Process: Minimum Bounding Geometry (Minimum Bounding Geometry) (management)
    Elk_in_MBG = "dataset/elk_home_range.gdb/Elk_in_MBG"
    arcpy.management.MinimumBoundingGeometry(
        in_features=Elk_in_Southwestern_Alberta_2009,
        out_feature_class=Elk_in_MBG,
        geometry_type="CONVEX_HULL"
    )

    # Process: Kernel Density (Kernel Density) (sa)
    Elk_KD = "dataset/elk_home_range.gdb/KernelD_Elk_1"
    Kernel_Density = Elk_KD
    with arcpy.EnvManager(outputCoordinateSystem="PROJCS['NAD_1983_10TM_AEP_Forest',GEOGCS['GCS_North_American_1983',DATUM['D_North_American_1983',SPHEROID['GRS_1980',6378137.0,298.257222101]],PRIMEM['Greenwich',0.0],UNIT['Degree',0.0174532925199433]],PROJECTION['Transverse_Mercator'],PARAMETER['False_Easting',500000.0],PARAMETER['False_Northing',0.0],PARAMETER['Central_Meridian',-115.0],PARAMETER['Scale_Factor',0.9992],PARAMETER['Latitude_Of_Origin',0.0],UNIT['Meter',1.0]]"):
        Elk_KD = arcpy.sa.KernelDensity(
            Elk_in_Southwestern_Alberta_2009,
            "NONE",
            "468.805393200003",
            None,
            "SQUARE_KILOMETERS",
            "DENSITIES",
            "PLANAR",
            ""
        )
        Elk_KD.save(Kernel_Density)

    # Process: Density-based Clustering (Density-based Clustering) (stats)
    Elk_data_DBC = "dataset/Elk_E106_DBC.shp"
    arcpy.stats.DensityBasedClustering(
        in_features=Elk_in_Southwestern_Alberta_2009,
        output_features=Elk_data_DBC,
        cluster_method="HDBSCAN",
        min_features_cluster=100
    )
