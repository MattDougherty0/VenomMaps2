import { sciPretty, getSelection, onSelectionChange, labelOf } from './main.js';
import { DATA_BASE } from './config.js';

let mapRef;
let layerGroup = null;
const speciesData = new Map();
let visible = false;
let recencyDays = null;

export function initSightings(map) {
  mapRef = map;
  layerGroup = L.layerGroup();
  onSelectionChange(handleSelectionChange);
  mapRef.on('moveend zoomend', () => render());
}

export function setSightingsVisible(v) {
  visible = !!v;
  render();
}

export function setRecencyDays(days) { recencyDays = days; render(); }

function ageDays(ts) { return Math.floor((Date.now() - ts) / (24*3600*1000)); }

function recencyColor(days) {
  if (days == null) return '#9ca3af';
  if (days <= 1)  return '#ef4444';
  if (days <= 7)  return '#f97316';
  if (days <= 30) return '#f59e0b';
  if (days <= 90) return '#eab308';
  return '#9ca3af';
}

async function handleSelectionChange() { await render(); }

async function ensureSpeciesLoaded(sci) {
  if (speciesData.has(sci)) return;
  try {
    const url = `${DATA_BASE}/sightings/${sci}.json`;
    const res = await fetch(url);
    if (!res.ok) { speciesData.set(sci, []); return; }
    const arr = await res.json();
    speciesData.set(sci, Array.isArray(arr) ? arr : []);
  } catch { speciesData.set(sci, []); }
}

function popupHtml(s){
  const when = new Date(s.ts).toISOString().slice(0,10);
  const extra = s.count && s.count > 1 ? ` (x${s.count})` : '';
  return `<div><div style="font-weight:600;">Recent sighting${extra}</div><div>${when}</div></div>`;
}

async function render(){
  if (!mapRef || !layerGroup) return;
  layerGroup.clearLayers();
  if (!visible) return;
  const selected = getSelection();
  for (const sci of selected) await ensureSpeciesLoaded(sci);
  const bounds = mapRef.getBounds();
  const filtered = [];
  for (const sci of selected) {
    const arr = speciesData.get(sci) || [];
    for (const s of arr) {
      if (recencyDays != null && ageDays(s.ts) > recencyDays) continue;
      if (!bounds.contains([s.lat, s.lon])) continue;
      filtered.push(s);
    }
  }
  for (const s of filtered) {
    const days = ageDays(s.ts);
    const color = s.highlight ? '#b91c1c' : recencyColor(days);
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: s.highlight ? 7 : 6,
      color,
      weight: s.highlight ? 3 : 2,
      fillColor: color,
      fillOpacity: s.highlight ? 0.6 : 0.35
    }).bindPopup(popupHtml(s), { maxWidth: 280 });
    marker.addTo(layerGroup);
  }
  layerGroup.addTo(mapRef);
}


