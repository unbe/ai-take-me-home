/**
 * app.js - Main Application Coordinator for Take Me Home
 */

import { Geo } from './geo.js?v=3.0';
import { Overpass } from './overpass.js?v=3.0';
import { Elevation } from './elevation.js?v=3.0';
import { Transit } from './transit.js?v=3.0';
import { MapManager } from './map.js?v=3.0';

// Application State
const State = {
  pilot: {
    lat: 46.6863,
    lon: 7.8632,
    altM: 1600,
  },
  destination: {
    lat: 46.9480,
    lon: 7.4474,
    name: 'Bern',
  },
  settings: {
    stopsCount: 15,
    searchRadiusKm: 8,
    speedKmH: 30,
    bufferMinutes: 30,
    maxGlideRatio: 8.0,
  },
  stops: [],
  isCalculating: false,
};

// Presets for quick demonstration & one-click pilot setup
const PRESETS = {
  interlaken: {
    pilot: { lat: 46.6863, lon: 7.8632, altM: 1600 },
    dest: { lat: 46.9480, lon: 7.4474, name: 'Bern' },
    stopsCount: 15,
    radiusKm: 8,
  },
  annecy: {
    pilot: { lat: 45.8580, lon: 6.2230, altM: 1450 },
    dest: { lat: 46.2044, lon: 6.1432, name: 'Geneva' },
    stopsCount: 15,
    radiusKm: 10,
  },
  bassano: {
    pilot: { lat: 45.8080, lon: 11.7780, altM: 1200 },
    dest: { lat: 45.4408, lon: 12.3155, name: 'Venice' },
    stopsCount: 15,
    radiusKm: 8,
  },
  steinhausen: {
    pilot: { lat: 47.1916, lon: 8.4837, altM: 800 },
    dest: { lat: 47.3769, lon: 8.5417, name: 'Zurich HB' },
    stopsCount: 15,
    radiusKm: 8,
  },
  verbier: {
    pilot: { lat: 46.0961, lon: 7.2286, altM: 2200 },
    dest: { lat: 46.5197, lon: 6.6323, name: 'Lausanne' },
    stopsCount: 15,
    radiusKm: 10,
  },
};

// UI Elements
const UI = {
  mapContainer: document.getElementById('map'),
  inputPanel: document.getElementById('input-panel'),
  btnOpenInputs: document.getElementById('btn-open-inputs'),
  btnCloseInputs: document.getElementById('btn-close-inputs'),
  btnCalculate: document.getElementById('btn-calculate'),
  fabRecalc: document.getElementById('fab-recalc'),
  btnGps: document.getElementById('btn-gps'),
  btnPilotGps: document.getElementById('btn-pilot-gps'),
  coordChip: document.getElementById('coord-chip'),
  chipPilotText: document.getElementById('chip-pilot-text'),
  chipDestText: document.getElementById('chip-dest-text'),
  bottomSheet: document.getElementById('bottom-sheet'),
  sheetHandleBar: document.getElementById('sheet-handle-bar'),
  btnToggleSheet: document.getElementById('btn-toggle-sheet'),
  heroCard: document.getElementById('hero-card'),
  heroBadge: document.getElementById('hero-badge'),
  heroName: document.getElementById('hero-name'),
  heroGlideVal: document.getElementById('hero-glide-val'),
  heroGlideDrop: document.getElementById('hero-glide-drop'),
  heroReachVal: document.getElementById('hero-reach-val'),
  heroDistVal: document.getElementById('hero-dist-val'),
  heroArrVal: document.getElementById('hero-arr-val'),
  heroTotalVal: document.getElementById('hero-total-val'),
  heroLinkGmaps: document.getElementById('hero-link-gmaps'),
  heroLinkSbbApp: document.getElementById('hero-link-sbb-app'),
  heroLinkSbb: document.getElementById('hero-link-sbb'),
  stopsList: document.getElementById('stops-list'),
  stopsEmptyMsg: document.getElementById('stops-empty-msg'),
  resultsCountTitle: document.getElementById('results-count-title'),
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingText: document.getElementById('loading-text'),
  toast: document.getElementById('toast'),

  // Inputs
  inputPilotLat: document.getElementById('input-pilot-lat'),
  inputPilotLon: document.getElementById('input-pilot-lon'),
  inputPilotAlt: document.getElementById('input-pilot-alt'),
  inputDestLat: document.getElementById('input-dest-lat'),
  inputDestLon: document.getElementById('input-dest-lon'),
  inputStopsCount: document.getElementById('input-stops-count'),
  inputSearchRadius: document.getElementById('input-search-radius'),
  inputSpeed: document.getElementById('input-speed'),
  inputBuffer: document.getElementById('input-buffer'),
  inputGlideThreshold: document.getElementById('input-glide-threshold'),
};

/**
 * Toast notifications
 */
function showToast(message, durationMs = 3000) {
  UI.toast.textContent = message;
  UI.toast.classList.add('is-visible');
  setTimeout(() => {
    UI.toast.classList.remove('is-visible');
  }, durationMs);
}

/**
 * Loading state
 */
function setLoading(isLoading, text = 'Loading...') {
  State.isCalculating = isLoading;
  if (isLoading) {
    UI.loadingText.textContent = text;
    UI.loadingOverlay.classList.add('is-active');
  } else {
    UI.loadingOverlay.classList.remove('is-active');
  }
}

/**
 * Sync UI input fields with internal state
 */
function syncInputsFromState() {
  UI.inputPilotLat.value = State.pilot.lat.toFixed(4);
  UI.inputPilotLon.value = State.pilot.lon.toFixed(4);
  UI.inputPilotAlt.value = Math.round(State.pilot.altM);
  UI.inputDestLat.value = State.destination.lat.toFixed(4);
  UI.inputDestLon.value = State.destination.lon.toFixed(4);
  UI.inputStopsCount.value = State.settings.stopsCount;
  UI.inputSearchRadius.value = State.settings.searchRadiusKm;
  UI.inputSpeed.value = State.settings.speedKmH;
  UI.inputBuffer.value = State.settings.bufferMinutes;
  UI.inputGlideThreshold.value = State.settings.maxGlideRatio;

  // Header chip
  UI.chipPilotText.textContent = `${Math.round(State.pilot.altM)}m (${State.pilot.lat.toFixed(2)}, ${State.pilot.lon.toFixed(2)})`;
  UI.chipDestText.textContent = State.destination.name || `${State.destination.lat.toFixed(2)}, ${State.destination.lon.toFixed(2)}`;
}

/**
 * Sync internal state from UI inputs
 */
function syncStateFromInputs() {
  State.pilot.lat = parseFloat(UI.inputPilotLat.value);
  State.pilot.lon = parseFloat(UI.inputPilotLon.value);
  State.pilot.altM = parseFloat(UI.inputPilotAlt.value) || 1000;
  State.destination.lat = parseFloat(UI.inputDestLat.value);
  State.destination.lon = parseFloat(UI.inputDestLon.value);
  State.settings.stopsCount = parseInt(UI.inputStopsCount.value, 10) || 15;
  State.settings.searchRadiusKm = parseFloat(UI.inputSearchRadius.value) || 8;
  State.settings.speedKmH = parseFloat(UI.inputSpeed.value) || 30;
  State.settings.bufferMinutes = parseFloat(UI.inputBuffer.value) || 30;
  State.settings.maxGlideRatio = parseFloat(UI.inputGlideThreshold.value) || 8.0;

  UI.chipPilotText.textContent = `${Math.round(State.pilot.altM)}m`;
  UI.chipDestText.textContent = State.destination.name || `${State.destination.lat.toFixed(2)}, ${State.destination.lon.toFixed(2)}`;
}

/**
 * Apply preset location
 */
function applyPreset(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return;

  State.pilot = { ...p.pilot };
  State.destination = { ...p.dest };
  State.settings.stopsCount = p.stopsCount;
  State.settings.searchRadiusKm = p.radiusKm;

  syncInputsFromState();
  closeInputPanel();
  showToast(`Loaded preset: ${p.dest.name}`);
  calculateRoutes();
}

/**
 * Geolocation GPS handler
 */
function useCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser');
    return;
  }

  showToast('Acquiring 3D GPS fix & altitude...');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      State.pilot.lat = pos.coords.latitude;
      State.pilot.lon = pos.coords.longitude;

      let altSource = 'GPS 3D';
      if (pos.coords.altitude !== null && pos.coords.altitude !== undefined && !isNaN(pos.coords.altitude)) {
        // Direct GNSS satellite 3D altitude
        State.pilot.altM = Math.round(pos.coords.altitude);
      } else {
        // Fallback: If device GPS hardware lacks 3D altitude or returns null,
        // lookup ground elevation via Open-Meteo elevation API
        try {
          const elevs = await Elevation.getBatchElevations([{ lat: State.pilot.lat, lon: State.pilot.lon }]);
          if (elevs && elevs.length > 0 && typeof elevs[0] === 'number') {
            State.pilot.altM = Math.round(elevs[0]);
            altSource = 'Terrain';
          }
        } catch (e) {
          console.warn('Could not fetch fallback terrain elevation:', e);
        }
      }

      syncInputsFromState();
      showToast(`📍 GPS: ${State.pilot.lat.toFixed(4)}, ${State.pilot.lon.toFixed(4)} | Alt: ${State.pilot.altM}m (${altSource})`, 4000);
      calculateRoutes();
    },
    (err) => {
      console.warn('Geolocation error:', err);
      showToast(`GPS Error: ${err.message}`);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/**
 * Toggle input panel
 */
function openInputPanel() {
  UI.inputPanel.classList.add('is-open');
}

function closeInputPanel() {
  UI.inputPanel.classList.remove('is-open');
}

/**
 * Bottom Sheet Toggle (Minimize / Expand)
 */
let isSheetExpanded = true;
function toggleBottomSheet() {
  isSheetExpanded = !isSheetExpanded;
  if (isSheetExpanded) {
    UI.bottomSheet.style.transform = 'translateY(0)';
    UI.btnToggleSheet.textContent = 'Minimize';
  } else {
    // Leave just header and hero card visible
    UI.bottomSheet.style.transform = 'translateY(calc(100% - 75px))';
    UI.btnToggleSheet.textContent = 'Expand';
  }
}

/**
 * Core Algorithm: Search stops, compute glide ratios, and query public transit
 */
async function calculateRoutes() {
  if (State.isCalculating) return;

  syncStateFromInputs();
  closeInputPanel();

  const { pilot, destination, settings } = State;

  // 1. Update map pins
  MapManager.setPilotMarker(pilot.lat, pilot.lon, pilot.altM);
  MapManager.setDestinationMarker(destination.lat, destination.lon, destination.name);

  try {
    // 2. Discover nearest stops via Overpass API
    setLoading(true, `Querying ${settings.stopsCount} nearest stops via Overpass API...`);
    const stops = await Overpass.findNearestStops(
      pilot.lat,
      pilot.lon,
      settings.stopsCount,
      settings.searchRadiusKm * 1000
    );

    // 3. Batch elevation lookup via Open-Meteo API
    setLoading(true, `Fetching terrain elevations for ${stops.length} candidate stops...`);
    await Elevation.populateStopElevations(stops);

    // 4. Calculate glide ratio, reach time, and journey start time
    const now = new Date();
    setLoading(true, `Calculating glide ratios & transit routes to destination...`);

    for (const stop of stops) {
      // Straight-line travel time: distKm / 30km/h + 30 min buffer
      stop.reachTimeMinutes = Geo.calculateReachTimeMinutes(
        stop.distKm,
        settings.speedKmH,
        settings.bufferMinutes
      );

      // Glide ratio: horizontal distance / altitude drop
      const glide = Geo.calculateGlideRatio(stop.distM, pilot.altM, stop.elevationM);
      stop.glideRatio = glide.ratio;
      stop.altDropM = glide.altDropM;
      stop.isUphill = glide.isUphill;
      stop.feasibility = Geo.evaluateFeasibility(
        stop.glideRatio,
        stop.isUphill,
        settings.maxGlideRatio - 0.5,
        settings.maxGlideRatio + 2.0
      );

      // Journey start time = now + reach time
      stop.targetDepartureDate = new Date(now.getTime() + stop.reachTimeMinutes * 60000);

      // Query public transit via Transitous / MOTIS v2 API
      stop.transit = await Transit.planJourney(
        stop,
        destination,
        stop.targetDepartureDate
      );

      // Total journey time from now to final destination arrival
      stop.totalTripMinutes = Math.round(
        stop.reachTimeMinutes + (stop.transit.transitDurationMinutes || 0) + (stop.transit.waitAtStopMinutes || 0)
      );
    }

    // 5. Rank stops by arrival time / total trip duration
    stops.sort((a, b) => a.totalTripMinutes - b.totalTripMinutes);
    State.stops = stops;

    // 6. Update Map with custom markers showing numbers & color codes
    MapManager.renderStops(stops, pilot, destination, (clickedStop) => {
      highlightStopCard(clickedStop);
    });

    // 7. Render UI (Hero Card & Ranked List)
    renderResults(stops);
    setLoading(false);
    showToast(`Calculated ${stops.length} options!`);

  } catch (err) {
    console.error('[App] Routing computation failed:', err);
    setLoading(false);
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Render Results in Bottom Sheet & Hero Card
 */
function renderResults(stops) {
  if (!stops || stops.length === 0) {
    UI.heroCard.style.display = 'none';
    UI.stopsEmptyMsg.style.display = 'block';
    UI.resultsCountTitle.textContent = 'No Stops Found';
    return;
  }

  UI.stopsEmptyMsg.style.display = 'none';
  UI.resultsCountTitle.textContent = `${stops.length} Public Transport Options`;

  // Render #1 Best Option into Hero Card for instant glance
  const best = stops[0];
  UI.heroCard.style.display = 'flex';
  UI.heroBadge.className = `status-pill ${best.feasibility.badgeClass}`;
  UI.heroBadge.textContent = `${best.feasibility.label} (${best.glideRatio !== null ? `${best.glideRatio}:1` : 'N/A'})`;
  UI.heroName.innerHTML = `${best.icon} ${best.name}`;
  UI.heroGlideVal.textContent = best.glideRatio !== null ? `${best.glideRatio}:1` : 'N/A';
  UI.heroGlideDrop.textContent = `${best.altDropM >= 0 ? `-${best.altDropM}m drop` : `+${Math.abs(best.altDropM)}m uphill`}`;
  UI.heroReachVal.textContent = Geo.formatDurationMinutes(best.reachTimeMinutes);
  UI.heroDistVal.textContent = Geo.formatDistance(best.distKm);
  UI.heroArrVal.textContent = Geo.formatTime(best.transit?.arrivalTime);
  UI.heroTotalVal.textContent = `${Geo.formatDurationMinutes(best.totalTripMinutes)} total`;

  const destNameOrCoords = State.destination.name || `${State.destination.lat.toFixed(4)}, ${State.destination.lon.toFixed(4)}`;
  const bestGmapsUrl = Geo.getGoogleMapsUrl(best.lat, best.lon, State.destination.lat, State.destination.lon);
  const bestSbbWebUrl = Geo.getSbbWebUrl(best.name, destNameOrCoords);
  const bestSbbAppUrl = Geo.getSbbMobileUrl(best.name, destNameOrCoords);

  if (UI.heroLinkGmaps) {
    UI.heroLinkGmaps.href = bestGmapsUrl;
    UI.heroLinkGmaps.onclick = (e) => e.stopPropagation();
  }
  if (UI.heroLinkSbbApp) {
    UI.heroLinkSbbApp.href = bestSbbAppUrl;
    UI.heroLinkSbbApp.onclick = (e) => e.stopPropagation();
  }
  if (UI.heroLinkSbb) {
    UI.heroLinkSbb.href = bestSbbWebUrl;
    UI.heroLinkSbb.onclick = (e) => e.stopPropagation();
  }

  UI.heroCard.onclick = () => {
    MapManager.focusStop(best.lat, best.lon);
    highlightStopCard(best);
  };

  // Render all ranked cards
  UI.stopsList.innerHTML = '';
  stops.forEach((stop, index) => {
    const rank = index + 1;
    const card = document.createElement('div');
    card.className = `stop-card ${rank === 1 ? 'is-active' : ''}`;
    card.id = `stop-card-${stop.id}`;

    const glideNum = stop.glideRatio !== null ? `${stop.glideRatio}:1` : 'N/A';
    const distText = Geo.formatDistance(stop.distKm);
    const reachText = Geo.formatDurationMinutes(stop.reachTimeMinutes);
    const transitText = Geo.formatDurationMinutes(stop.transit?.transitDurationMinutes);
    const totalText = Geo.formatDurationMinutes(stop.totalTripMinutes);
    const depTimeText = Geo.formatTime(stop.transit?.departureTime);
    const arrTimeText = Geo.formatTime(stop.transit?.arrivalTime);

    const gmapsUrl = Geo.getGoogleMapsUrl(stop.lat, stop.lon, State.destination.lat, State.destination.lon);
    const sbbWebUrl = Geo.getSbbWebUrl(stop.name, destNameOrCoords);
    const sbbAppUrl = Geo.getSbbMobileUrl(stop.name, destNameOrCoords);

    card.innerHTML = `
      <div class="stop-card-top">
        <div class="stop-card-title">
          <span class="stop-card-rank">#${rank}</span>
          <span>${stop.icon} ${stop.name}</span>
        </div>
        <div class="status-pill ${stop.feasibility.badgeClass}">
          ${stop.feasibility.label}
        </div>
      </div>

      <div class="stop-card-stats">
        <div class="stat-item">
          <span class="stat-lbl">Glide Ratio</span>
          <span class="stat-num" style="color: ${stop.feasibility.color}">${glideNum}</span>
          <small style="color: var(--text-muted)">drop: ${stop.altDropM}m</small>
        </div>
        <div class="stat-item">
          <span class="stat-lbl">Reach Stop</span>
          <span class="stat-num">${reachText}</span>
          <small style="color: var(--text-muted)">${distText} @ 30km/h</small>
        </div>
        <div class="stat-item">
          <span class="stat-lbl">Transit & Arr</span>
          <span class="stat-num">🏁 ${arrTimeText}</span>
          <small style="color: var(--text-muted)">${transitText} (${totalText} tot)</small>
        </div>
      </div>

      <div class="stop-card-route-summary">
        <span>🕒 <strong>${depTimeText} ➔ ${arrTimeText}</strong> • ${stop.transit?.summary || 'Transit Route'}</span>
      </div>

      <div class="card-links-row">
        <a class="card-link-btn gmaps" href="${gmapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
          <span>🗺️ Google Maps</span>
        </a>
        <a class="card-link-btn sbb-app" href="${sbbAppUrl}" onclick="event.stopPropagation()">
          <span>📱 SBB App</span>
        </a>
        <a class="card-link-btn sbb" href="${sbbWebUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
          <span>🚆 SBB Web</span>
        </a>
      </div>
    `;

    card.addEventListener('click', () => {
      MapManager.focusStop(stop.lat, stop.lon);
      highlightStopCard(stop);
    });

    UI.stopsList.appendChild(card);
  });
}

function highlightStopCard(stop) {
  document.querySelectorAll('.stop-card').forEach(el => el.classList.remove('is-active'));
  const card = document.getElementById(`stop-card-${stop.id}`);
  if (card) {
    card.classList.add('is-active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Initialize event listeners
 */
function initEvents() {
  UI.btnOpenInputs.addEventListener('click', openInputPanel);
  UI.btnCloseInputs.addEventListener('click', closeInputPanel);
  UI.coordChip.addEventListener('click', openInputPanel);
  UI.btnCalculate.addEventListener('click', calculateRoutes);
  UI.fabRecalc.addEventListener('click', calculateRoutes);
  UI.btnGps.addEventListener('click', useCurrentLocation);
  UI.btnPilotGps.addEventListener('click', useCurrentLocation);
  UI.btnToggleSheet.addEventListener('click', toggleBottomSheet);
  UI.sheetHandleBar.addEventListener('click', toggleBottomSheet);

  // Preset chips
  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      applyPreset(presetKey);
    });
  });

  // Map click to set location
  MapManager.onLocationSelected = (lat, lon) => {
    // If input panel is open, update destination or pilot based on focus
    State.pilot.lat = lat;
    State.pilot.lon = lon;
    syncInputsFromState();
    showToast(`Updated pilot position to ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  };
}

/**
 * Bootstrap Application
 */
function init() {
  console.log('[Take Me Home] Initializing application...');
  MapManager.init('map');
  syncInputsFromState();
  initEvents();

  // Initial calculation with default preset (Interlaken)
  setTimeout(() => {
    calculateRoutes();
  }, 400);
}

// Kick off when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
