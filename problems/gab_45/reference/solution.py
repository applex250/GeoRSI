import arcpy
from arcpy.ia import *
from arcpy.sa import *

def Model():  # Model

    # To allow overwriting outputs change overwriteOutput option to True.
    arcpy.env.overwriteOutput = False

    # Check out any necessary licenses.
    arcpy.CheckOutExtension("spatial")
    arcpy.CheckOutExtension("ImageAnalyst")
    arcpy.CheckOutExtension("3D")

    Elevation = arcpy.Raster("dataset/Elevation")

    # Process: Focal Statistics (Focal Statistics) (ia)
    Ruggedness = "dataset/Mountain_Lion_Corridors.gdb/Ruggedness"
    Focal_Statistics = Ruggedness
    Ruggedness = arcpy.ia.FocalStatistics(Elevation, "Rectangle 3 3 CELL", "RANGE", "DATA", 90)
    Ruggedness.save(Focal_Statistics)

    # Process: Rescale by Function (Rescale by Function) (sa)
    Ruggedness_Cost = "dataset/Mountain_Lion_Corridors.gdb/Ruggedness_Cost"
    Rescale_by_Function = Ruggedness_Cost
    with arcpy.EnvManager(compression="NONE", pyramid="NONE"):
        Ruggedness_Cost = arcpy.sa.RescaleByFunction(
            Ruggedness, [["MSLARGE", 0, "", 223.39059448242188, "", 1, 1, ""]], 10, 1
        )
        Ruggedness_Cost.save(Rescale_by_Function)

if __name__ == "__main__":
    Model()
