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
  const endMarker = '</g><!-- /official-tgs-overlay -->';
  const end = campus.indexOf(endMarker, start);
  if (end !== -1) campus = campus.slice(0, start) + campus.slice(end + endMarker.length);
}

function transform(src, dst) {
  const a = (dst[2] - dst[0]) / (src[2] - src[0]);
  const d = (dst[3] - dst[1]) / (src[3] - src[1]);
  return [a, d, dst[0] - a * src[0], dst[1] - d * src[1]];
}
function rect(t, r) {
  return [r[0] * t[0] + t[2], r[1] * t[1] + t[3], r[2] * t[0] + t[2], r[3] * t[1] + t[3]];
}
function envelope(rects) {
  return [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))];
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fullOverlay(mapId, sourceAnchor, targetAnchor, extra = '') {
  const m = mapById.get(mapId);
  if (!m) throw new Error(`missing map ${mapId}`);
  const file = m.image.replace(/^\.\//, '');
  const t = transform(sourceAnchor, targetAnchor);
  // Transform the complete original SVG, not a clipped crop. The registered anchor
  // still lands on the same campus coordinates, while labels and edge artwork remain visible.
  return `<image href="./${esc(file)}" x="0" y="0" width="${m.width}" height="${m.height}" transform="matrix(${t[0]} 0 0 ${t[1]} ${t[2]} ${t[3]})" preserveAspectRatio="none" pointer-events="none" ${extra}/>`;
}

const panelTransforms = {};
for (const p of reg.panels) {
  const dst = [p.to[0] + ox, p.to[1] + oy, p.to[2] + ox, p.to[3] + oy];
  panelTransforms[p.id] = transform(p.from, dst);
}

const pieces = [];

// Main 1–8 hall drawing: one complete PDF-derived SVG. Using the combined registered
// envelope avoids the visible cut seams that appeared when three cropped pieces were used.
const mainPanels = reg.panels.filter(p => p.map === 'main');
const mainSource = envelope(mainPanels.map(p => p.from));
const mainTarget = envelope(mainPanels.map(p => rect(panelTransforms[p.id], p.from)));
pieces.push(fullOverlay('main', mainSource, mainTarget));

// Hall 9–11: also show the complete original drawing around its registered interior.
const halls911 = reg.panels.find(p => p.map === 'halls911');
if (halls911) pieces.push(fullOverlay('halls911', halls911.from, rect(panelTransforms[halls911.id], halls911.from)));

// Existing 2F Central Mall map, placed directly below the 1F 1–8 hall strip. Its x-axis
// uses the same registered hall span and its y scale matches the facility registration.
const concourse = mapById.get('concourse');
if (concourse) {
  const concourseSource = [mainSource[0], 0, mainSource[2], concourse.height];
  const concourseTarget = [mainTarget[0], oy - 87, mainTarget[2], oy - 87 + concourse.height * 0.72];
  const ct = transform(concourseSource, concourseTarget);
  const frame = rect(ct, [0, 0, concourse.width, concourse.height]);
  pieces.push(`<g id="official-2f-concourse"><rect x="${frame[0]-3}" y="${frame[1]-3}" width="${frame[2]-frame[0]+6}" height="${frame[3]-frame[1]+6}" rx="3" fill="#fff9d9" fill-opacity=".92" stroke="#b88916" stroke-width="1.2"/><text x="${frame[0]+5}" y="${frame[1]-7}" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#765700">2F · CENTRAL MALL / 중앙 출입구</text>${fullOverlay('concourse', concourseSource, concourseTarget)}</g>`);
}

// Enlarged official inset drawings stay over the location they describe, but are no longer
// clipped to the anchor rectangle, so the complete original inset is visible.
for (const p of reg.insets) {
  const parent = panelTransforms[p.parent];
  if (!parent) throw new Error(`missing parent transform ${p.parent}`);
  const targetInParent = rect(parent, p.to);
  pieces.push(fullOverlay(p.map, p.from, targetInParent));
}

const group = `<g id="official-tgs-overlay" pointer-events="none">${pieces.join('')}</g><!-- /official-tgs-overlay -->`;
const close = campus.lastIndexOf('</svg>');
if (close === -1) throw new Error('invalid campus.svg');
campus = campus.slice(0, close) + group + campus.slice(close);
fs.writeFileSync(campusPath, campus);
console.log(`composed full official TGS PDF-derived maps onto campus.svg (${pieces.length} layers, including 2F)`);
