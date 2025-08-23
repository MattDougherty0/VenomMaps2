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

// Performance optimization settings
const PERFORMANCE_CONFIG = {
  MAX_POINTS_PER_RENDER: 5000,        // Maximum points to render at once
  MAX_POINTS_PER_SPECIES: 2000,       // Maximum points per species to load
  VIEWPORT_BUFFER: 0.1,               // Extra buffer around viewport for smooth panning
  RENDER_THROTTLE_MS: 100,            // Throttle render calls
  CLUSTER_MAX_ZOOM: 8,                // Use clustering below this zoom level
  HEAT_ONLY_ZOOM: 5                   // Show only heat map below this zoom
};

// Zoom thresholds for different rendering strategies
const ZOOM_THRESHOLDS = {
  HEAT_ONLY: PERFORMANCE_CONFIG.HEAT_ONLY_ZOOM,
  CLUSTER: PERFORMANCE_CONFIG.CLUSTER_MAX_ZOOM,
  INDIVIDUAL: 12
};

// Performance tracking
let renderThrottleTimer = null;
let lastRenderTime = 0;
let currentViewport = null;

export function initSightings(map) {
  mapRef = map;
  layerGroup = L.layerGroup();
  clusterLayer = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 80,              // Increased for better performance
    spiderfyOnMaxZoom: false,          // Disabled for performance
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    chunkInterval: 200,                // Longer intervals between chunks
    chunkDelay: 50                     // Delay between chunks
  });
  
  onSelectionChange(handleSelectionChange);
  
  // Throttled rendering for better performance
  mapRef.on('moveend zoomend', () => {
    if (visible && !renderThrottleTimer) {
      renderThrottleTimer = setTimeout(() => {
        renderThrottleTimer = null;
        if (visible) render();
      }, PERFORMANCE_CONFIG.RENDER_THROTTLE_MS);
    }
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
    
    // Remove performance warning
    const warning = document.getElementById('performance-warning');
    if (warning) {
      warning.parentNode.removeChild(warning);
    }
    
    // Clear performance tracking
    renderThrottleTimer = null;
    lastRenderTime = 0;
    currentViewport = null;
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

function showPerformanceWarning(pointCount) {
  if (pointCount > PERFORMANCE_CONFIG.MAX_POINTS_PER_RENDER) {
    if (!document.getElementById('performance-warning')) {
      const warning = document.createElement('div');
      warning.id = 'performance-warning';
      warning.innerHTML = `
        <div style="
          position: fixed;
          bottom: 20px;
          left: 20px;
          background: #dc2626;
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 1000;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          max-width: 300px;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Performance: Showing ${pointCount.toLocaleString()} points. Zoom in for better performance.</span>
          </div>
        </div>
      `;
      document.body.appendChild(warning);
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        if (warning.parentNode) {
          warning.parentNode.removeChild(warning);
        }
      }, 5000);
    }
  }
}

async function handleSelectionChange() { 
  console.log('Selection change detected, clearing old data and calling render');
  clearOldData();
  await render();
  logPerformanceMetrics();
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
      // Limit the number of points per species for performance
      const maxPoints = Math.min(data.features.length, PERFORMANCE_CONFIG.MAX_POINTS_PER_SPECIES);
      
      for (let i = 0; i < maxPoints; i++) {
        const feature = data.features[i];
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

// Smart viewport-based data loading
async function loadViewportData() {
  const bounds = mapRef.getBounds();
  const buffer = PERFORMANCE_CONFIG.VIEWPORT_BUFFER;
  
  // Expand bounds with buffer for smooth panning
  const expandedBounds = L.latLngBounds(
    [bounds.getSouth() - (bounds.getHeight() * buffer), bounds.getWest() - (bounds.getWidth() * buffer)],
    [bounds.getNorth() + (bounds.getHeight() * buffer), bounds.getEast() + (bounds.getWidth() * buffer)]
  );
  
  // Only reload if viewport changed significantly
  if (currentViewport && 
      currentViewport.contains(expandedBounds) && 
      expandedBounds.contains(currentViewport)) {
    return; // Viewport hasn't changed enough to warrant reloading
  }
  
  currentViewport = expandedBounds;
  
  const selected = getSelection();
  if (!selected.length) return;
  
  // Load data for selected species
  for (const sci of selected) {
    await ensureSpeciesLoaded(sci);
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
  const now = Date.now();
  
  // Prevent excessive rendering
  if (now - lastRenderTime < PERFORMANCE_CONFIG.RENDER_THROTTLE_MS) {
    return;
  }
  lastRenderTime = now;
  
  // Clear all existing layers
  layerGroup.clearLayers();
  if (clusterLayer) clusterLayer.clearLayers();
  if (heatLayer) {
    mapRef.removeLayer(heatLayer);
    heatLayer = null;
  }
  
  const selected = getSelection();
  if (!selected.length) return;
  
  // Load viewport data efficiently
  await loadViewportData();
  
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
  
  // Limit total points for performance
  const maxPoints = Math.min(filtered.length, PERFORMANCE_CONFIG.MAX_POINTS_PER_RENDER);
  const pointsToRender = filtered.slice(0, maxPoints);
  
  console.log(`Clustering ${pointsToRender.length} points (filtered from ${filtered.length})`);
  
  // Show performance warning if needed
  showPerformanceWarning(filtered.length);
  
  // Add points to cluster layer
  for (const s of pointsToRender) {
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
  
  // Limit total points for performance
  const maxPoints = Math.min(filtered.length, PERFORMANCE_CONFIG.MAX_POINTS_PER_RENDER);
  const pointsToRender = filtered.slice(0, maxPoints);
  
  console.log(`Showing ${pointsToRender.length} individual points (filtered from ${filtered.length})`);
  
  // Show performance warning if needed
  showPerformanceWarning(filtered.length);
  
  // Add individual points to layer group
  for (const s of pointsToRender) {
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

// Memory management
function clearOldData() {
  // Clear data for species that are no longer selected
  const selected = getSelection();
  for (const [sci, data] of speciesData.entries()) {
    if (!selected.includes(sci)) {
      speciesData.delete(sci);
    }
  }
  
  // Force garbage collection hint
  if (window.gc) {
    window.gc();
  }
}

// Performance monitoring
function logPerformanceMetrics() {
  const totalPoints = Array.from(speciesData.values()).reduce((sum, arr) => sum + arr.length, 0);
  const memoryUsage = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : 'N/A';
  
  console.log(`Performance: ${totalPoints} total points, ${memoryUsage}MB memory, ${Date.now() - lastRenderTime}ms since last render`);
}


