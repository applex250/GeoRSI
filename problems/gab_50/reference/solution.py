import arcpy


def Model():  # Model

    # To allow overwriting outputs change overwriteOutput option to True.
    arcpy.env.overwriteOutput = True

    # Check out any necessary licenses.
    arcpy.CheckOutExtension("GeoStats")

    Global_ocean_measurements = "dataset/Global_ocean_measurements.shp"
    Global_shallow_waters = "dataset/Global_shallow_waters.shp"
    USA_seagrass = "dataset/USA_seagrass.shp"
    USA_shallow_waters = "dataset/USA_shallow_waters.shp"

    # Process: Pairwise Dissolve (Pairwise Dissolve) (analysis)
    USAseagrass_PairwiseDissolve = "memory/USAseagrass_PairwiseDissolve"
    arcpy.analysis.PairwiseDissolve(
        in_features=USA_seagrass,
        out_feature_class=USAseagrass_PairwiseDissolve,
        multi_part="MULTI_PART",
    )

    # Process: Create Random Points (Create Random Points) (management)
    USA_Train = arcpy.management.CreateRandomPoints(
        out_path="memory",
        out_name="USA_Train",
        constraining_feature_class=USAseagrass_PairwiseDissolve,
        number_of_points_or_field=5000,
        minimum_allowed_distance="0 Meters",
        create_multipoint_output="POINT",
        multipoint_size=0,
    )[0]

    # Process: Empirical Bayesian Kriging (Empirical Bayesian Kriging) (ga)
    Output_geostatistical_layer_1_ = ""
    EBK_temp = "memory/EBK_temp"
    arcpy.ga.EmpiricalBayesianKriging(
        in_features=Global_ocean_measurements,
        z_field="temp",
        out_ga_layer=Output_geostatistical_layer_1_,
        out_raster=EBK_temp,
        cell_size="25000",
        max_local_points=50,
        number_semivariograms=50,
        search_neighborhood="NBRTYPE=StandardCircular RADIUS=8985971.31957307 ANGLE=0 NBR_MAX=15 NBR_MIN=3 SECTOR_TYPE=ONE_SECTOR",
        semivariogram_model_type="LINEAR",
    )
    EBK_temp = arcpy.Raster(EBK_temp)

    # Process: Empirical Bayesian Kriging (2) (Empirical Bayesian Kriging) (ga)
    Output_geostatistical_layer_2_ = ""
    EBK_salinity = "memory/EBK_salinity"
    arcpy.ga.EmpiricalBayesianKriging(
        in_features=Global_ocean_measurements,
        z_field="salinity",
        out_ga_layer=Output_geostatistical_layer_2_,
        out_raster=EBK_salinity,
        cell_size="25000",
        max_local_points=50,
        number_semivariograms=50,
        search_neighborhood="NBRTYPE=StandardCircular RADIUS=8985971.31957307 ANGLE=0 NBR_MAX=15 NBR_MIN=3 SECTOR_TYPE=ONE_SECTOR",
        semivariogram_model_type="LINEAR",
    )
    EBK_salinity = arcpy.Raster(EBK_salinity)

    # Process: Presence-only Prediction (MaxEnt) (Presence-only Prediction (MaxEnt)) (stats)
    trainfeatures2 = "output/trainfeatures2.shp"
    Output_Trained_Raster = ""
    rc2 = ""
    sensitivity2 = ""
    Output_Prediction_Features = ""
    seagrass_predict2 = "output/seagrass_predict2.tif"
    seagrass_model_ssm = ""
    with arcpy.EnvManager(mask=Global_shallow_waters):
        arcpy.stats.PresenceOnlyPrediction(
            input_point_features=USA_Train,
            contains_background="PRESENCE_ONLY_POINTS",
            explanatory_rasters=[[EBK_salinity, ""], [EBK_temp, ""]],
            basis_expansion_functions=["LINEAR", "QUADRATIC", "PRODUCT", "HINGE"],
            number_knots=10,
            study_area_type="STUDY_POLYGON",
            study_area_polygon=USA_shallow_waters,
            spatial_thinning="THINNING",
            thinning_distance_band="2 Kilometers",
            number_of_iterations=10,
            relative_weight=100,
            link_function="CLOGLOG",
            presence_probability_cutoff=0.5,
            output_trained_features=trainfeatures2,
            output_trained_raster=Output_Trained_Raster,
            output_response_curve_table=rc2,
            output_sensitivity_table=sensitivity2,
            output_pred_features=Output_Prediction_Features,
            output_pred_raster=seagrass_predict2,
            explanatory_rasters_matching=[
                ["memory/EBK_salinity", "memory/EBK_salinity"],
                ["memory/EBK_temp", "memory/EBK_temp"],
            ],
            allow_predictions_outside_of_data_ranges="ALLOWED",
            resampling_scheme="RANDOM",
            number_of_groups=3,
            output_trained_model=seagrass_model_ssm,
        )
        seagrass_predict2 = arcpy.Raster(seagrass_predict2)


if __name__ == "__main__":
    # Global Environment settings
    with arcpy.EnvManager(scratchWorkspace="predict_seagrass_habitats.gdb", workspace="predict_seagrass_habitats.gdb"):
        Model()
