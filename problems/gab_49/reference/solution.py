import arcpy
import os

# 1. Load the data
arcpy.env.overwriteOutput = True
homeless_data = r"C:\Your\Path\homeless_data.xlsx\Sheet1$"
state_layer = r"C:\Your\Path\USA_States.shp"


# 2. Join Tabular Data to Spatial Data
arcpy.management.JoinField(
    in_data=state_layer,
    in_field="STATE_ABBR",
    join_table=homeless_data,
    join_field="State"
)

# 3. Add Calculated Fields
arcpy.management.AddField(
    in_table=state_layer,
    field_name="HomelessPopPer10k",
    field_type="FLOAT",
    field_alias="Homeless Pop per 10k"
)

arcpy.management.CalculateField(
    in_table=state_layer,
    field="HomelessPopPer10k",
    expression="(!Homeless13! / !Pop13!) * 10000",
    expression_type="PYTHON3"
)

# 4. Save the project
arcpy.mp.ArcGISProject("CURRENT").save()
print("Project saved successfully.")