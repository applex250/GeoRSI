# Improve campsite data quality using a relationship class

## Instruction
In this tutorial, you are a regional GIS specialist tasked with helping improve campsite data quality in Wyoming. You'll initially address the loss of data at the park level by creating joins and relates to incorporate associated records then inspect and create a relationship class between campsites and campgrounds.

## Domain knowledge
Relate, a temporary RDBMS mechanism that links tables via key fields without merging them, enabling a campsite to access multiple dynamic attributes. To make Relate persistent, create a relationship class in a geodatabase.
Create Relationship Class is to store an association between fields or features in the origin table and the destination table. It is created with one-to-one, one-to-many, or many-to-many cardinality. 
Add Rule To Realtionship Class: Once a rule is added to a relationship class, that rule becomes the only valid relationship that can exist. To make other relationship combinations and cardinalities valid, additional relationship rules must be added.

## Data
dataset/National Parks: layer file for national park boundaries, polygon
dataset/CampsiteAttributes.csv: Different features for each camp site.
Key Columns: "AttributeID", "AttributeName", "AttributeValue", "EntityID", "EntityType"
dataset/OrganizationsTable.csv: Organization informations. Key Columns: "OrgID", "OrgType", "OrgName", "OrgImageURL"," OrgURLAddress", "OrgAbbrevName", "OrgJurisdictionType", "OrgParentID", "LastUpdatedDate"
dataset/Campsites: layer file for campsites, point
dataset/Facilities: layer file for facilities' locations, point

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
