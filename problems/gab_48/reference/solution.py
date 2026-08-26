import arcpy


def Model():  # Model

    # To allow overwriting outputs change overwriteOutput option to True.
    arcpy.env.overwriteOutput = True

    loan_data_shp = "dataset/loan_data.shp"

    # Process: Select Layer By Attribute (Select Layer By Attribute) (management)
    loan_data_Layer, Count = arcpy.management.SelectLayerByAttribute(
        in_layer_or_view=loan_data_shp,
        selection_type="NEW_SELECTION",
        where_clause="AcceptedLo >= 30",
    )

    # Process: Copy Features (Copy Features) (management)
    loan_data_selected = rf"{arcpy.env.workspace}/loan_data_selected"
    arcpy.management.CopyFeatures(
        in_features=loan_data_Layer, out_feature_class=loan_data_selected
    )

    # Process: Hot Spot Analysis (Getis-Ord Gi*) (Hot Spot Analysis (Getis-Ord Gi*)) (stats)
    hot_spots_result_shp = "output/hot_spots_result.shp"
    arcpy.stats.HotSpots(
        Input_Feature_Class=loan_data_selected,
        Input_Field="AveInteres",
        Output_Feature_Class=hot_spots_result_shp,
        Conceptualization_of_Spatial_Relationships="FIXED_DISTANCE_BAND",
        Distance_Method="EUCLIDEAN_DISTANCE",
        Standardization="ROW",
        Apply_False_Discovery_Rate__FDR__Correction="APPLY_FDR",
    )

    # Process: Geographically Weighted Regression (GWR) (Geographically Weighted Regression (GWR)) (stats)
    gwr_result_shp = "output/gwr_result.shp"
    Output_Predicted_Features_2_ = ""
    arcpy.stats.GWR(
        in_features=loan_data_selected,
        dependent_variable="AveInteres",
        model_type="CONTINUOUS",
        explanatory_variables=["AveLoanGra"],
        output_features=gwr_result_shp,
        neighborhood_type="NUMBER_OF_NEIGHBORS",
        neighborhood_selection_method="USER_DEFINED",
        number_of_neighbors=22,
        output_predicted_features=Output_Predicted_Features_2_,
        robust_prediction="ROBUST",
        local_weighting_scheme="BISQUARE",
    )[0]


if __name__ == "__main__":
    # Global Environment settings
    with arcpy.EnvManager(
        scratchWorkspace="interest_rates_analysis.gdb",
        workspace="interest_rates_analysis.gdb",
    ):
        Model()
