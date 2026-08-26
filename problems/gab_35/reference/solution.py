import numpy as np
import rasterio
import matplotlib.pyplot as plt

def main():
    demPath = "dataset/aligned_DEM.tif"
    beforeFirePath = "dataset/Before_L8.tif"
    afterFirePath = "dataset/After_L8.tif"
    NLCDPath = "dataset/aligned_NLCD.tif"

    dem = rasterio.open(demPath)
    beforeFire = rasterio.open(beforeFirePath)
    afterFire = rasterio.open(afterFirePath)
    SonomaNLCD = rasterio.open(NLCDPath)

    # calculate NBR
    def cal_NBR(satellite_image):
        nbr = (satellite_image.read(5) - satellite_image.read(7)) / (satellite_image.read(5) + satellite_image.read(7))
        return nbr

    beforeFireNBR = cal_NBR(beforeFire)
    afterFireNBR = cal_NBR(afterFire)

    burnSeverity = beforeFireNBR-afterFireNBR
    print(burnSeverity.min())
    print(burnSeverity.max())
    #rescale burn severity to -1 to 1
    burnSeverity = (burnSeverity - burnSeverity.min()) / (burnSeverity.max() - burnSeverity.min()) * 2 - 1

    burnSeverity = np.where(burnSeverity < -0.6, 10, burnSeverity)
    burnSeverity = np.where((burnSeverity >= -0.6) & (burnSeverity < -0.2), 20, burnSeverity)
    burnSeverity = np.where((burnSeverity >= -0.2) & (burnSeverity < 0.2), 30, burnSeverity)
    burnSeverity = np.where((burnSeverity >= 0.2) & (burnSeverity < 0.6), 40, burnSeverity)
    burnSeverity = np.where((burnSeverity >= 0.6) & (burnSeverity <= 1), 50, burnSeverity)
    burnSeverity /= 10

    elevation = dem.read(1)

    grad_y, grad_x = np.gradient(elevation, elevation.shape[0], elevation.shape[1])
    slope = np.arctan(np.sqrt(grad_x**2 + grad_y**2)) * (180 / np.pi)

    slope = (slope - slope.min()) / (slope.max() - slope.min()) * 90 + 1
    print(slope.min())
    print(slope.max())
    slope = np.where(slope < 5, 1, slope)
    slope = np.where((slope >= 5) & (slope < 15), 2, slope)
    slope = np.where((slope >= 15) & (slope < 25), 3, slope)
    slope = np.where((slope >= 25) & (slope < 35), 4, slope)
    slope = np.where((slope >= 35) & (slope <= 91), 5, slope)
    #slope = np.where(slope > 91, 0, slope)

    landCover = SonomaNLCD.read(1)

    landCover = np.where(landCover < 12, 1, landCover)
    landCover = np.where((landCover >=21) & (landCover < 23), 3, landCover)
    landCover = np.where(landCover == 23, 4, landCover)
    landCover = np.where((landCover >=24) & (landCover < 32), 5, landCover)
    landCover = np.where((landCover >=41) & (landCover < 45), 1, landCover)
    landCover = np.where(landCover == 52, 3, landCover)
    landCover = np.where(landCover == 71, 4, landCover)
    landCover = np.where(landCover == 81, 3, landCover)
    landCover = np.where(landCover == 82, 4, landCover)
    landCover = np.where((landCover >=90) & (landCover <= 95), 2, landCover)

    overlay = burnSeverity*0.3 + slope*0.55 + landCover*0.15

    plt.imshow(overlay, cmap='RdYlGn_r', vmin=1, vmax=5)

    plt.colorbar(ticks=[1, 2, 3, 4, 5])
    plt.title("Landslide Risk")
    plt.savefig("landslideRisk.png")

if __name__ == "__main__":
    main()