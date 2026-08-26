import arcpy


def p(days, start, end):
    sStart = str(start)
    sEnd = str(end)
    d = days.split(";")
    ss = "(CRASH_DOW = '" + d[0]
    for i in range(1, len(d)):
        ss = ss + "' OR CRASH_DOW = '" + d[i]
    ss = ss + "') AND (CRASH_HOD >= " + sStart
    ss = ss + " AND CRASH_HOD <= " + sEnd + ")"
    return ss


def Model():  # Model

    # To allow overwriting outputs change overwriteOutput option to True.
    arcpy.env.overwriteOutput = True

    Crashes = "dataset/crashes.shp"
    Roads = "dataset/roads.shp"
    NwSWM360ft_swm = "dataset/NwSWM360ft.swm"
    New_Rate_Field_Name = "CrashRate"
    Selected_Crash_Hot_Spot_Map = "output/selected_crash_hotspots.shp"

    # Process: Select Layer By Attribute (Select Layer By Attribute) (management)
    Days = "Monday;Tuesday;Wednesday;Thursday;Friday"
    Beginning_Hour = 15
    Ending_Hour = 17
    SQL_Expression = p(Days, Beginning_Hour, Ending_Hour)
    Crashes_Selected = arcpy.management.SelectLayerByAttribute(
        in_layer_or_view=Crashes,
        selection_type="NEW_SELECTION",
        where_clause=SQL_Expression,
    )

    # Process: Copy Features (Copy Features) (management)
    Crash_Points = rf"{arcpy.env.scratchGDB}\CrashPoints"
    arcpy.management.CopyFeatures(
        in_features=(
            Crashes_Selected.__str__().format(**locals(), **globals())
            if isinstance(Crashes_Selected, str)
            else Crashes_Selected
        ),
        out_feature_class=Crash_Points,
    )

    # Process: Snap (Snap) (edit)
    Crash_Points_Snapped_to_Road = arcpy.edit.Snap(
        in_features=Crash_Points, snap_environment=[[Roads, "EDGE", "0.25 Miles"]]
    )[0]

    # Process: Spatial Join (Spatial Join) (analysis)
    Road_Segement_Crash_Counts = rf"{arcpy.env.scratchGDB}\RoadSegmentCrashCounts"
    arcpy.analysis.SpatialJoin(
        target_features=Roads,
        join_features=Crash_Points_Snapped_to_Road,
        out_feature_class=Road_Segement_Crash_Counts,
        join_type="KEEP_ALL",
        field_mapping="",
    )

    # Process: Add Field (Add Field) (management)
    Crash_Counts = arcpy.management.AddField(
        in_table=Road_Segement_Crash_Counts,
        field_name=(
            New_Rate_Field_Name.__str__().format(**locals(), **globals())
            if isinstance(New_Rate_Field_Name, str)
            else New_Rate_Field_Name
        ),
        field_type="DOUBLE",
    )[0]

    # Process: Calculate Field (Calculate Field) (management)
    Crash_Rates = arcpy.management.CalculateField(
        in_table=Crash_Counts,
        field=New_Rate_Field_Name,
        expression="!Join_Count! / (6 * !Shape_Length!)",
    )[0]

    # Process: Hot Spot Analysis (Getis-Ord Gi*) (Hot Spot Analysis (Getis-Ord Gi*)) (stats)
    arcpy.stats.HotSpots(
        Input_Feature_Class=Crash_Rates,
        Input_Field=New_Rate_Field_Name,
        Output_Feature_Class=(
            Selected_Crash_Hot_Spot_Map.__str__().format(**locals(), **globals())
            if isinstance(Selected_Crash_Hot_Spot_Map, str)
            else Selected_Crash_Hot_Spot_Map
        ),
        Conceptualization_of_Spatial_Relationships="GET_SPATIAL_WEIGHTS_FROM_FILE",
        Distance_Method="EUCLIDEAN_DISTANCE",
        Standardization="NONE",
        Weights_Matrix_File=NwSWM360ft_swm,
        Apply_False_Discovery_Rate__FDR__Correction="APPLY_FDR",
    )


if __name__ == "__main__":
    # Global Environment settings
    with arcpy.EnvManager(scratchWorkspace="crash_hotspot_analysis.gdb", workspace="crash_hotspot_analysis.gdb"):
        Model()
