# Predict the likelihood of tin-tungsten deposits in Tasmania

## Instruction
Your task is performing a random forest prospectivity analysis for tin-tungsten deposits in Tasmania. The analysis should focus on training and evaluating a model using Python tools on some mineral ocurrence point data and geo-related evidence raster layers. Your goal is to set up the environment, load and inspect the data, build a random forest classifier model to identify the probability proximal of the area. The final auc should be at least 0.9. Save the final predicted graph as "pred_results/mineral_prospectivity.png"

## Domain knowledge
sklearn.ensemble.RandomForestClassifier() is a function to build a random forest classifier. To mitigate data imbalance,random undersampling randomly removes features from the major classes.
"Buffer" creates buffer polygons or zones around input geometry features to a specified distance. 
tasgrav_IR_1VD.tif tasmag_TMI.tif tasrad_Th_ppm.tif tasmag_TMI_1VD.tif tasrad_U_ppm.tif tasrad_K_pct.tif's data structure is similar to tasgrav_IR.tif.

## Data
dataset/sn_w_minoccs.gpkg: gpkg file storing point data of mineral ocurrence, Similar to point  Geojson file.
Columns of dataset/sn_w_minoccs.gpkg:
'GID', 'DEPOSIT_ID', 'NAME', 'ALIAS', 'PARENT_ID', 'TYPE', 'COMM_TYPE',
       'COMMODITYS', 'DESCRIPT', 'LOCALITY', 'LOC_ACC', 'LOC_METHOD', 'RL',
       'RL_ACC', 'STATUS', 'STATUSDATE', 'DEP_SIZE', 'RESOURCES', 'FORM',
       'STRIKE', 'DIP', 'LITHOSTRAT', 'HOST_AGE', 'LITHOLOGY', 'ORE_DESCRT',
       'ORE_GENESS', 'MINERALAGE', 'GANGUE', 'EXPL_TYPE', 'OUTCROPS',
       'WEATHERED', 'XTRCTBLTY', 'USES', 'TESTS', 'GENETIC', 'DATA_MTLGA',
       'REF', 'geometry'

Several GeoTIFF files with geo-related evidence raster layers:
datasets\tasgrav_IR_1VD.tif
datasets\tasgrav_IR.tif
datasets\tasmag_TMI_1VD.tif
datasets\tasmag_TMI.tif
datasets\tasrad_K_pct.tif
datasets\tasrad_Th_ppm.tif
datasets\tasrad_U_ppm.tif

## How to submit
1. Analyze the data with python (write scripts, run_python; use start_job for
   anything longer than a couple of minutes).
2. Produce the outputs the instruction asks for (figures/maps as files).
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {
     "key_values": {"<descriptive label>": <number>, ...},
     "output_files": ["<filename you created>", ...],
     "summary": "<2-3 sentences: method and main findings>"
   }
   key_values: every important numeric result you computed, with clear labels.
   output_files: the figures/maps you saved (relative filenames).

## Grading
Your key numeric results are compared against an expert reference (labels do
not need to match; values matter, small tolerance). Output files must exist.
