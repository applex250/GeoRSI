/**
 * Public, dependency-light scientific helpers copied into each exchange
 * workspace before the agent starts. This module contains methodology only;
 * it must never contain benchmark answers, private paths, or grader logic.
 */
export const SCIENCE_TOOLKIT_SOURCE = `"""Public, dependency-light helpers for GeoRSI quantitative tasks.
This file contains methods only; it has no benchmark answers or hidden paths.
"""
import csv, math

EULER_GAMMA = 0.5772156649015329

def read_column(path, column):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [float(row[column]) for row in csv.DictReader(f) if row.get(column, "").strip()]

def aki_b_value(magnitudes, mc, bin_width=0.0):
    values = [float(x) for x in magnitudes if float(x) >= mc]
    if not values or sum(values) / len(values) <= mc:
        raise ValueError("no usable magnitudes at Mc")
    # Use bin-width correction only when explicitly requested; the task's
    # stated formula is recovered by the default bin_width=0.
    effective_mc = mc - float(bin_width) / 2.0
    return math.log10(math.e) / (sum(values) / len(values) - effective_mc)

def aki_scan(magnitudes, mc_values, bin_width=0.0):
    """Return (Mc, b, count) candidates for an explicit sensitivity table."""
    return [(float(mc), aki_b_value(magnitudes, float(mc), bin_width),
             sum(float(x) >= float(mc) for x in magnitudes)) for mc in mc_values]

def gumbel_moments(values):
    values = [float(x) for x in values]
    if len(values) < 2:
        raise ValueError("at least two observations required")
    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / len(values)
    beta = math.sqrt(max(variance, 0.0) * 6.0) / math.pi
    if beta <= 0:
        raise ValueError("non-positive Gumbel scale")
    return mean - EULER_GAMMA * beta, beta

def gumbel_return_level(mu, beta, period=100.0):
    if beta <= 0 or period <= 1:
        raise ValueError("beta must be positive and return period > 1")
    return mu - beta * math.log(-math.log(1.0 - 1.0 / period))

def ols_slope(x, y):
    x, y = list(map(float, x)), list(map(float, y))
    if len(x) != len(y) or len(x) < 2:
        raise ValueError("x and y need equal length >= 2")
    xm, ym = sum(x) / len(x), sum(y) / len(y)
    den = sum((v - xm) ** 2 for v in x)
    if den <= 0:
        raise ValueError("x has no variation")
    return sum((a - xm) * (b - ym) for a, b in zip(x, y)) / den

def theil_sen_slope(x, y):
    x, y = list(map(float, x)), list(map(float, y))
    slopes = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(len(x)) for j in range(i + 1, len(x)) if x[j] != x[i]]
    if not slopes:
        raise ValueError("no non-zero x differences")
    slopes.sort()
    return slopes[len(slopes) // 2]

def lag1_autocorrelation(values):
    values = list(map(float, values))
    if len(values) < 3:
        return 0.0
    mean = sum(values) / len(values)
    den = sum((v - mean) ** 2 for v in values)
    return sum((values[i] - mean) * (values[i - 1] - mean) for i in range(1, len(values))) / den if den else 0.0

def log_linear_predict(x, permeability, target):
    y = [math.log10(float(v)) for v in permeability]
    slope = ols_slope(x, y)
    xm, ym = sum(map(float, x)) / len(x), sum(y) / len(y)
    return ym + slope * (float(target) - xm)
`;
