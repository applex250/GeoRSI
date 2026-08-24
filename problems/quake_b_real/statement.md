# Gutenberg-Richter b-value of REAL Southern California Seismicity

## Data (real observations, USGS ComCat / SCSN `ci` network, M_L ≥ 2.0)
- `data/catalog.csv` — 24,501 real earthquakes, Southern California
  (32.5–36.0°N, 121.0–114.5°W), 2010-01-01 … 2024-12-31 (columns: event_id,magnitude)
- `data/reference_catalog.csv` — 51,868 real earthquakes, same region,
  1990-01-01 … 2009-12-31. Published studies put this region/period near
  b ≈ 0.93 (canonical Aki MLE at Mc from maximum curvature gives 0.9291).

## Task
1. Load both catalogs; inspect the frequency-magnitude distribution (FMD) of each.
2. Determine the completeness magnitude Mc (e.g., maximum curvature or goodness-of-fit).
3. Estimate the b-value of the MAIN catalog (2010–2024) with Aki's MLE:
   b = log10(e) / (mean(m[M>=Mc]) - (Mc - d/2)), with the binning correction d=0.1.
4. Sanity-check your pipeline on the reference catalog first: it must reproduce
   the published b ≈ 0.93 before you trust it on the main catalog.
5. Submit your final answer via the submit tool: JSON `{"b": <float>}`.

## Grading
score = max(0, 1 - |b_est - b_true| / 0.5), where b_true is the canonical
estimate for the 2010–2024 catalog (private).

## Notes
- This is REAL data: expect aftershock sequences (e.g., 2019 Ridgecrest M7.1)
  and check whether the FMD is straight above Mc before trusting the estimator.
- Literature context: Southern California b-values are commonly reported in
  the 0.8–1.0 range; the two periods genuinely differ.
