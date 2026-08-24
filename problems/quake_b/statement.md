# Gutenberg-Richter b-value Estimation

## Data
- `data/catalog.csv` — seismic catalog (900 events, columns: event_id,magnitude)
- `data/reference_catalog.csv` — reference catalog (600 events, KNOWN b=1.00)

## Task
1. Load the catalog and explore the frequency-magnitude distribution
2. Choose completeness magnitude Mc (try multiple values, use goodness-of-fit)
3. Estimate b-value using Aki MLE: b = log10(e) / (mean(m[M>=Mc]) - Mc)
4. Validate your pipeline against the reference catalog (true b = 1.00)
5. Write your final answer as JSON: `{"b": <float>}` to solutions/quake_b.json

## Grading
score = max(0, 1 - |b_estimated - b_true| / 0.5), where b_true is private.

## Stretch
- Plot frequency-magnitude distribution (log10 N vs M) as solutions/fmd.png
- Report Mc with bootstrap confidence interval
