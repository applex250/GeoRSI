# 100-Year Flood Return Level Estimation

## Data
- `data/peaks.csv` — annual maximum flood peaks (70 years, columns: year,peak_m3s)
- `data/reference_peaks.csv` — reference series (50 years) from a comparable basin
  whose true parameters are KNOWN: Gumbel mu=120, beta=25 (hence true Q100=235.0 m3/s)

## Task
1. Load the annual maximum series and inspect it.
2. Fit a Gumbel (EV1) distribution by maximum likelihood (or L-moments).
3. Estimate the 100-year return level: Q100 = mu_hat - beta_hat * ln(-ln(0.99)).
4. Validate your estimator on the reference series: it must recover Q100=235.0 within a few percent.
5. Write your final answer as JSON: `{"q100": <float>}` to solutions/flood_rp.json

## Grading
score = max(0, 1 - |Q100_est - Q100_true| / (0.25 * Q100_true)), where the truth is private.

## Stretch
- Compare MLE vs L-moments vs method-of-moments fits on the reference series.
- Report an approximate 95% confidence interval via bootstrap.
