# Climate Trend Estimation with Autocorrelated Noise

## Data
- `data/anomaly.csv` — 120 years of annual temperature anomaly (columns: year,anomaly_C)
- `data/reference_anomaly.csv` — 100-year reference series whose KNOWN forcing trend
  is 0.020 C/yr with AR(1) noise (phi=0.6)

## Task
1. Load the anomaly series and plot/inspect it.
2. Estimate the linear trend slope (C per year) with OLS.
3. The residuals are autocorrelated: compute an effective-sample-size or Newey-West
   style uncertainty, and check the slope estimate is not biased by the noise structure.
4. Validate your pipeline on the reference series: it must recover 0.020 C/yr within ~15%.
5. Write your final answer as JSON: `{"slope_per_year": <float>}` to solutions/climate_trend.json

## Grading
score = max(0, 1 - |slope_est - slope_true| / 0.010), where the truth is private.

## Stretch
- Report the slope with a 95% CI using an AR(1)-aware covariance.
- Compare OLS vs Theil-Sen slopes on both series.
