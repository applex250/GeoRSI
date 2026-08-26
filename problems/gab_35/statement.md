# Calculate landslide potential for communities affected by wildfires

## Instruction
Your task is doing raster analysis to analyze burn severity, slope and landcover in Santa Rosa, California, region, which was devastated by a wildfire in 2017. You have to calculate the normalized Burn ratio before and after the wildfire using two landsat 8 satellite imageries. Subtracting the resulted layers to get burn severity. Using the elevation layer to find the slope of the map. For the burn severity, slope, and landcover, remapping into 5 categories, from low to high. Finally, weighted overlaying them together and save them as one landslide risk map as 'pred_results/landslide_map.png'

## Domain knowledge
Normalized Burn Ratio (NBR) is used to identify burned areas and provide a measure of burn severity. NBR ranges between -1 and 1. A high NBR value indicates healthy vegetation. A low value indicates bare ground and recently burnt areas.It is calculated as a ratio between the NIR and SWIR values in traditional fashion. 

In Landsat 8-9, NBR = (Band 5 - Band 7) / (Band 5 + Band 7). 

Burn Severity: NBR after wildfire Minus before wildfire

Slope:The Slope tool identifies the steepness at each cell of a raster surface. The lower the slope value, the flatter the terrain; the higher the slope value, the steeper the terrain. 

Remap: Reclassification process that normalizes different raster files to the same range.

Weighted Overlay: Each raster layer's value range should be rescale to the same range. Each raster layer is weighted differently: Landcover(15%), Burn Severity(30%), Slope(55%).

Reclassification for data should be in the range of 0 to 5

Reclassification for landcover: 
< 12        1
21 - 22        3
23        4
24 - 31        5
41 - 44        1
52        3
71        4
81        3
82        4
90 - 95        2

## Data
dataset/DEM_30m.tif: Santa Rosa's elevation in 30 meters spatial resolution.

dataset/Before_L8.tif: Landsat 8 satellite imageries before 2017 wildfire.

dataset/After_L8.tif: Landsat 8 satellite imageries after 2017 wildfire.

dataset/Sonoma_NLCD2011.tif: Landcover status of Santa Rosa area published by NLCD in 2011.

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
