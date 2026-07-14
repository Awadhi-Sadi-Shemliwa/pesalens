import React, { useRef, useEffect, useState } from 'react';
import { Chart } from 'chart.js/auto';

/* Read a theme token (space-separated "r g b") as a usable color string.
   Falls back gracefully if the var is missing (SSR / very early paint). */
const readVar = (name, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `rgb(${raw.replace(/\s+/g, ' ')})` : fallback;
};
const rgba = (name, a, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `rgb(${raw.replace(/\s+/g, ' ')} / ${a})` : fallback;
};

/* chartTheme() — live, theme-aware palette for every chart.
   Follows the CSS tokens so charts recolor correctly in BOTH light and dark
   (previously chart hex was hardcoded dark and broke in light mode).
   Pass the returned object's fields into Chart.js scale/plugin options. */
export const chartTheme = () => ({
  grid:         rgba('--c-bdr', 0.55, '#1E1F2D'),
  gridStrong:   readVar('--c-bdr', '#252636'),
  tick:         readVar('--c-t3', '#5E6078'),
  label:        readVar('--c-t2', '#9496A8'),
  tooltipBg:    readVar('--c-s1', '#0C0D12'),
  tooltipBorder:readVar('--c-bdr', '#252636'),
  tooltipTitle: readVar('--c-t1', '#EEEEF0'),
  tooltipBody:  readVar('--c-t2', '#9496A8'),
  accent:       readVar('--c-accent', '#30DC82'),
  income:       readVar('--c-inc', '#10B981'),
  expense:      readVar('--c-exp', '#F59E0B'),
  net:          readVar('--c-net', '#3884F5'),
  danger:       readVar('--c-dng', '#EF4444'),
  // Canvas-safe translucent fills (canvas can't resolve CSS var()).
  accentFill:   rgba('--c-accent', 0.14, 'rgba(48,220,130,0.14)'),
  incomeFill:   rgba('--c-inc', 0.14, 'rgba(16,185,129,0.14)'),
  expenseFill:  rgba('--c-exp', 0.10, 'rgba(245,158,11,0.10)'),
  netFill:      rgba('--c-net', 0.12, 'rgba(56,132,245,0.12)'),
  // Categorical series ordered accent-first (no purple; brand-aligned).
  palette: [
    readVar('--c-accent', '#30DC82'),
    readVar('--c-net',    '#3884F5'),
    readVar('--c-inc',    '#10B981'),
    readVar('--c-exp',    '#F59E0B'),
    readVar('--c-dng',    '#EF4444'),
    readVar('--c-t3',     '#5E6078'),
    readVar('--c-accent-h', '#4AEB96'),
    readVar('--c-net',    '#3884F5'),
  ],
});

/* A canvas is opaque to assistive tech and to anyone who can't perceive colour,
   so every chart needs a text equivalent (charts.md, WCAG 1.1.1). We build a
   visually-hidden data table from the same `data` the chart draws, and name the
   canvas with `ariaLabel`. Sighted users see the chart; everyone else gets the
   numbers. */
const SrDataTable = ({ data }) => {
  const labels = data?.labels || [];
  const sets = data?.datasets || [];
  if (!labels.length || !sets.length) return null;
  return (
    <table className="sr-only">
      <thead>
        <tr>
          <th>Category</th>
          {sets.map((s, i) => <th key={i}>{s.label || `Series ${i + 1}`}</th>)}
        </tr>
      </thead>
      <tbody>
        {labels.map((lab, r) => (
          <tr key={r}>
            <th scope="row">{String(lab)}</th>
            {sets.map((s, i) => <td key={i}>{String(Array.isArray(s.data) ? s.data[r] : '')}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const ChartJS = ({ type, data, options = {}, height = 260, ariaLabel }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  // Bump on theme toggle so the chart rebuilds with fresh token colors.
  const [themeV, setThemeV] = useState(0);

  useEffect(() => {
    const bump = () => setThemeV((v) => v + 1);
    window.addEventListener('pesalens:theme', bump);
    return () => window.removeEventListener('pesalens:theme', bump);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const th = chartTheme();

    // A bar's length is its whole encoding, so a truncated value axis misstates
    // the ratio between bars (charts.md #1). Force the value axis to start at
    // zero unless the caller has deliberately configured that scale itself.
    const baseScales = type === 'bar' && !options.scales
      ? { scales: { y: { beginAtZero: true } } }
      : {};

    chartRef.current = new Chart(canvasRef.current, {
      type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...baseScales,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: th.tooltipBg,
            titleColor: th.tooltipTitle,
            bodyColor: th.tooltipBody,
            borderColor: th.tooltipBorder,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
          },
        },
        ...options,
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [type, JSON.stringify(data), JSON.stringify(options), themeV]);

  return (
    <div style={{ height }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel || 'Chart'}
      />
      <SrDataTable data={data} />
    </div>
  );
};
