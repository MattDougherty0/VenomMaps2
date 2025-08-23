import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.esm.js';
import { DATA_BASE } from './config.js';

export let COMMON = [];
export const COMMON_BY_SCI = Object.create(null);
export let SIGHTINGS_INDEX = [];

let fuse;

export async function loadCommon() {
  const res = await fetch(`${DATA_BASE}/species_common.json`);
  if (!res.ok) throw new Error('Failed to load species_common.json');
  COMMON = await res.json();
  for (const e of COMMON) COMMON_BY_SCI[e.sci] = e;
  buildFuse();
  try {
    const idxRes = await fetch(`${DATA_BASE}/sightings_index.json`);
    if (idxRes.ok) SIGHTINGS_INDEX = await idxRes.json();
  } catch (e) {
    // Silently handle missing sightings index
  }
}

function buildFuse(){
  fuse = new Fuse(COMMON, { keys: ['common', 'sci'], includeScore: true, threshold: 0.35 });
}

export function labelOf(sci){
  const e = COMMON_BY_SCI[sci];
  if (!e) return sciPretty(sci);
  
  // Extract clean English name from the verbose common name
  const cleanName = extractCleanName(e.common);
  return `${cleanName} (${sciPretty(sci)})`;
}

function extractCleanName(verboseName) {
  // Remove German translations and subspecies info
  // Look for the main English name before semicolons or brackets
  const parts = verboseName.split(/[;[]/);
  const mainPart = parts[0].trim();
  
  // Handle cases with multiple English names separated by commas
  const englishNames = mainPart.split(',').map(name => name.trim());
  
  // Return the first clean English name (usually the most common one)
  return englishNames[0];
}

export function sciPretty(sci){ return (sci || '').replace(/_/g, ' '); }

const COLORS = {};
export function colorFor(sci){
  if (COLORS[sci]) return COLORS[sci];
  const h = Math.abs(hashString(sci)) % 360;
  const c = `hsl(${h} 70% 50%)`;
  COLORS[sci] = c; return c;
}

function hashString(s){ let h = 0; for (let i=0;i<s.length;i++) { h = ((h<<5)-h) + s.charCodeAt(i); h|=0; } return h; }

export function querySpecies(q){
  if (!fuse || !q) return [];
  return fuse.search(q).map(r => r.item);
}

const selected = new Set();
let selectionListeners = [];

export function onSelectionChange(cb){ selectionListeners.push(cb); }
function emitSelection(){ 
  for (const cb of selectionListeners) {
    cb(Array.from(selected));
  }
  renderSelectedPanel(); 
}
export function getSelection(){ return Array.from(selected); }

export function toggleSpecies(sci){ if (selected.has(sci)) selected.delete(sci); else selected.add(sci); emitSelection(); }
export function clearSelection(){ selected.clear(); emitSelection(); }
export function selectAllSpecies(){ 
  for (const e of COMMON) {
    selected.add(e.sci);
  }
  emitSelection(); 
}

export function attachSearch() {
  const input = document.getElementById('search');
  const ul = document.getElementById('results');
  const hint = document.getElementById('hint');
  function render(items) {
    ul.innerHTML = '';
    if (!items.length) { hint.textContent = 'No matches. Try “rattlesnake” or “copperhead”.'; return; }
    hint.textContent = '';
    for (const e of items.slice(0, 30)) {
      const li = document.createElement('li');
      li.dataset.sci = e.sci;
      const idx = SIGHTINGS_INDEX.find(x => x.sci === e.sci);
      const countBadge = idx && idx.count ? `<span class="badge">${idx.count.toLocaleString()} sightings</span>` : '';
      const label = labelOf(e.sci);
      const cleanName = label.split(' (')[0];
      const sciName = sciPretty(e.sci);
      li.innerHTML = `
        <span class="swatch" style="background:${colorFor(e.sci)};"></span>
        <div class="species-info">
          <span class="common">${cleanName}</span>
          <span class="sci">(${sciName})</span>
        </div>
        ${countBadge}
      `;
      if (selected.has(e.sci)) li.classList.add('selected');
      li.onclick = () => toggleSpecies(e.sci);
      ul.appendChild(li);
    }
  }
  input.addEventListener('input', () => {
    const q = input.value;
    if (!q.trim()) { ul.innerHTML = ''; hint.textContent = 'Type to search e.g. “cottonmouth”, “timber rattlesnake”…'; return; }
    render(querySpecies(q));
  });
}

export function attachNearby({ onMove, getBounds }){
  const toggle = document.getElementById('nearby-toggle');
  const list = document.getElementById('nearby');
  const hint = document.getElementById('nearby-hint');
  async function render(){
    if (!toggle.checked) { list.style.display='none'; hint.style.display='none'; return; }
    const b = getBounds();
    if (!b) return;
    const pre = await fetch(`${DATA_BASE}/distributions_bbox.json`).then(r=>r.ok?r.json():{}).catch(()=>({}));
    const items = [];
    for (const sci in pre) {
      const bb = pre[sci];
      if (bboxIntersects(b, bb)) items.push(sci);
    }
    list.innerHTML = '';
    for (const sci of items.slice(0, 50)) {
      const li = document.createElement('li');
      const label = labelOf(sci);
      const cleanName = label.split(' (')[0];
      const sciName = sciPretty(sci);
      li.innerHTML = `
        <span class="swatch" style="background:${colorFor(sci)};"></span>
        <div class="species-info">
          <span class="common">${cleanName}</span>
          <span class="sci">(${sciName})</span>
        </div>
      `;
      list.appendChild(li);
    }
    list.style.display = '';
    hint.style.display = '';
  }
  toggle.addEventListener('change', render);
  onMove(render);
}

function bboxIntersects(a, b){ return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]); }

const BBOX_CACHE = Object.create(null);
const LS_KEY = 'vm_bboxes_v1';

function saveBboxesToStorage(){ try { localStorage.setItem(LS_KEY, JSON.stringify(BBOX_CACHE)); } catch {} }

function computeGeoJSONBbox(geo){
  try {
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    const each = (coords) => {
      for (const [x, y] of coords) {
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    };
    for (const f of geo.features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') for (const ring of g.coordinates) each(ring);
      if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const ring of poly) each(ring);
    }
    if (minX < Infinity) return [minX, minY, maxX, maxY];
  } catch {}
  return null;
}

async function getSpeciesBBox(sci) {
  if (BBOX_CACHE[sci]) return BBOX_CACHE[sci];
  try {
    if (!BBOX_CACHE.__loaded_precomputed) {
      const pre = await fetch(`${DATA_BASE}/distributions_bbox.json`);
      if (pre.ok) {
        const m = await pre.json();
        for (const k in m) BBOX_CACHE[k] = m[k];
      }
      BBOX_CACHE.__loaded_precomputed = true;
    }
    if (BBOX_CACHE[sci]) return BBOX_CACHE[sci];
  } catch {}
  try {
    const res = await fetch(`${DATA_BASE}/distributions/${sci}.geojson`);
    if (!res.ok) return null;
    const geo = await res.json();
    const bbox = computeGeoJSONBbox(geo);
    if (bbox) { BBOX_CACHE[sci] = bbox; saveBboxesToStorage(); }
    return bbox;
  } catch { return null; }
}

export function attachSelectedPanel() {
  const ul = document.getElementById('legend');
  const btn = document.getElementById('clear-selected');
  if (btn) btn.onclick = clearSelection;
  renderSelectedPanel();
}

function renderSelectedPanel(){
  const ul = document.getElementById('legend');
  if (!ul) return;
  ul.innerHTML = '';
  for (const sci of selected) {
    const li = document.createElement('li');
    const label = labelOf(sci);
    const cleanName = label.split(' (')[0];
    const sciName = sciPretty(sci);
    li.innerHTML = `
      <span class="swatch" style="background:${colorFor(sci)};"></span>
      <div class="species-info">
        <span class="common">${cleanName}</span>
        <span class="sci">(${sciName})</span>
      </div>
    `;
    ul.appendChild(li);
  }
}


