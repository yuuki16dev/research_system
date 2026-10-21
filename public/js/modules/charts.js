// @ts-check
'use strict';

/**
 * Research Studio — Pure SVG ビジュアル・チャート描画エンジン
 * 外部ライブラリ依存ゼロ · 完全ベクター · 高解像度印刷(PDF)完全対応
 */

const PALETTE = [
  { stroke: '#6366f1', fill: 'rgba(99, 102, 241, 0.25)', gradStart: '#818cf8', gradEnd: '#4f46e5' },
  { stroke: '#0ea5e9', fill: 'rgba(14, 165, 233, 0.25)', gradStart: '#38bdf8', gradEnd: '#0284c7' },
  { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.25)', gradStart: '#34d399', gradEnd: '#059669' },
  { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.25)', gradStart: '#fbbf24', gradEnd: '#d97706' },
  { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.25)', gradStart: '#f472b6', gradEnd: '#db2777' },
];

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 棒グラフ (Bar Chart) のSVGを生成
 */
function renderBarChart(chart, { width = 640, height = 300, isPrint = false }) {
  const pad = { top: 40, right: 30, bottom: 50, left: 60 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const labels = chart.labels || [];
  const datasets = chart.datasets || [];
  if (!labels.length || !datasets.length) return '';

  // 最大値の算出
  let maxVal = 0;
  datasets.forEach((ds) => {
    (ds.data || []).forEach((v) => {
      const num = Number(v) || 0;
      if (num > maxVal) maxVal = num;
    });
  });
  if (maxVal <= 0) maxVal = 100;
  // 切りのいい目盛り最大値
  const mag = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const step = Math.ceil(maxVal / mag / 4) * mag;
  const yMax = step * 4;

  const textColor = isPrint ? '#475569' : 'rgba(255, 255, 255, 0.7)';
  const gridColor = isPrint ? '#e2e8f0' : 'rgba(255, 255, 255, 0.1)';

  let gridSvg = '';
  for (let i = 0; i <= 4; i++) {
    const yVal = (yMax / 4) * i;
    const yPos = pad.top + h - (h / 4) * i;
    gridSvg += `
      <line x1="${pad.left}" y1="${yPos}" x2="${pad.left + w}" y2="${yPos}" stroke="${gridColor}" stroke-dasharray="3,3" stroke-width="1" />
      <text x="${pad.left - 10}" y="${yPos + 4}" font-size="10" fill="${textColor}" text-anchor="end" font-family="'Outfit', sans-serif">${yVal.toLocaleString()}</text>
    `;
  }

  const groupWidth = w / labels.length;
  const numDs = datasets.length;
  const barWidth = Math.min(36, (groupWidth * 0.7) / numDs);

  let barsSvg = '';
  let labelsSvg = '';

  labels.forEach((label, gIdx) => {
    const groupX = pad.left + gIdx * groupWidth + (groupWidth - barWidth * numDs) / 2;
    labelsSvg += `
      <text x="${pad.left + gIdx * groupWidth + groupWidth / 2}" y="${height - 20}" font-size="11" fill="${textColor}" text-anchor="middle" font-weight="600">${esc(label)}</text>
    `;

    datasets.forEach((ds, dIdx) => {
      const color = PALETTE[dIdx % PALETTE.length];
      const val = Number(ds.data[gIdx]) || 0;
      const barH = (val / yMax) * h;
      const barX = groupX + dIdx * barWidth;
      const barY = pad.top + h - barH;

      barsSvg += `
        <defs>
          <linearGradient id="barGrad_${gIdx}_${dIdx}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color.gradStart}" />
            <stop offset="100%" stop-color="${color.gradEnd}" />
          </linearGradient>
        </defs>
        <rect x="${barX}" y="${barY}" width="${barWidth - 2}" height="${Math.max(2, barH)}" rx="3" fill="url(#barGrad_${gIdx}_${dIdx})" opacity="0.9" />
        <text x="${barX + (barWidth - 2) / 2}" y="${barY - 6}" font-size="9.5" fill="${color.stroke}" text-anchor="middle" font-weight="700" font-family="'Outfit', sans-serif">${val.toLocaleString()}</text>
      `;
    });
  });

  let legendSvg = '';
  if (datasets.length > 1) {
    let legX = pad.left;
    datasets.forEach((ds, dIdx) => {
      const color = PALETTE[dIdx % PALETTE.length];
      legendSvg += `
        <rect x="${legX}" y="12" width="12" height="12" rx="2" fill="${color.gradStart}" />
        <text x="${legX + 16}" y="22" font-size="11" fill="${textColor}" font-weight="600">${esc(ds.label)}</text>
      `;
      legX += (ds.label.length * 10) + 40;
    });
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" class="rs-chart-svg" style="max-height: ${height}px; overflow: visible;">
      ${legendSvg}
      ${gridSvg}
      ${barsSvg}
      ${labelsSvg}
    </svg>
  `;
}

/**
 * レーダーチャート (Radar Chart) のSVGを生成
 */
function renderRadarChart(chart, { width = 480, height = 340, isPrint = false }) {
  const cx = width / 2;
  const cy = height / 2 + 10;
  const radius = Math.min(width, height) * 0.36;

  const labels = chart.labels || [];
  const datasets = chart.datasets || [];
  const numAxes = labels.length;
  if (numAxes < 3 || !datasets.length) return '';

  const textColor = isPrint ? '#334155' : 'rgba(255, 255, 255, 0.85)';
  const gridColor = isPrint ? '#cbd5e1' : 'rgba(255, 255, 255, 0.15)';

  let webSvg = '';
  // 5階層の同心多角形
  for (let lvl = 1; lvl <= 4; lvl++) {
    const r = (radius / 4) * lvl;
    let points = '';
    for (let i = 0; i < numAxes; i++) {
      const angle = (Math.PI * 2 / numAxes) * i - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      points += `${x},${y} `;
    }
    webSvg += `<polygon points="${points.trim()}" fill="none" stroke="${gridColor}" stroke-width="1" stroke-dasharray="${lvl === 4 ? 'none' : '2,2'}" />`;
  }

  // 軸とラベル
  let axesSvg = '';
  for (let i = 0; i < numAxes; i++) {
    const angle = (Math.PI * 2 / numAxes) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    axesSvg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${gridColor}" stroke-width="1" />`;

    const lx = cx + Math.cos(angle) * (radius + 20);
    const ly = cy + Math.sin(angle) * (radius + 16);
    const align = Math.abs(Math.cos(angle)) < 0.1 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
    axesSvg += `<text x="${lx}" y="${ly + 4}" font-size="11" fill="${textColor}" text-anchor="${align}" font-weight="700">${esc(labels[i])}</text>`;
  }

  // データ系列ポリゴン
  let seriesSvg = '';
  datasets.forEach((ds, dIdx) => {
    const color = PALETTE[dIdx % PALETTE.length];
    let points = '';
    labels.forEach((_, i) => {
      const val = Math.min(100, Math.max(0, Number(ds.data[i]) || 0));
      const r = (radius * (val / 100));
      const angle = (Math.PI * 2 / numAxes) * i - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      points += `${x},${y} `;
    });

    seriesSvg += `
      <polygon points="${points.trim()}" fill="${color.fill}" stroke="${color.stroke}" stroke-width="2.5" />
    `;
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" class="rs-chart-svg" style="max-height: ${height}px;">
      ${webSvg}
      ${axesSvg}
      ${seriesSvg}
    </svg>
  `;
}

/**
 * 統合SVGチャートレンダラー
 * @param {object} chart - チャート定義オブジェクト
 * @param {object} opts - { isPrint, width, height }
 * @returns {string} 完全なHTML/SVGマークアップ
 */
export function renderSvgChart(chart, opts = {}) {
  if (!chart || !chart.labels || !chart.datasets) return '';

  const isPrint = !!opts.isPrint;
  let chartSvg = '';

  const type = chart.type || 'bar';
  if (type === 'radar') {
    chartSvg = renderRadarChart(chart, { isPrint, width: opts.width || 480, height: opts.height || 320 });
  } else {
    // デフォルトは棒グラフ
    chartSvg = renderBarChart(chart, { isPrint, width: opts.width || 640, height: opts.height || 280 });
  }

  const titleHtml = chart.title ? `<div class="chart-card-title">${esc(chart.title)}</div>` : '';
  const descHtml = chart.description ? `<div class="chart-card-desc">${esc(chart.description)}</div>` : '';

  return `
    <div class="rs-chart-container ${isPrint ? 'pr-chart-wrap' : ''}">
      ${titleHtml}
      ${descHtml}
      <div class="chart-svg-box">
        ${chartSvg}
      </div>
    </div>
  `;
}
