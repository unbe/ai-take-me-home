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
    address: null,
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

// UI Elements
const UI = {
  mapContainer: document.getElementById('map'),
  inputPanel: document.getElementById('input-panel'),
  btnOpenInputs: document.getElementById('btn-open-inputs'),
  btnCloseInputs: document.getElementById('btn-close-inputs'),
  btnCalculate: document.getElementById('btn-calculate'),
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
 * Update browser URL search params to reflect state for bookmarking
 */
function updateUrlFromState() {
  const params = new URLSearchParams();

  // Pilot position & altitude
  if (isFinite(State.pilot.lat)) params.set('lat', State.pilot.lat.toFixed(5));
  if (isFinite(State.pilot.lon)) params.set('lon', State.pilot.lon.toFixed(5));
  if (isFinite(State.pilot.altM)) params.set('alt', Math.round(State.pilot.altM));

  // Destination coordinates
  if (isFinite(State.destination.lat)) params.set('destLat', State.destination.lat.toFixed(5));
  if (isFinite(State.destination.lon)) params.set('destLon', State.destination.lon.toFixed(5));
  params.delete('destName');

  // Settings from settings panel
  params.set('radius', State.settings.searchRadiusKm);
  params.set('stops', State.settings.stopsCount);
  params.set('speed', State.settings.speedKmH);
  params.set('buffer', State.settings.bufferMinutes);
  params.set('glide', State.settings.maxGlideRatio);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', newUrl);
}

/**
 * Read state from URL search params (or hash) for bookmarking / deep-linking
 */
function parseStateFromUrl() {
  const params = new URLSearchParams(window.location.search || window.location.hash.replace(/^#\??/, ''));
  let pilotSetInUrl = false;

  // Pilot position & altitude
  const lat = params.get('lat') || params.get('pilotLat');
  const lon = params.get('lon') || params.get('lng') || params.get('pilotLon');
  const alt = params.get('alt') || params.get('pilotAlt');

  if (lat !== null && lon !== null) {
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
      State.pilot.lat = parsedLat;
      State.pilot.lon = parsedLon;
      pilotSetInUrl = true;
    }
  }

  if (alt !== null) {
    const parsedAlt = parseFloat(alt);
    if (!isNaN(parsedAlt)) {
      State.pilot.altM = Math.round(parsedAlt);
      pilotSetInUrl = true;
    }
  }

  // Destination coordinates
  const destLat = params.get('destLat') || params.get('dest_lat');
  const destLon = params.get('destLon') || params.get('dest_lon') || params.get('destLng');

  if (destLat !== null && destLon !== null) {
    const parsedDestLat = parseFloat(destLat);
    const parsedDestLon = parseFloat(destLon);
    if (!isNaN(parsedDestLat) && !isNaN(parsedDestLon)) {
      State.destination.lat = parsedDestLat;
      State.destination.lon = parsedDestLon;
    }
  }

  // Settings from settings panel
  if (params.has('radius')) {
    const r = parseFloat(params.get('radius'));
    if (!isNaN(r) && r > 0) State.settings.searchRadiusKm = r;
  }
  if (params.has('stops')) {
    const s = parseInt(params.get('stops'), 10);
    if (!isNaN(s) && s > 0) State.settings.stopsCount = s;
  }
  if (params.has('speed')) {
    const sp = parseFloat(params.get('speed'));
    if (!isNaN(sp) && sp > 0) State.settings.speedKmH = sp;
  }
  if (params.has('buffer')) {
    const b = parseFloat(params.get('buffer'));
    if (!isNaN(b) && b >= 0) State.settings.bufferMinutes = b;
  }
  if (params.has('glide')) {
    const g = parseFloat(params.get('glide'));
    if (!isNaN(g) && g > 0) State.settings.maxGlideRatio = g;
  }

  return { pilotSetInUrl };
}

/**
 * Sync UI input fields with internal state
 */
function syncInputsFromState() {
  if (UI.inputStopsCount) UI.inputStopsCount.value = State.settings.stopsCount;
  if (UI.inputSearchRadius) UI.inputSearchRadius.value = State.settings.searchRadiusKm;
  if (UI.inputSpeed) UI.inputSpeed.value = State.settings.speedKmH;
  if (UI.inputBuffer) UI.inputBuffer.value = State.settings.bufferMinutes;
  if (UI.inputGlideThreshold) UI.inputGlideThreshold.value = State.settings.maxGlideRatio;

  // Header chip
  if (UI.chipPilotText) {
    UI.chipPilotText.textContent = `${Math.round(State.pilot.altM)}m (${State.pilot.lat.toFixed(2)}, ${State.pilot.lon.toFixed(2)})`;
  }
  if (UI.chipDestText) {
    UI.chipDestText.textContent = `${State.destination.lat.toFixed(2)}, ${State.destination.lon.toFixed(2)}`;
  }
}

/**
 * Sync internal state from UI inputs
 */
function syncStateFromInputs() {
  if (UI.inputStopsCount) State.settings.stopsCount = parseInt(UI.inputStopsCount.value, 10) || 15;
  if (UI.inputSearchRadius) State.settings.searchRadiusKm = parseFloat(UI.inputSearchRadius.value) || 8;
  if (UI.inputSpeed) State.settings.speedKmH = parseFloat(UI.inputSpeed.value) || 30;
  if (UI.inputBuffer) State.settings.bufferMinutes = parseFloat(UI.inputBuffer.value) || 30;
  if (UI.inputGlideThreshold) State.settings.maxGlideRatio = parseFloat(UI.inputGlideThreshold.value) || 8.0;

  syncInputsFromState();
  updateUrlFromState();
}

/**
 * Geocodes destination coordinates into a street/postal address for SBB journey planning
 */
async function updateDestinationAddress() {
  const { lat, lon } = State.destination;
  if (!isFinite(lat) || !isFinite(lon)) return;
  try {
    const address = await Geo.geocodeCoordinatesToAddress(lat, lon);
    if (address) {
      State.destination.address = address;
      if (currentlyTappedStop) {
        showTappedStopCard(currentlyTappedStop, currentlyTappedRank);
      }
    }
  } catch (err) {
    console.warn('[App] Destination address geocoding failed:', err);
  }
}

/**
 * Geolocation GPS handler
 */
function useCurrentLocation(onFailure = null) {
  if (!navigator.geolocation) {
    if (typeof onFailure === 'function') {
      onFailure();
    } else {
      showToast('Geolocation is not supported by your browser');
    }
    return;
  }

  showToast('Acquiring 3D GPS fix & altitude...');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      State.pilot.lat = pos.coords.latitude;
      State.pilot.lon = pos.coords.longitude;

      // Center map around pilot position first
      MapManager.centerOnPilot(State.pilot.lat, State.pilot.lon);
      MapManager.setPilotMarker(State.pilot.lat, State.pilot.lon, State.pilot.altM);

      let altSource = 'GPS 3D';
      if (pos.coords.altitude !== null && pos.coords.altitude !== undefined && !isNaN(pos.coords.altitude)) {
        State.pilot.altM = Math.round(pos.coords.altitude);
      } else {
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
      updateUrlFromState();
      showToast(`📍 GPS: ${State.pilot.lat.toFixed(4)}, ${State.pilot.lon.toFixed(4)} | Alt: ${State.pilot.altM}m (${altSource})`, 4000);
      calculateRoutes();
    },
    (err) => {
      console.warn('Geolocation error:', err);
      if (typeof onFailure === 'function') {
        onFailure();
      } else {
        showToast(`GPS Error: ${err.message}`);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
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
  // Google Maps accepts coordinates natively
  UI.tappedLinkGmaps.href = Geo.getGoogleMapsUrl(stop.lat, stop.lon, State.destination.lat, State.destination.lon);

  // SBB links: source is the stop name, destination is the geocoded address
  const destAddress = State.destination.address || '';
  const depTime = stop.transit?.departureTime || stop.targetDepartureDate;
  UI.tappedLinkSbbApp.href = Geo.getSbbMobileUrl(stop.name, destAddress);
  UI.tappedLinkSbbWeb.href = Geo.getSbbWebUrl(stop.name, destAddress, depTime);

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
 * Active calculation abort controller and sequence tracking
 */
let currentCalculationController = null;
let currentCalculationId = 0;

export function abortActiveCalculation() {
  if (currentCalculationController) {
    console.log('[App] Aborting active calculation...');
    currentCalculationController.abort();
    currentCalculationController = null;
  }
}

/**
 * Core Algorithm: Search stops, compute glide ratios, and query public transit
 */
async function calculateRoutes(options = {}) {
  // Abort any ongoing calculation immediately and restart with the latest parameters
  abortActiveCalculation();

  const calcId = ++currentCalculationId;
  const abortController = new AbortController();
  currentCalculationController = abortController;
  const signal = abortController.signal;

  State.isCalculating = true;

  syncStateFromInputs();
  closeInputPanel();
  hideTappedStopCard();

  const { pilot, destination, settings } = State;

  // 1. Update map pins and center map around pilot position FIRST before querying
  MapManager.setPilotMarker(pilot.lat, pilot.lon, pilot.altM);
  MapManager.setDestinationMarker(destination.lat, destination.lon);
  MapManager.centerOnPilot(pilot.lat, pilot.lon);
  MapManager.clearStops();

  if (!destination.address) {
    updateDestinationAddress();
  }

  try {
    // If pilot elevation needs to be updated (e.g. from setting pilot position via map contextmenu)
    if (options.updatePilotElevation) {
      try {
        const elevs = await Elevation.getBatchElevations([{ lat: pilot.lat, lon: pilot.lon }], signal);
        if (signal.aborted || calcId !== currentCalculationId) return;
        if (elevs && elevs.length > 0 && typeof elevs[0] === 'number') {
          const groundAlt = Math.round(elevs[0]);
          if (State.pilot.altM < groundAlt) {
            State.pilot.altM = groundAlt + 300;
            MapManager.setPilotMarker(pilot.lat, pilot.lon, State.pilot.altM);
            syncInputsFromState();
            updateUrlFromState();
          }
        }
      } catch (e) {
        if (signal.aborted || calcId !== currentCalculationId) return;
        console.warn('Could not query terrain elevation for pilot position:', e);
      }
    }

    if (signal.aborted || calcId !== currentCalculationId) return;

    // 2. Discover nearest stops via Overpass API with Adaptive Glide Ratio Radius Expansion:
    // If the stops found within the current radius still have great glide ratios (e.g. <= maxGlideRatio),
    // keep expanding the search radius up to a strict 20km maximum to discover faster transit options.
    const maxSearchRadiusM = Math.min(settings.searchRadiusKm * 1000, 20000);
    setLoading(true, `Querying stops (expanding up to 20km if glide ratio is great)...`);

    const shouldContinueExpanding = async (currentStops, currentRadiusM) => {
      if (signal.aborted || calcId !== currentCalculationId) return false;
      if (currentRadiusM >= 20000) return false;

      // Check elevation and glide ratio for candidate stops found so far
      await Elevation.populateStopElevations(currentStops, signal);
      if (signal.aborted || calcId !== currentCalculationId) return false;

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
      shouldContinueExpanding,
      signal
    );

    if (signal.aborted || calcId !== currentCalculationId) return;

    // 3. Batch elevation lookup via Open-Meteo API
    setLoading(true, `Fetching terrain elevations for ${stops.length} candidate stops...`);
    await Elevation.populateStopElevations(stops, signal);

    if (signal.aborted || calcId !== currentCalculationId) return;

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

    if (signal.aborted || calcId !== currentCalculationId) return;

    // 4b. PROGRESSIVE RENDER 1: Display all candidate stops immediately!
    State.stops = stops;
    MapManager.renderStops(stops, pilot, destination, (clickedStop, rank) => {
      showTappedStopCard(clickedStop, rank);
    }, true); // shouldFitBounds = true only on initial candidate render

    // 5. Query public transit strictly sequentially (1 request at a time)
    // Whenever a stop is shown, always also query the travel time, even if the glide ratio isn't great
    const totalToQuery = stops.length;
    let liveQueriesCount = 0;

    for (let i = 0; i < stops.length; i++) {
      if (signal.aborted || calcId !== currentCalculationId) return;

      const stop = stops[i];
      liveQueriesCount++;
      setLoading(true, `Querying timetable ${liveQueriesCount}/${totalToQuery}: ${stop.name}...`);
      stop.isQuerying = true;
      MapManager.renderStops(stops, pilot, destination, (clickedStop, rank) => {
        showTappedStopCard(clickedStop, rank);
      }, false);

      stop.transit = await Transit.planJourney(stop, destination, stop.targetDepartureDate, 3000, signal);
      if (signal.aborted || calcId !== currentCalculationId) return;

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

    if (signal.aborted || calcId !== currentCalculationId) return;

    setLoading(false);
    const confirmedCount = stops.filter(s => s.transit && s.transit.hasSchedule).length;
    const fastestStop = stops.find(s => s.transit && s.transit.hasSchedule && isFinite(s.totalTripMinutes));
    const fastestText = fastestStop ? ` Fastest: ${Geo.formatDurationMinutes(fastestStop.totalTripMinutes)} (${fastestStop.name})` : '';
    showToast(`Found ${stops.length} options (${confirmedCount} live timetables).${fastestText}`);

  } catch (err) {
    if (signal.aborted || calcId !== currentCalculationId || err.name === 'AbortError') {
      console.log('[App] Calculation superseded/aborted.');
      return;
    }
    console.error('[App] Routing computation failed:', err);
    setLoading(false);
    showToast(`Error: ${err.message}`);
  } finally {
    if (calcId === currentCalculationId) {
      State.isCalculating = false;
      if (currentCalculationController === abortController) {
        currentCalculationController = null;
      }
    }
  }
}

/**
 * Initialize event listeners
 */
function initEvents() {
  UI.btnOpenInputs.addEventListener('click', openInputPanel);
  UI.btnCloseInputs.addEventListener('click', closeInputPanel);
  UI.coordChip.addEventListener('click', openInputPanel);
  UI.btnCalculate.addEventListener('click', () => {
    syncStateFromInputs();
    closeInputPanel();
    calculateRoutes();
  });
  UI.btnGps.addEventListener('click', () => useCurrentLocation());

  if (UI.btnCloseTappedCard) {
    UI.btnCloseTappedCard.addEventListener('click', hideTappedStopCard);
  }

  // Map background tap: deselect stop and hide details card
  MapManager.onMapBackgroundClick = () => {
    if (!UI.inputPanel.classList.contains('is-open')) {
      hideTappedStopCard();
    }
  };

  // Long-press contextmenu actions: Set Pilot Position or Set Destination
  MapManager.onSetPilotPosition = (lat, lon) => {
    closeInputPanel();
    hideTappedStopCard();
    State.pilot.lat = lat;
    State.pilot.lon = lon;
    MapManager.centerOnPilot(lat, lon);
    MapManager.setPilotMarker(lat, lon, State.pilot.altM);
    syncInputsFromState();
    updateUrlFromState();
    showToast(`🪂 Pilot position set to ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    calculateRoutes({ updatePilotElevation: true });
  };

  MapManager.onSetDestination = (lat, lon) => {
    closeInputPanel();
    hideTappedStopCard();
    State.destination.lat = lat;
    State.destination.lon = lon;
    State.destination.address = null;
    updateDestinationAddress();
    syncInputsFromState();
    updateUrlFromState();
    showToast(`🏁 Destination set to ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    calculateRoutes();
  };

  // Browser navigation history support (Back / Forward button)
  window.addEventListener('popstate', () => {
    parseStateFromUrl();
    syncInputsFromState();
    State.destination.address = null;
    updateDestinationAddress();
    calculateRoutes();
  });
}

/**
 * Bootstrap Application
 */
async function init() {
  console.log('[Take Me Home] Initializing application...');

  const { pilotSetInUrl } = parseStateFromUrl();
  syncInputsFromState();
  updateUrlFromState();
  updateDestinationAddress();

  // Center map around pilot position FIRST
  MapManager.init('map', State.pilot.lat, State.pilot.lon, 13);
  MapManager.setPilotMarker(State.pilot.lat, State.pilot.lon, State.pilot.altM);
  MapManager.setDestinationMarker(State.destination.lat, State.destination.lon);
  initEvents();

  if (pilotSetInUrl) {
    // Current position and altitude set in URL -> DO NOT query GPS!
    console.log('[Take Me Home] Pilot position set in URL: skipping automatic GPS query');
    if (!State.pilot.altM || isNaN(State.pilot.altM)) {
      try {
        const elevs = await Elevation.getBatchElevations([{ lat: State.pilot.lat, lon: State.pilot.lon }]);
        if (elevs && elevs.length > 0 && typeof elevs[0] === 'number') {
          State.pilot.altM = Math.round(elevs[0]) + 300;
        }
      } catch (e) {
        console.warn('Could not query terrain elevation for URL coordinates:', e);
      }
      syncInputsFromState();
      updateUrlFromState();
    }
    setTimeout(() => {
      calculateRoutes();
    }, 300);
  } else {
    // Current position not set in URL -> query GPS, falling back to default if unavailable
    useCurrentLocation(() => {
      setTimeout(() => {
        calculateRoutes();
      }, 300);
    });
  }
}

// Kick off when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
