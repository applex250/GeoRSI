# Porosity-Permeability Prediction (petrophysics)

## Data
- `data/core.csv` — 120 core-plug measurements (columns: porosity_frac,perm_mD)
- `data/reference_core.csv` — reference dataset (90 plugs) whose KNOWN relation is
  log10(k) = -2.0 + 8.0 * phi with measurement scatter sigma=0.12 in log10 units

## Task
1. Load the core data and inspect the porosity-permeability relation (log10 k vs phi).
2. Fit the linear relation log10(k) = a + b * phi by least squares in log10 space.
3. Predict log10(k) at porosity phi = 0.25 (interpolation inside the data range).
4. Validate your pipeline on the reference dataset: it must recover
   log10(k)|phi=0.25 = -2.0 + 8.0*0.25 = 0.0 within ~0.15.
5. Write your final answer as JSON: `{"log10_k_at_phi025": <float>}` to solutions/poro_perm.json

## Grading
score = max(0, 1 - |est - truth| / 1.0), where the truth is private.

## Stretch
- Report prediction uncertainty at phi=0.25 via bootstrap over the plugs.
- Compare the linear fit against Kozeny-Carman scaled to the data.
