"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Info } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMemo, useState } from "react";
import { ThemeToggle } from "./theme-toggle";

type Controls = {
  clay: number;
  iron: number;
  quartz: number;
  gain: number;
};

const bandDefinitions = [
  ["Al-OH absorption", "2.2 μm", "clay"],
  ["Fe-OH absorption", "2.35 μm", "iron"],
  ["Quartz reststrahlen", "TIR contrast", "quartz"],
  ["Surface brightness", "signal gain", "gain"],
] as const;

function gaussian(value: number, center: number, width: number, amplitude: number) {
  const distance = (value - center) / width;
  return amplitude * Math.exp(-distance * distance);
}

function responseAt(wavelength: number, controls: Controls) {
  const t = (wavelength - 0.5) / 12;
  let response = 0.34 + 0.42 * Math.pow(t, 0.62);
  response -= gaussian(wavelength, 1.4, 0.09, 0.05);
  response -= gaussian(wavelength, 2.2, 0.075, controls.clay / 320);
  response -= gaussian(wavelength, 2.35, 0.06, controls.iron / 420);
  response -= gaussian(wavelength, 1.9, 0.05, controls.iron / 900);
  response += gaussian(wavelength, 8.6, 0.9, controls.quartz / 900);
  return Math.max(0.02, Math.min(1, response * (0.55 + controls.gain / 145)));
}

function calculateRsi(controls: Controls) {
  const bands = [
    [2.2, 0.075],
    [2.35, 0.06],
    [1.9, 0.05],
  ];
  return bands.reduce((best, [center, width]) => {
    let core = 1;
    let shoulder = 0;
    for (let index = 0; index <= 24; index += 1) {
      const wavelength = center - 0.25 + (index / 24) * 0.5;
      const response = responseAt(wavelength, controls);
      if (Math.abs(wavelength - center) < width * 0.5) core = Math.min(core, response);
      if (Math.abs(wavelength - center) > width * 1.8) shoulder = Math.max(shoulder, response);
    }
    return Math.max(best, (shoulder - core) / Math.max(0.05, shoulder));
  }, 0);
}

export function SpectralExplorer() {
  const [controls, setControls] = useState<Controls>({ clay: 62, iron: 28, quartz: 41, gain: 70 });
  const curve = useMemo(
    () =>
      Array.from({ length: 160 }, (_, index) => {
        const wavelength = 0.5 + (index / 159) * 12;
        return { wavelength: Number(wavelength.toFixed(2)), response: Number(responseAt(wavelength, controls).toFixed(3)) };
      }),
    [controls],
  );
  const rsi = useMemo(() => calculateRsi(controls), [controls]);

  function updateControl(key: keyof Controls, value: number) {
    setControls((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="rsi-page">
      <header className="rsi-header">
        <Link className="wordmark" href="/">
          geobyte
        </Link>
        <div className="rsi-header-actions">
          <ThemeToggle />
          <Link className="back-link" href="/">
            <ArrowLeft aria-hidden size={16} strokeWidth={1.7} /> Back to lab
          </Link>
        </div>
      </header>

      <section className="rsi-hero" id="top">
        <div className="rsi-copy">
          <p className="section-index">GEO / BYTE</p>
          <h1>GEO RSI</h1>
          <p>
            A compact explorer for the <strong>relative spectral index</strong> used to map hydrothermal alteration from multispectral data. Move the bands, inspect the curve, and read the signal the way a mineral-mapping group does.
          </p>
          <div className="rsi-tags">
            <span>Remote sensing</span>
            <span>Mineral mapping</span>
            <span>SWIR · TIR</span>
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-meta">
            <span>Normalised reflectance</span>
            <p>
              RSI <strong>{rsi.toFixed(2)}</strong>
            </p>
          </div>
          <div className="spectral-chart">
            <ResponsiveContainer height="100%" width="100%">
              <ComposedChart data={curve} margin={{ top: 18, right: 14, bottom: 2, left: -18 }}>
                <defs>
                  <linearGradient id="spectral-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#77b8a3" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#77b8a3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="wavelength" interval={19} stroke="var(--chart-axis)" tick={{ fill: "var(--chart-label)", fontSize: 11 }} tickFormatter={(value) => value + "μm"} tickLine={false} />
                <YAxis domain={[0, 1]} stroke="var(--chart-axis)" tick={{ fill: "var(--chart-label)", fontSize: 11 }} tickCount={5} tickLine={false} width={36} />
                <Tooltip contentStyle={{ background: "var(--surface-strong)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)" }} cursor={{ stroke: "var(--accent)", strokeWidth: 1 }} formatter={(value) => [Number(value).toFixed(3), "Reflectance"]} labelFormatter={(value) => value + " μm"} />
                <Area dataKey="response" fill="url(#spectral-fill)" stroke="none" type="monotone" />
                <Line dataKey="response" dot={false} stroke="var(--accent)" strokeWidth={2.2} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="rsi-workbench">
        <article className="control-panel">
          <div className="panel-title">
            <h2>Band response</h2>
            <p>Every control scales one absorption feature. The curve is normalised reflectance, so its shape matters more than absolute signal.</p>
          </div>
          <div className="sliders">
            {bandDefinitions.map(([label, note, key]) => (
              <label className="slider-row" key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>{note}</small>
                </span>
                <input aria-label={label} max="100" min={key === "gain" ? "5" : "0"} onChange={(event) => updateControl(key, Number(event.target.value))} type="range" value={controls[key]} />
                <output>{controls[key]}</output>
              </label>
            ))}
          </div>
        </article>
        <article className="definition-panel">
          <div className="panel-title">
            <h2>Definition</h2>
            <p>The strongest shoulder-to-core ratio in the SWIR window forms the value above.</p>
          </div>
          <pre>RSI = (band shoulder / band peak)
  − (band core / band peak)</pre>
          <p className="definition-note"><Info aria-hidden size={15} /> Positive peaks flag argillic and phyllic halos. Field checks remain the decisive test.</p>
        </article>
      </section>

      <section className="spectral-table-section">
        <div className="section-heading compact-heading">
          <span className="section-index">Window we map</span>
          <h2>Read the interval, not a single pixel.</h2>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr><th>Window</th><th>Wavelength</th><th>Sensitivity</th><th>Reads as</th></tr>
            </thead>
            <tbody>
              <tr><td>Visible</td><td>0.4 – 0.7 μm</td><td>Iron oxide tint</td><td>Oxidised cap rocks</td></tr>
              <tr><td>SWIR 1</td><td>1.55 – 1.75 μm</td><td>Al-OH, Mg-OH</td><td>Clay alteration zones</td></tr>
              <tr><td>SWIR 2</td><td>2.1 – 2.5 μm</td><td>Carbonate, NH4</td><td>Distal propylitic</td></tr>
              <tr><td>TIR</td><td>8 – 12 μm</td><td>Quartz content</td><td>Silicification</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="limitations-section">
        <p className="section-index">Limitations, stated plainly</p>
        <div className="limitations-grid">
          <p><strong>Atmosphere first.</strong> Ratios suppress illumination but not water vapour; work with surface-reflectance products, not raw radiance.</p>
          <p><strong>Mixing is the norm.</strong> A pixel holding 30% clay still reads weak. Report the fraction, not just the flag.</p>
          <p><strong>Field check beats the plot.</strong> Every anomaly deserves a sample, a walk, or an independent measurement.</p>
        </div>
        <a className="text-link" href="#top">Explore the lab <ArrowUpRight aria-hidden size={16} /></a>
      </section>

      <footer className="rsi-footer">
        <span>Geobyte Lab · GEO RSI</span>
        <span>Illustrative tooling, not a commercial decision product</span>
      </footer>
    </main>
  );
}
