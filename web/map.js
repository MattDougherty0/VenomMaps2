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

export async function initMap() {
  map = L.map('map', { zoomControl: true, minZoom: 3, maxZoom: 18, preferCanvas: true })
          .setView([39.5, -98.35], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  rangeRenderer = L.canvas({ padding: 0.5 });
  allRangesGroup = L.layerGroup().addTo(map);
  map.on('movestart', () => { if (deferRanges && !hasSelection) clearAllRanges(); });
  map.on('moveend', () => { if (deferRanges && !hasSelection) renderAllRanges(); });
}

export function getMap() { return map; }
export function setDeferRanges(v) { deferRanges = !!v; if (!v) renderAllRanges(); }

export function onMapMove(cb) { if (!map) return; map.on('moveend', () => cb()); }
export function getViewBounds() { if (!map) return null; const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }

export function setSelection(arr) {
  hasSelection = Array.isArray(arr) && arr.length > 0;
  for (const [k, layer] of layers) { map.removeLayer(layer); }
  layers.clear();
  if (!arr || !arr.length) { renderAllRanges(); return; }
  arr.forEach(async (sci) => {
    const geo = await loadGeoJSON(sci);
    if (!geo) return;
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
    heatLayer = L.geoJSON(geo, {
      style: f => {
        const c = f.properties?.count || 1;
        const opacity = Math.min(0.05 + Math.log(1 + c) * 0.05, 0.4);
        return { color: '#ef4444', weight: 0, fillColor: '#ef4444', fillOpacity: opacity };
      },
      interactive: false
    }).addTo(targetMap);
    heatLayer.bringToBack();
  } catch {}
}


