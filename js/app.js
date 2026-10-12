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
    uicRef: '8507000',
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
    dest: { lat: 46.9480, lon: 7.4474, name: 'Bern', uicRef: '8507000' },
    stopsCount: 15,
    radiusKm: 8,
  },
  annecy: {
    pilot: { lat: 45.8580, lon: 6.2230, altM: 1450 },
    dest: { lat: 46.2044, lon: 6.1432, name: 'Geneva', uicRef: '8501008' },
    stopsCount: 15,
    radiusKm: 10,
  },
  bassano: {
    pilot: { lat: 45.8080, lon: 11.7780, altM: 1200 },
    dest: { lat: 45.4408, lon: 12.3155, name: 'Venice', uicRef: '8300098' },
    stopsCount: 15,
    radiusKm: 8,
  },
  steinhausen: {
    pilot: { lat: 47.1916, lon: 8.4837, altM: 800 },
    dest: { lat: 47.3769, lon: 8.5417, name: 'Zurich HB', uicRef: '8503000' },
    stopsCount: 15,
    radiusKm: 8,
  },
  verbier: {
    pilot: { lat: 46.0961, lon: 7.2286, altM: 2200 },
    dest: { lat: 46.5197, lon: 6.6323, name: 'Lausanne', uicRef: '8501120' },
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
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingText: document.getElementById('loading-text'),
  toast: document.getElementById('toast'),

  // Tapped Stop Details Box
  tappedStopCard: document.getElementById('tapped-stop-card'),
  tappedRank: document.getElementById('tapped-rank'),
  tappedName: document.getElementById('tapped-name'),
  tappedBadge: document.getElementById('tapped-badge'),
  tappedGlide: document.getElementById('tapped-glide'),
  tappedDrop: document.getElementById('tapped-drop'),
  tappedReach: document.getElementById('tapped-reach'),
  tappedDist: document.getElementById('tapped-dist'),
  tappedTotal: document.getElementById('tapped-total'),
  tappedArr: document.getElementById('tapped-arr'),
  tappedLegs: document.getElementById('tapped-legs'),
  tappedLinkGmaps: document.getElementById('tapped-link-gmaps'),
  tappedLinkSbbApp: document.getElementById('tapped-link-sbb-app'),
  tappedLinkSbbWeb: document.getElementById('tapped-link-sbb-web'),
  btnCloseTappedCard: document.getElementById('btn-close-tapped-card'),

  // Inputs
  inputPilotLat: document.getElementById('input-pilot-lat'),
  inputPilotLon: document.getElementById('input-pilot-lon'),
  inputPilotAlt: document.getElementById('input-pilot-alt'),
  inputDestName: document.getElementById('input-dest-name'),
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
  if (UI.inputDestName) UI.inputDestName.value = State.destination.name || '';
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

  const newDestLat = parseFloat(UI.inputDestLat.value);
  const newDestLon = parseFloat(UI.inputDestLon.value);
  const typedName = UI.inputDestName ? UI.inputDestName.value.trim() : '';

  // Check if destination coordinates changed from existing state
  const coordsChanged =
    Math.abs(newDestLat - State.destination.lat) > 0.0001 ||
    Math.abs(newDestLon - State.destination.lon) > 0.0001;

  State.destination.lat = newDestLat;
  State.destination.lon = newDestLon;

  // Check if new coordinates match any preset
  const matchedPreset = Object.values(PRESETS).find(
    p => Math.abs(p.dest.lat - newDestLat) < 0.005 && Math.abs(p.dest.lon - newDestLon) < 0.005
  );

  if (coordsChanged) {
    if (matchedPreset) {
      State.destination.name = matchedPreset.dest.name;
      State.destination.uicRef = matchedPreset.dest.uicRef;
      if (UI.inputDestName) UI.inputDestName.value = matchedPreset.dest.name;
    } else {
      // Changed to custom coordinates: do not retain previous preset name (e.g. Bern)
      if (typedName && (!matchedPreset || typedName !== matchedPreset.dest.name) && typedName !== 'Bern') {
        State.destination.name = typedName;
      } else {
        State.destination.name = `${newDestLat.toFixed(4)}, ${newDestLon.toFixed(4)}`;
        if (UI.inputDestName) UI.inputDestName.value = State.destination.name;
      }
      State.destination.uicRef = null;
    }
  } else {
    // Coordinates didn't change: check if user edited the name
    if (typedName) {
      State.destination.name = typedName;
      State.destination.uicRef = (matchedPreset && matchedPreset.dest.name.toLowerCase() === typedName.toLowerCase())
        ? matchedPreset.dest.uicRef
        : null;
    } else if (matchedPreset) {
      State.destination.name = matchedPreset.dest.name;
      State.destination.uicRef = matchedPreset.dest.uicRef;
    } else {
      State.destination.name = `${newDestLat.toFixed(4)}, ${newDestLon.toFixed(4)}`;
      State.destination.uicRef = null;
    }
  }

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
 * Tapped Stop Details Box (Shows full details + SBB/GMaps links for tapped stop)
 */
let currentlyTappedStop = null;
let currentlyTappedRank = 1;

function showTappedStopCard(stop, rank = 1) {
  currentlyTappedStop = stop;
  currentlyTappedRank = rank;
  MapManager.selectStop(stop.id);
  if (!UI.tappedStopCard) return;

  const hasLiveSchedule = stop.transit && stop.transit.hasSchedule;
  const isQuerying = !!stop.isQuerying;

  const totalTimeText = (hasLiveSchedule && isFinite(stop.totalTripMinutes))
    ? Geo.formatDurationMinutes(stop.totalTripMinutes)
    : (isQuerying ? 'Fetching...' : (!stop.transit ? 'Queued...' : '--'));

  const glideNum = stop.glideRatio !== null ? `${stop.glideRatio}:1` : (stop.isUphill ? 'UP' : 'N/A');
  const dropText = stop.altDropM >= 0 ? `-${stop.altDropM}m drop` : `+${Math.abs(stop.altDropM)}m uphill`;
  const depText = hasLiveSchedule ? Geo.formatTime(stop.transit?.departureTime) : '--:--';
  const arrText = hasLiveSchedule
    ? Geo.formatTime(stop.transit?.arrivalTime)
    : (isQuerying ? 'Querying...' : (!stop.transit ? 'Queued...' : 'No service'));

  UI.tappedRank.textContent = `#${rank}`;
  UI.tappedName.textContent = `${stop.icon || '🚏'} ${stop.name}`;
  UI.tappedBadge.className = `status-pill ${stop.feasibility.badgeClass}`;
  UI.tappedBadge.textContent = stop.feasibility.label;

  UI.tappedGlide.textContent = glideNum;
  UI.tappedGlide.style.color = stop.feasibility.color;
  UI.tappedDrop.textContent = dropText;

  UI.tappedReach.textContent = Geo.formatDurationMinutes(stop.reachTimeMinutes);
  UI.tappedDist.textContent = Geo.formatDistance(stop.distKm);

  UI.tappedTotal.textContent = totalTimeText;
  UI.tappedArr.textContent = hasLiveSchedule
    ? `Arr ${arrText}`
    : (isQuerying ? 'Fetching...' : (!stop.transit ? 'Queued...' : 'No service'));

  if (hasLiveSchedule) {
    UI.tappedLegs.innerHTML = `🕒 <strong>${depText} ➔ ${arrText}</strong> • ${stop.transit?.summary || 'Transit route'}`;
  } else if (isQuerying) {
    UI.tappedLegs.textContent = '⏳ Live timetable query currently in progress...';
  } else if (!stop.transit) {
    UI.tappedLegs.textContent = '⏳ Timetable query queued...';
  } else {
    UI.tappedLegs.textContent = `⚠️ ${stop.transit?.summary || 'No scheduled transit route found'}`;
  }

  // Links
  const destNameOrCoords = State.destination.name || `${State.destination.lat.toFixed(4)}, ${State.destination.lon.toFixed(4)}`;
  UI.tappedLinkGmaps.href = Geo.getGoogleMapsUrl(stop.lat, stop.lon, State.destination.lat, State.destination.lon);
  UI.tappedLinkSbbApp.href = Geo.getSbbMobileUrl(stop.name, destNameOrCoords);
  UI.tappedLinkSbbWeb.href = Geo.getSbbWebUrl(stop, State.destination, stop.transit?.departureTime || stop.targetDepartureDate);

  UI.tappedStopCard.style.display = 'flex';
}

function hideTappedStopCard() {
  currentlyTappedStop = null;
  MapManager.clearSelection();
  if (UI.tappedStopCard) {
    UI.tappedStopCard.style.display = 'none';
  }
}

/**
 * Core Algorithm: Search stops, compute glide ratios, and query public transit
 */
async function calculateRoutes() {
  if (State.isCalculating) return;
  State.isCalculating = true;

  syncStateFromInputs();
  closeInputPanel();
  hideTappedStopCard();

  const { pilot, destination, settings } = State;

  // 1. Update map pins
  MapManager.setPilotMarker(pilot.lat, pilot.lon, pilot.altM);
  MapManager.setDestinationMarker(destination.lat, destination.lon, destination.name);

  try {
    // 2. Discover nearest stops via Overpass API with Adaptive Glide Ratio Radius Expansion:
    // If the stops found within the current radius still have great glide ratios (e.g. <= maxGlideRatio),
    // keep expanding the search radius up to a strict 20km maximum to discover faster transit options.
    const maxSearchRadiusM = Math.min(settings.searchRadiusKm * 1000, 20000);
    setLoading(true, `Querying stops (expanding up to 20km if glide ratio is great)...`);

    const shouldContinueExpanding = async (currentStops, currentRadiusM) => {
      if (currentRadiusM >= 20000) return false;

      // Check elevation and glide ratio for candidate stops found so far
      await Elevation.populateStopElevations(currentStops);
      let reachableCount = 0;
      let greatGlideCount = 0;

      for (const st of currentStops) {
        const g = Geo.calculateGlideRatio(st.distM, pilot.altM, st.elevationM);
        st.glideRatio = g.ratio;
        st.altDropM = g.altDropM;
        st.isUphill = g.isUphill;
        // "Great" glide ratio: safely within pilot threshold (e.g. <= maxGlideRatio, default 7.5-8.0)
        if (g.ratio !== null && !g.isUphill && g.ratio <= settings.maxGlideRatio) {
          greatGlideCount++;
        }
        if (g.ratio !== null && !g.isUphill && g.ratio <= settings.maxGlideRatio + 2.0) {
          reachableCount++;
        }
      }

      // If at least 5 stops or at least 50% have great glide ratios, keep expanding up to 20km!
      const isGlideStillGreat = greatGlideCount >= 5 || (greatGlideCount / currentStops.length) >= 0.5;
      if (isGlideStillGreat && currentRadiusM < 20000) {
        setLoading(true, `Glide ratio is great (${greatGlideCount} stops <= ${settings.maxGlideRatio}:1)! Expanding radius beyond ${Math.round(currentRadiusM / 1000)}km (up to 20km max)...`);
        return true;
      }
      return false;
    };

    const stops = await Overpass.findNearestStops(
      pilot.lat,
      pilot.lon,
      settings.stopsCount,
      maxSearchRadiusM,
      shouldContinueExpanding
    );

    // 3. Batch elevation lookup via Open-Meteo API
    setLoading(true, `Fetching terrain elevations for ${stops.length} candidate stops...`);
    await Elevation.populateStopElevations(stops);

    // 4. Calculate glide ratios & reach times instantaneously (local vector math)
    const now = new Date();
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
    }

    // Sort candidate stops so reachable & marginal ones are queried FIRST
    const priority = { reachable: 0, marginal: 1, unreachable: 2 };
    stops.sort((a, b) => {
      const pDiff = (priority[a.feasibility.status] || 2) - (priority[b.feasibility.status] || 2);
      if (pDiff !== 0) return pDiff;
      return a.distM - b.distM;
    });

    // 4b. PROGRESSIVE RENDER 1: Display all candidate stops immediately!
    // At this moment, glide ratios, drop altitudes, and reach times are fully known.
    State.stops = stops;
    MapManager.renderStops(stops, pilot, destination, (clickedStop, rank) => {
      showTappedStopCard(clickedStop, rank);
    }, true); // shouldFitBounds = true only on initial candidate render

    // 5. Query public transit strictly sequentially (1 request at a time)
    // Whenever a stop is shown, always also query the travel time, even if the glide ratio isn't great
    const totalToQuery = stops.length;
    let liveQueriesCount = 0;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      liveQueriesCount++;
      setLoading(true, `Querying timetable ${liveQueriesCount}/${totalToQuery}: ${stop.name}...`);
      stop.isQuerying = true;
      MapManager.renderStops(stops, pilot, destination, (clickedStop, rank) => {
        showTappedStopCard(clickedStop, rank);
      }, false);

      stop.transit = await Transit.planJourney(stop, destination, stop.targetDepartureDate);
      stop.isQuerying = false;

      // Total journey time from now to final destination arrival
      if (stop.transit && stop.transit.hasSchedule) {
        stop.totalTripMinutes = Math.round(
          stop.reachTimeMinutes + (stop.transit.transitDurationMinutes || 0) + (stop.transit.waitAtStopMinutes || 0)
        );
      } else {
        // Without confirmed schedule, sort behind real timetable options
        stop.totalTripMinutes = Infinity;
      }

      // Progressive sort: Confirmed live schedules first, ordered by total travel time;
      // followed by remaining stops sorted by glide feasibility & distance.
      stops.sort((a, b) => {
        const aHas = a.transit && a.transit.hasSchedule && isFinite(a.totalTripMinutes);
        const bHas = b.transit && b.transit.hasSchedule && isFinite(b.totalTripMinutes);
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        if (aHas && bHas) {
          if (a.totalTripMinutes !== b.totalTripMinutes) {
            return a.totalTripMinutes - b.totalTripMinutes;
          }
          return a.distM - b.distM;
        }
        const pDiff = (priority[a.feasibility?.status] ?? 2) - (priority[b.feasibility?.status] ?? 2);
        if (pDiff !== 0) return pDiff;
        return a.distM - b.distM;
      });

      // PROGRESSIVE RENDER: Update map immediately after every stop query without resetting zoom or closing cards!
      MapManager.renderStops(stops, pilot, destination, (clickedStop, rank) => {
        showTappedStopCard(clickedStop, rank);
      }, false);

      // If the currently tapped stop card is visible, refresh its timetable info live!
      if (currentlyTappedStop && currentlyTappedStop.id === stop.id) {
        const currentRank = stops.findIndex(s => s.id === stop.id) + 1;
        showTappedStopCard(stop, currentRank);
      }
    }

    setLoading(false);
    const confirmedCount = stops.filter(s => s.transit && s.transit.hasSchedule).length;
    const fastestStop = stops.find(s => s.transit && s.transit.hasSchedule && isFinite(s.totalTripMinutes));
    const fastestText = fastestStop ? ` Fastest: ${Geo.formatDurationMinutes(fastestStop.totalTripMinutes)} (${fastestStop.name})` : '';
    showToast(`Found ${stops.length} options (${confirmedCount} live timetables).${fastestText}`);

  } catch (err) {
    console.error('[App] Routing computation failed:', err);
    setLoading(false);
    showToast(`Error: ${err.message}`);
  } finally {
    State.isCalculating = false;
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

  if (UI.btnCloseTappedCard) {
    UI.btnCloseTappedCard.addEventListener('click', hideTappedStopCard);
  }

  // Preset chips
  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      applyPreset(presetKey);
    });
  });

  // Dynamic update of destination name on coordinate input
  const handleDestCoordInput = () => {
    const lat = parseFloat(UI.inputDestLat.value);
    const lon = parseFloat(UI.inputDestLon.value);
    if (isNaN(lat) || isNaN(lon)) return;
    const matched = Object.values(PRESETS).find(
      p => Math.abs(p.dest.lat - lat) < 0.005 && Math.abs(p.dest.lon - lon) < 0.005
    );
    if (matched) {
      if (UI.inputDestName) UI.inputDestName.value = matched.dest.name;
    } else {
      if (UI.inputDestName) UI.inputDestName.value = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
  };
  UI.inputDestLat.addEventListener('input', handleDestCoordInput);
  UI.inputDestLon.addEventListener('input', handleDestCoordInput);

  // Map click to set location (ONLY when input panel is open so browsing stops doesn't move pilot)
  MapManager.onLocationSelected = (lat, lon) => {
    if (UI.inputPanel.classList.contains('is-open')) {
      State.pilot.lat = lat;
      State.pilot.lon = lon;
      syncInputsFromState();
      showToast(`Updated pilot position to ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    }
  };

  // Map background tap: deselect stop and hide details card
  MapManager.onMapBackgroundClick = () => {
    if (!UI.inputPanel.classList.contains('is-open')) {
      hideTappedStopCard();
    }
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
