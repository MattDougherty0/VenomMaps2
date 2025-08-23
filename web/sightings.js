import { sciPretty, getSelection, onSelectionChange, labelOf } from './main.js';
import { DATA_BASE } from './config.js';

let mapRef;
let layerGroup = null;
let heatLayer = null;
let clusterLayer = null;
const speciesData = new Map();
let visible = false;
let recencyDays = null;
let notificationElement = null;

// Zoom thresholds for different rendering strategies
const ZOOM_THRESHOLDS = {
  HEAT_ONLY: 6,      // Below this: only heat map
  CLUSTER: 10,        // Below this: use clustering
  INDIVIDUAL: 12      // Above this: show individual points
};

export function initSightings(map) {
  mapRef = map;
  layerGroup = L.layerGroup();
  clusterLayer = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true
  });
  
  onSelectionChange(handleSelectionChange);
  
  // Listen for zoom and movement changes
  mapRef.on('moveend zoomend', () => {
    if (visible) render();
  });
}

export function setSightingsVisible(v) { 
  visible = !!v; 
  console.log('Sightings visibility set to:', visible);
  
  if (!visible) {
    // Clear all layers when hiding
    if (layerGroup) layerGroup.clearLayers();
    if (clusterLayer) clusterLayer.clearLayers();
    if (heatLayer) {
      mapRef.removeLayer(heatLayer);
      heatLayer = null;
    }
    // Hide notification when turning off sightings
    hideNotification();
  } else {
    // Render when showing
    render();
  }
}

export function setRecencyDays(days) { 
  recencyDays = days; 
  console.log('Recency days set to:', recencyDays);
  
  if (visible) {
    render();
  }
}

function ageDays(ts) { return Math.floor((Date.now() - ts) / (24*3600*1000)); }

function recencyColor(days) {
  if (days == null) return '#9ca3af';
  if (days <= 1)  return '#ef4444';
  if (days <= 7)  return '#f97316';
  if (days <= 30) return '#f59e0b';
  if (days <= 90) return '#eab308';
  return '#9ca3af';
}

function createNotification() {
  if (notificationElement) return;
  
  notificationElement = document.createElement('div');
  notificationElement.id = 'sightings-notification';
  notificationElement.innerHTML = `
    <div style="
      position: absolute;
      top: 10px;
      left: 60px;
      background: #1f2937;
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 1000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      max-width: 250px;
      border-left: 3px solid #3b82f6;
      cursor: pointer;
      transition: opacity 0.15s ease;
    ">
      <div style="display: flex; align-items: center; gap: 6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
        <span>Zoom in to see sighting points</span>
      </div>
    </div>
  `;
  
  // Add click handler to dismiss notification
  notificationElement.addEventListener('click', () => {
    hideNotification();
  });
  
  // Position relative to the map container
  const mapContainer = mapRef.getContainer();
  mapContainer.appendChild(notificationElement);
}

function showNotification() {
  if (!notificationElement) createNotification();
  notificationElement.style.display = 'block';
  notificationElement.style.opacity = '1';
}

function hideNotification() {
  if (notificationElement) {
    notificationElement.style.opacity = '0';
    // Hide after opacity transition completes
    setTimeout(() => {
      if (notificationElement) {
        notificationElement.style.display = 'none';
      }
    }, 150);
  }
}

async function handleSelectionChange() { 
  console.log('Selection change detected, calling render');
  await render(); 
}

async function ensureSpeciesLoaded(sci) {
  if (speciesData.has(sci)) return;
  try {
    const url = `${DATA_BASE}/sightings/${sci}.json`;
    
    const res = await fetch(url);
    if (!res.ok) { 
      console.warn(`Failed to load sightings for ${sci}: ${res.status}`);
      speciesData.set(sci, []); 
      return; 
    }
    
    const data = await res.json();
    
    // Transform GeoJSON features to the format expected by the rendering code
    const transformed = [];
    if (data.features && Array.isArray(data.features)) {
      for (const feature of data.features) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        
        // Parse date - try to convert to timestamp
        let ts = Date.now(); // Default to now if no date
        if (props.date && props.date.trim()) {
          const parsedDate = new Date(props.date);
          if (!isNaN(parsedDate.getTime())) {
            ts = parsedDate.getTime();
          }
        }
        
        transformed.push({
          lat: coords[1], // latitude is second coordinate
          lon: coords[0], // longitude is first coordinate
          ts: ts,
          highlight: false,
          count: 1,
          // Include additional properties for popup
          date: props.date,
          source: props.source,
          locality: props.locality,
          country: props.country,
          scientificName: props.scientificName
        });
      }
    }
    
    speciesData.set(sci, transformed);
  } catch (error) {
    console.warn(`Failed to load sightings for ${sci}:`, error);
    speciesData.set(sci, []);
  }
}

function popupHtml(s){
  let when = 'Unknown date';
  if (s.date && s.date.trim()) {
    try {
      when = new Date(s.date).toISOString().slice(0,10);
    } catch {
      when = s.date;
    }
  }
  
  const extra = s.count && s.count > 1 ? ` (x${s.count})` : '';
  const locality = s.locality ? `<div>${s.locality}</div>` : '';
  const source = s.source ? `<div><em>Source: ${s.source}</em></div>` : '';
  
  return `<div>
    <div style="font-weight:600;">${s.scientificName || 'Sighting'}${extra}</div>
    <div>${when}</div>
    ${locality}
    ${source}
  </div>`;
}

async function render(){
  if (!mapRef || !visible) return;
  
  const currentZoom = mapRef.getZoom();
  
  // Clear all existing layers
  layerGroup.clearLayers();
  if (clusterLayer) clusterLayer.clearLayers();
  if (heatLayer) {
    mapRef.removeLayer(heatLayer);
    heatLayer = null;
  }
  
  const selected = getSelection();
  if (!selected.length) return;
  
  // Load data for selected species
  for (const sci of selected) await ensureSpeciesLoaded(sci);
  
  // Strategy 1: Very zoomed out - show heat map only
  if (currentZoom < ZOOM_THRESHOLDS.HEAT_ONLY) {
    showNotification();
    await renderHeatMap();
    return;
  }
  
  // Strategy 2: Medium zoom - use clustering
  if (currentZoom < ZOOM_THRESHOLDS.CLUSTER) {
    showNotification();
    await renderClusteredPoints();
    return;
  }
  
  // Strategy 3: High zoom - show individual points
  hideNotification();
  await renderIndividualPoints();
}

async function renderHeatMap() {
  try {
    const res = await fetch(`${DATA_BASE}/heat_all_r6.geojson`);
    if (!res.ok) return;
    
    const geo = await res.json();
    heatLayer = L.geoJSON(geo, {
      style: f => {
        const c = f.properties?.count || 1;
        const opacity = Math.min(0.05 + Math.log(1 + c) * 0.05, 0.4);
        return { 
          color: '#ef4444', 
          weight: 0, 
          fillColor: '#ef4444', 
          fillOpacity: opacity 
        };
      },
      interactive: false
    }).addTo(mapRef);
    heatLayer.bringToBack();
  } catch (error) {
    console.warn('Failed to render heat map:', error);
  }
}

async function renderClusteredPoints() {
  const bounds = mapRef.getBounds();
  const filtered = [];
  
  // Filter points by bounds and recency
  for (const sci of getSelection()) {
    const arr = speciesData.get(sci) || [];
    for (const s of arr) {
      if (recencyDays != null && ageDays(s.ts) > recencyDays) continue;
      if (!bounds.contains([s.lat, s.lon])) continue;
      filtered.push(s);
    }
  }
  
  // Add points to cluster layer
  for (const s of filtered) {
    const days = ageDays(s.ts);
    const color = recencyColor(days);
    
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 4,
      color: color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.6
    }).bindPopup(popupHtml(s), { maxWidth: 280 });
    
    clusterLayer.addLayer(marker);
  }
  
  clusterLayer.addTo(mapRef);
}

async function renderIndividualPoints() {
  const bounds = mapRef.getBounds();
  const filtered = [];
  
  // Filter points by bounds and recency
  for (const sci of getSelection()) {
    const arr = speciesData.get(sci) || [];
    for (const s of arr) {
      if (recencyDays != null && ageDays(s.ts) > recencyDays) continue;
      if (!bounds.contains([s.lat, s.lon])) continue;
      filtered.push(s);
    }
  }
  
  // Add individual points to layer group
  for (const s of filtered) {
    const days = ageDays(s.ts);
    const color = recencyColor(days);
    
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 3,
      color: color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.5
    }).bindPopup(popupHtml(s), { maxWidth: 280 });
    
    marker.addTo(layerGroup);
  }
  
  layerGroup.addTo(mapRef);
}


