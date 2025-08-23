import { labelOf, colorFor } from './main.js';
import { DATA_BASE } from './config.js';

let map;
const layers = new Map();
const geoCache = new Map();
let overlapLayer = null;
let allRangesGroup = null;
let deferRanges = true;
let hasSelection = false;
let rangeRenderer;
let heatLayer = null;

// Hover state
let hoverGroup = null;
let hoverTooltip = null;
let bboxMap = null;
let bboxKeys = null;
let hoverThrottle = null;
let hoverLabelsGroup = null;
const HOVER_LABELS_MAX_ZOOM = 11; // show labels only when zoom <= 11 (clusters/heat)
let hoverLabelRects = [];

export async function initMap() {
  map = L.map('map', { zoomControl: true, minZoom: 3, maxZoom: 18, preferCanvas: true })
          .setView([39.5, -98.35], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  rangeRenderer = L.canvas({ padding: 0.5 });
  allRangesGroup = L.layerGroup().addTo(map);
  hoverGroup = L.layerGroup().addTo(map);
  hoverLabelsGroup = L.layerGroup().addTo(map);
  map.on('movestart', () => { if (deferRanges && !hasSelection) clearAllRanges(); });
  map.on('moveend', () => { if (deferRanges && !hasSelection) renderAllRanges(); });

  // Clear hover overlays immediately when toggles change
  const sToggle = document.getElementById('sightings-toggle');
  if (sToggle) sToggle.addEventListener('change', clearHoverState);
  const hToggle = document.getElementById('heat-toggle');
  if (hToggle) hToggle.addEventListener('change', clearHoverState);

  // Hover listeners (throttled)
  map.on('mousemove', (e) => {
    if (hoverThrottle) return;
    hoverThrottle = setTimeout(async () => {
      hoverThrottle = null;
      await handleHoverMove(e.latlng);
    }, 120);
  });
  map.on('mouseout', clearHoverState);
}

export function getMap() { return map; }
export function setDeferRanges(v) { deferRanges = !!v; if (!v) renderAllRanges(); }

export function onMapMove(cb) { if (!map) return; map.on('moveend', () => cb()); }
export function getViewBounds() { if (!map) return null; const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }

export function setSelection(arr) {
  hasSelection = Array.isArray(arr) && arr.length > 0;
  for (const [k, layer] of layers) { map.removeLayer(layer); }
  layers.clear();
  if (!arr || !arr.length) {
    renderAllRanges();
    return;
  }
  arr.forEach(async (sci) => {
    const geo = await loadGeoJSON(sci);
    if (!geo) {
      return;
    }
    const layer = L.geoJSON(geo, {
      style: { color: colorFor(sci), weight: 1.4, fillColor: colorFor(sci), fillOpacity: 0.15, smoothFactor: 1 },
      renderer: rangeRenderer
    }).addTo(map);
    layers.set(sci, layer);
  });
  renderOverlap(arr);
}

function clearAllRanges(){ if (allRangesGroup) { allRangesGroup.clearLayers(); } }

async function renderAllRanges(){
  clearAllRanges();
  try {
    const res = await fetch(`${DATA_BASE}/species_common.json`);
    if (!res.ok) return;
    const list = await res.json();
    const maxToRender = 30;
    for (const e of list.slice(0, maxToRender)) {
      const geo = await loadGeoJSON(e.sci);
      if (!geo) continue;
      L.geoJSON(geo, {
        style: { color: '#64748b', weight: 0.8, fillColor: '#94a3b8', fillOpacity: 0.08, smoothFactor: 1 },
        renderer: rangeRenderer,
        interactive: false
      }).addTo(allRangesGroup);
    }
    if (allRangesGroup && map.hasLayer(allRangesGroup)) allRangesGroup.bringToBack();
  } catch {}
}

async function loadGeoJSON(sci) {
  if (geoCache.has(sci)) return geoCache.get(sci);
  try {
    const res = await fetch(`${DATA_BASE}/distributions/${sci}.geojson`);
    if (!res.ok) { console.warn('No distribution for', sci); return null; }
    const geo = await res.json();
    geoCache.set(sci, geo);
    return geo;
  } catch (e) {
    console.warn('Failed to load geojson for', sci, e);
    return null;
  }
}

function combineToMulti(geo) {
  try {
    if (geo.type === 'FeatureCollection') {
      const polys = [];
      for (const f of geo.features) {
        if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) polys.push(f.geometry);
      }
      if (!polys.length) return null;
      return { type: 'Feature', properties: {}, geometry: polys.length === 1 ? polys[0] : { type: 'MultiPolygon', coordinates: polys.flatMap(g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates) } };
    }
  } catch {}
  return null;
}

async function renderOverlap(selection) {
  if (overlapLayer) { map.removeLayer(overlapLayer); overlapLayer = null; }
  if (selection.length < 2) return;
  const multis = [];
  for (const sci of selection) {
    const geo = await loadGeoJSON(sci);
    if (!geo) continue;
    const multi = combineToMulti(geo);
    if (multi) multis.push(multi);
  }
  if (multis.length < 2) return;

  let inter = multis[0];
  for (let i = 1; i < multis.length; i++) {
    try {
      inter = turf.intersect(inter, multis[i]);
      if (!inter) break;
    } catch (e) {
      console.warn('Intersection failed at step', i, e);
      inter = null; break;
    }
  }
  if (!inter) return;

  overlapLayer = L.geoJSON(inter, {
    style: { color: '#7c3aed', weight: 2, fillColor: '#a78bfa', fillOpacity: 0.45 }
  }).addTo(map);
}

export async function toggleHeatLayer(on, m) {
  const targetMap = m || map;
  if (!targetMap) return;
  if (heatLayer) { targetMap.removeLayer(heatLayer); heatLayer = null; }
  if (!on) return;
  try {
    const res = await fetch(`${DATA_BASE}/heat_all_r6.geojson`);
    if (!res.ok) return;
    const geo = await res.json();

    const points = [];
    if (geo && geo.features && Array.isArray(geo.features)) {
      const features = geo.features;
      // Downsample for performance if extremely large
      const step = features.length > 50000 ? Math.ceil(features.length / 50000) : 1;
      for (let i = 0; i < features.length; i += step) {
        const f = features[i];
        if (!f || !f.geometry || f.geometry.type !== 'Point') continue;
        const [lng, lat] = f.geometry.coordinates || [];
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;
        const intensity = (f.properties && typeof f.properties.count === 'number') ? f.properties.count : 1;
        // Leaflet.heat expects [lat, lng, intensity]
        points.push([lat, lng, Math.max(0.2, Math.min(1, Math.log(1 + intensity) / 3))]);
      }
    }

    heatLayer = L.heatLayer(points, {
      radius: 18,
      blur: 15,
      maxZoom: 11,
      minOpacity: 0.25,
      // Gradient tuned for visibility on dark basemap
      gradient: { 0.2: '#1e3a8a', 0.4: '#2563eb', 0.6: '#f59e0b', 0.8: '#ef4444', 1.0: '#dc2626' }
    }).addTo(targetMap);
    if (allRangesGroup && targetMap.hasLayer(allRangesGroup)) allRangesGroup.bringToBack();
  } catch {}
}

async function ensureBboxesLoaded(){
  if (bboxMap) return;
  try {
    const res = await fetch(`${DATA_BASE}/distributions_bbox.json`);
    if (res.ok) {
      bboxMap = await res.json();
      bboxKeys = Object.keys(bboxMap);
    } else {
      bboxMap = {}; bboxKeys = [];
    }
  } catch {
    bboxMap = {}; bboxKeys = [];
  }
}

function pointInBbox(lng, lat, bb){
  // bb = [minX, minY, maxX, maxY]
  return !(lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]);
}

async function speciesUnderCursor(latlng){
  await ensureBboxesLoaded();
  const lng = latlng.lng, lat = latlng.lat;
  if (!bboxKeys || !bboxKeys.length) return [];

  // Narrow by bbox first
  const candidates = [];
  for (const sci of bboxKeys) {
    const bb = bboxMap[sci];
    if (!bb) continue;
    if (pointInBbox(lng, lat, bb)) candidates.push(sci);
  }
  if (!candidates.length) return [];

  // Precise test with polygons
  const p = turf.point([lng, lat]);
  const hits = [];
  for (const sci of candidates.slice(0, 40)) { // cap for safety
    const geo = await loadGeoJSON(sci);
    if (!geo) continue;
    try {
      if (geo.type === 'FeatureCollection') {
        let matched = false;
        for (const f of geo.features) {
          const g = f && f.geometry;
          if (!g) continue;
          if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
            const feature = { type: 'Feature', properties: {}, geometry: g };
            if (turf.booleanPointInPolygon(p, feature)) { matched = true; break; }
          }
        }
        if (matched) hits.push(sci);
      }
    } catch {}
    if (hits.length >= 6) break; // avoid too many highlights
  }
  return hits;
}

function clearHoverState(){
  if (hoverGroup) hoverGroup.clearLayers();
  if (hoverLabelsGroup) hoverLabelsGroup.clearLayers();
  if (hoverTooltip) { map.removeLayer(hoverTooltip); hoverTooltip = null; }
  hoverLabelRects = [];
}

function visibleLabelCoordsForGeo(geo) {
  try {
    const multi = combineToMulti(geo);
    if (!multi || !map) return null;
    const b = map.getBounds();
    const viewPoly = turf.bboxPolygon([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    let clipped = null;
    try {
      clipped = turf.intersect(multi, viewPoly) || null;
    } catch {}
    const target = clipped || multi;
    const p = turf.pointOnFeature(target);
    if (p && p.geometry && Array.isArray(p.geometry.coordinates) && p.geometry.coordinates.length === 2) {
      return p.geometry.coordinates;
    }
  } catch {}
  return null;
}

function labelSizeFor(text, z){
  const fontSize = z >= 12 ? 14 : (z >= 9 ? 12 : 11);
  const charW = 8.2; // slightly conservative to avoid underestimation
  const maxLineChars = 18;
  const lines = Math.max(1, Math.ceil(text.length / maxLineChars));
  const perLine = Math.ceil(text.length / lines);
  const swatch = 10 + 6; // swatch + gap
  const padding = 16; // left + right
  const width = Math.min(260, swatch + Math.ceil(perLine * charW) + padding);
  const height = lines * (fontSize + 6) + 6; // line heights + vertical padding
  return { width, height, fontSize };
}

function rectsOverlap(a, b){
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function findNonOverlappingScreenPoint(lat, lng, w, h){
  if (!map) return [lat, lng];
  const base = map.latLngToContainerPoint([lat, lng]);
  const size = map.getSize();
  const M = 8; // margin to keep labels separated
  const candidates = [];
  const rings = [0, 12, 20, 28, 36, 48, 60];
  for (const r of rings) {
    if (r === 0) {
      candidates.push([0, 0]);
    } else {
      candidates.push([r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]);
    }
  }
  for (const [dx, dy] of candidates) {
    const x = base.x + dx - (w + M)/2;
    const y = base.y + dy - (h + M)/2;
    const rect = { x, y, w: w + M, h: h + M };
    if (x < 0 || y < 0 || x + rect.w > size.x || y + rect.h > size.y) continue;
    let collides = false;
    for (const r of hoverLabelRects) { if (rectsOverlap(rect, r)) { collides = true; break; } }
    if (!collides) {
      hoverLabelRects.push(rect);
      const pt = L.point(base.x + dx, base.y + dy);
      const latlng2 = map.containerPointToLatLng(pt);
      return [latlng2.lat, latlng2.lng];
    }
  }
  return [lat, lng];
}

async function handleHoverMove(latlng){
  // Disable hover overlays when sightings or heat layers are active
  const sToggle = document.getElementById('sightings-toggle');
  const hToggle = document.getElementById('heat-toggle');
  if ((sToggle && sToggle.checked) || (hToggle && hToggle.checked)) {
    clearHoverState();
    return;
  }
  const hits = await speciesUnderCursor(latlng);
  clearHoverState();
  if (!hits.length) return;

  // Highlight matching ranges
  for (const sci of hits) {
    const geo = await loadGeoJSON(sci);
    if (!geo) continue;
    L.geoJSON(geo, {
      style: { color: colorFor(sci), weight: 2, fillColor: colorFor(sci), fillOpacity: 0.25 },
      pane: 'overlayPane'
    }).addTo(hoverGroup);

    // Add a viewport-aware label with common (non-scientific) name
    try {
      const coords = visibleLabelCoordsForGeo(geo) || [latlng.lng, latlng.lat];
      const [lng, lat] = coords;
      const commonOnly = (labelOf(sci) || '').split(' (')[0];
      const z = map.getZoom();
      const { width, height, fontSize } = labelSizeFor(commonOnly, z);
      const padding = z >= 12 ? '3px 8px' : '2px 6px';
      const col = colorFor(sci);
      const placed = findNonOverlappingScreenPoint(lat, lng, width, height);
      const [plat, plng] = placed;
      const labelHtml = `<div style="
              display:flex; align-items:center; gap:6px;
              color:#e5e7eb; font-weight:600; font-size:${fontSize}px; text-shadow:0 1px 2px rgba(0,0,0,0.9);
              background:rgba(17,24,39,0.35); padding:${padding}; border-radius:6px; pointer-events:none;
              border:1px solid rgba(148,163,184,0.3)">
              <span style=\"display:inline-block; width:10px; height:10px; border-radius:2px; background:${col}; border:1px solid rgba(255,255,255,0.6)\"></span>
              ${commonOnly}
            </div>`;
      const marker = L.marker([plat, plng], {
        interactive: false,
        icon: L.divIcon({
          className: 'species-label',
          html: labelHtml,
          iconSize: null,
          iconAnchor: [0, 0]
        })
      });
      marker.addTo(hoverLabelsGroup);
    } catch {}
  }
  hoverGroup.bringToFront();
  hoverLabelsGroup.bringToFront();

  // Tooltip with species labels at cursor (fallback / multi list)
  const html = hits.map(sci => {
    const name = (labelOf(sci) || '').split(' (')[0];
    const col = colorFor(sci);
    return `<div style="display:flex; align-items:center; gap:6px;">
              <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${col}; border:1px solid rgba(255,255,255,0.6)"></span>
              ${name}
            </div>`;
  }).join('');
  hoverTooltip = L.tooltip({ permanent: false, direction: 'top', className: 'hover-tip', offset: [0, -8] })
                   .setLatLng(latlng)
                   .setContent(html)
                   .addTo(map);
}


