'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const campusPath = path.join(root, 'dist', 'campus.svg');
const mapDataPath = path.join(root, 'dist', 'map-data.json');
const registrationPath = path.join(root, 'sources', 'navigation', 'registration.json');

const data = JSON.parse(fs.readFileSync(mapDataPath, 'utf8'));
const reg = JSON.parse(fs.readFileSync(registrationPath, 'utf8'));
let campus = fs.readFileSync(campusPath, 'utf8');

const ox = reg.geography.offset[0];
const oy = reg.geography.offset[1];
const mapById = new Map(data.maps.map(m => [m.id, m]));

const overlayStart = '<g id="official-tgs-overlay"';
const start = campus.indexOf(overlayStart);
if (start !== -1) {
  const end = campus.indexOf('</g><!-- /official-tgs-overlay -->', start);
  if (end !== -1) {
    campus = campus.slice(0, start) + campus.slice(end + '</g><!-- /official-tgs-overlay -->'.length);
  }
}

function transform(src, dst) {
  const a = (dst[2] - dst[0]) / (src[2] - src[0]);
  const d = (dst[3] - dst[1]) / (src[3] - src[1]);
  return [a, d, dst[0] - a * src[0], dst[1] - d * src[1]];
}
function rect(t, r) {
  return [r[0] * t[0] + t[2], r[1] * t[1] + t[3], r[2] * t[0] + t[2], r[3] * t[1] + t[3]];
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function overlay(mapId, sourceRect, targetRect) {
  const m = mapById.get(mapId);
  if (!m) throw new Error(`missing map ${mapId}`);
  const file = m.image.replace(/^\.\//, '');
  const [x0, y0, x1, y1] = targetRect;
  const w = x1 - x0, h = y1 - y0;
  const [sx0, sy0, sx1, sy1] = sourceRect;
  return `<svg x="${x0}" y="${y0}" width="${w}" height="${h}" viewBox="${sx0} ${sy0} ${sx1 - sx0} ${sy1 - sy0}" preserveAspectRatio="none" overflow="hidden" pointer-events="none"><image href="./${esc(file)}" x="0" y="0" width="${m.width}" height="${m.height}" preserveAspectRatio="none"/></svg>`;
}

const panelTransforms = {};
const pieces = [];
for (const p of reg.panels) {
  const dst = [p.to[0] + ox, p.to[1] + oy, p.to[2] + ox, p.to[3] + oy];
  const t = transform(p.from, dst);
  panelTransforms[p.id] = t;
  pieces.push(overlay(p.map, p.from, rect(t, p.from)));
}
for (const p of reg.insets) {
  const parent = panelTransforms[p.parent];
  if (!parent) throw new Error(`missing parent transform ${p.parent}`);
  const targetInParent = rect(parent, p.to);
  const t = transform(p.from, targetInParent);
  pieces.push(overlay(p.map, p.from, rect(t, p.from)));
}

const group = `<g id="official-tgs-overlay" pointer-events="none">${pieces.join('')}</g><!-- /official-tgs-overlay -->`;
const close = campus.lastIndexOf('</svg>');
if (close === -1) throw new Error('invalid campus.svg');
campus = campus.slice(0, close) + group + campus.slice(close);
fs.writeFileSync(campusPath, campus);
console.log(`composed ${pieces.length} official TGS PDF-derived panels onto campus.svg`);
