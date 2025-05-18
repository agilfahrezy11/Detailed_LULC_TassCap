/*
This script is created as part of Data Preparation phase of Agil Akbar's thesis project:
'Comparison of various Tasseled Cap Transformation Integration for Detailed LULC mapping
Using Indonesia's Official Classification Scheme'

this scrip is organized as follows:
1. Selecting AOI and Imagery
2. Creating Spectral Transformations 
3. Creating Tasseeled Cap Transformation
4. Adding Topographical Attribute
*/
//A. Defining area of interest and Selecting The Imagery
var aoi = ee.FeatureCollection('projects/ee-agilakbar/assets/Extent_AOI_Projected')

//Select a single imagery TOA Reflectance Data
//Used TOA reflectance data as spectral reflectance input variables
var l9imagery = ee.Image('LANDSAT/LC09/C02/T1_TOA/LC09_121065_20240723')
                .clip(aoi)
                .select('B[1-7]', 'B10') //Select relevant bands
var tirs = l9imagery.select('B10') //Select TIRS only band  
// Function for scaling factors of Landsat Level 2 SR product
function applyScaleFactors(image) {
  var opticalBands = image.select('B.').multiply(0.0000275).add(-0.2);
  
  // Combine scaled bands
  var scaled = image.addBands(opticalBands, null, true)
  
  // Unmask missing pixels (e.g., over water)
  return scaled.unmask();
}

// Load and rename bands from Landsat 9 SR
var SR_L9 = ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_121065_20240723').clip(aoi)
  .select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'],
          ['B1','B2','B3','B4','B5','B6','B7']); // Renaming the band for spectral function
// Apply scale factors and unmask
var srl9 = applyScaleFactors(SR_L9).addBands(tirs);

/////////////// B. Function for Spectral Index ////////////////
/*
The spectral transformation consist of vegetation, soil/urban, and water transformation
1. NDVI
2. NDMI
3. EBBI (Enhance Build-up and Barren Index)
4. MNDWI
5. EVI
6. AWEI (Automatic Water Extraction Index)
7. MSAVI
In this function, topographical attribute is alos added. For Topographical Wetness Index, Flow Accumulation,
and Topographical Position Index is calculated in QGIS
*/
var specstack = function(image) {
//Calculate the Green Normalized Difference Vegetation Index 
  var NDVI = image.normalizedDifference(['B5', 'B4']).rename('NDVI');
  //Calculate the Normalized Difference Moisture Index Index 
  var ndmi = image.normalizedDifference(['B5', 'B6']).rename('NDMI');
//Calulcate the Modified SAVI
  var MSAVI = image.expression(
    '(2 * NIR + 1 - sqrt((2 * NIR + 1) ** 2 - 8 * (NIR - RED))) / 2', {
      'NIR': image.select('B5'),
      'RED': image.select('B4')
    }).rename('MSAVI');
//Calculate the Enhance Build-Up and Barren Index
  var ebbi = image.expression(
  '((SWIR1 - NIR) / (10 * sqrt(SWIR1 + TIR1)))', {
    'SWIR1': image.select('B6'),
    'NIR': image.select('B5'),
    'TIR1': image.select('B10')
  }).rename('EBBI');
//Calculate the Enhance Vegetation Index  
  var EVI = image.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
      'BLUE': image.select('B2'),
      'NIR': image.select('B5'),
      'RED': image.select('B4'),
    }).rename('EVI');
//Calculate Modified Normalized Difference Water Index  
  var MNDWI = image.expression(
    '(Green - SWIR1) / (Green + SWIR1)', {
      'Green': image.select('B3'),
      'SWIR1': image.select('B6')
    }).rename('MNDWI');
//Calculate Automatic Water Extraction Index
  var AWEI = image.expression(
  'B2 + 2.5 * B3 - 1.5 * (B5 + B6) - 0.25 * B7', {
    'B2': image.select('B2'), // Blue
    'B3': image.select('B3'), // Green
    'B5': image.select('B5'), // NIR
    'B6': image.select('B6'), // SWIR1
    'B7': image.select('B7')  // SWIR2
  }).rename('AWEI_sh');
  //Flow Accumulation
  var flow = ee.Image('projects/ee-agilakbar/assets/Flow_Extended_NASADEM').rename('FlowA')
  //TPI
  var tpi = ee.Image('projects/ee-agilakbar/assets/TPI_Landform')
  //Rescaling to matched the TPI original data
  var tpi_rescaled = tpi
  .subtract(0)
  .multiply((10 - 1) / 255.0)
  .add(1)
  .rename('TPILF');
  //Add TWI
  var twi = ee.Image('projects/ee-agilakbar/assets/TWI_NASADEMExtended').rename('TWI')
//Add DEM Parameters    
  var elev = ee.Image("NASA/NASADEM_HGT/001")
            .select('elevation')
            .clip(aoi)
//Calculate Slope and ASpect
  var slope = ee.Terrain.slope(elev).clip(aoi)
  var aspect = ee.Terrain.aspect(elev).clip(aoi)
  // Stack the spectral indexes, terrain parameters, with the original image
  var stack = GNDVI
              .addBands(ndmi)
              .addBands(EVI)
              .addBands(MNDWI)
              .addBands(MSAVI)
              .addBands(ebbi)
              .addBands(AWEI)
              .addBands(flow)
              .addBands(twi)
              .addBands(tpi_rescaled)
              .addBands(elev.rename('DEM'))
              .addBands(slope)
              .addBands(aspect)
              .toFloat();
  return stack.unmask();
};
//Applied for Landsat 9 Surface Reflectance
var spectralxterrainSR = specstack(srl9)
Map.addLayer(spectralxterrainSR, {}, 'Spectral Indexes SR')
//Combine TOA reflectance spectral bands, and Surface Reflectance spectral transformation
var combined = l9imagery.addBands(spectralxterrainSR).toFloat()
print(combined, 'Modified Combination')
Map.addLayer(combined, {}, 'Combination of TOA and SR')
Map.addLayer(l9imagery, {}, 'Imagery TOA L9')
Map.addLayer(srl9, {}, 'Imagery SR L9')

/////C. Calculate Tasseled Cap Transformation, using coefficient derived from Zhai et al (2022)
//TOA Tasseled cap used the blue band
var toaRT = ee.Array([
    [0.3443,	0.4057,	0.4667,	0.5347,	0.3936,	0.2412],//Brightness TOA
    [-0.2365, -0.2836, -0.4257,	0.8097,	0.0043,	-0.1638],//Greeness TOA
    [0.1301,	0.2280,	0.3492,	0.1795,	-0.6270,	-0.6195],  //Wetness
    ]);
print( 'Coefficient for Landsat 8 TOA TC', toaRT);
// === Function to compute TCT from Landsat 9 TOA image
function computeTCT(image) {
  var toaBands = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7']; // TOA bands required
  var arrayImage = image.select(toaBands).toArray().toArray(1); // Convert to 2D array

  var tct = ee.Image(toaRT)                   // Apply TCT matrix
    .matrixMultiply(arrayImage)
    .arrayProject([0])                        // Drop the extra dimension
    .arrayFlatten([['TCB', 'TCG', 'TCW']]);   // Rename components

  return tct; // Add TCT bands to the original image
}
var L9tc = computeTCT(l9imagery)
//Adding to the map
//TC Vis Param
var vizParams = {
  bands: ['TCB', 'TCG', 'TCW'],
  min: -0.1, max: [0.5, 0.1, 0.1]
};
//Stacking all of the data
var multi = combined.addBands(L9tc).toFloat()
print('Final Multisource', multi)

//Exporting the image
Export.image.toDrive({
    image: multi,
    description: 'Final_Multisource_Data_Combined',
    scale: 30,
    region: aoi,
    folder: 'Earth Engine',
    crs: 'EPSG:32748',
    fileFormat: 'GeoTIFF',
    formatOptions: {
    cloudOptimized: true
      },
      });
