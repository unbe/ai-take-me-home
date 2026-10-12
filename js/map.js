/**
 * map.js - Leaflet map manager with high-visibility markers, numerical badges, and flight corridors
 */
import { Geo } from './geo.js';

export const MapManager = {
  map: null,
  markersLayer: null,
  linesLayer: null,
  pilotMarker: null,
  destMarker: null,
  onLocationSelected: null,
  onMapBackgroundClick: null,
  onSetPilotPosition: null,
  onSetDestination: null,
  stopMarkers: {},
  flightLines: {},
  selectedStopId: null,

  init(containerId = 'map') {
    if (this.map) return this.map;

    // Default center (Alps paragliding hub: Interlaken)
    this.map = L.map(containerId, {
      zoomControl: false, // We'll position zoom control carefully for mobile
    }).setView([46.6863, 7.8632], 12);

    // Zoom control in top right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Base Layers
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });

    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; OpenTopoMap contributors',
    });

    // Mapterhorn Hillshade Layer (GPU-rendered Terrarium DEM)
    let mapterhornLayer = null;
    if (typeof L.maplibreGL === 'function') {
      try {
        mapterhornLayer = L.maplibreGL({
          style: {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap contributors | Terrain: <a href="https://mapterhorn.com" target="_blank">Mapterhorn</a>',
              },
              mapterhornDem: {
                type: 'raster-dem',
                url: 'https://tiles.mapterhorn.com/tilejson.json',
                encoding: 'terrarium',
                tileSize: 512,
              },
            },
            layers: [
              {
                id: 'osm-base',
                type: 'raster',
                source: 'osm',
              },
              {
                id: 'mapterhorn-hillshade',
                type: 'hillshade',
                source: 'mapterhornDem',
                paint: {
                  'hillshade-exaggeration': 0.75,
                  'hillshade-shadow-color': '#111827',
                  'hillshade-highlight-color': '#ffffff',
                  'hillshade-accent-color': '#374151',
                },
              },
            ],
          },
        });
      } catch (err) {
        console.warn('Could not initialize Mapterhorn layer:', err);
      }
    }

    const baseLayers = {};
    if (mapterhornLayer) {
      mapterhornLayer.addTo(this.map);
      baseLayers['🏔️ Mapterhorn Terrain'] = mapterhornLayer;
      baseLayers['Standard OSM'] = osmLayer;
      baseLayers['OpenTopoMap'] = topoLayer;
    } else {
      osmLayer.addTo(this.map);
      baseLayers['Standard OSM'] = osmLayer;
      baseLayers['OpenTopoMap'] = topoLayer;
    }

    // Layer switcher in top-right
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);
    this.linesLayer = L.layerGroup().addTo(this.map);

    // Map click handler
    this.map.on('click', (e) => {
      if (typeof this.onLocationSelected === 'function') {
        this.onLocationSelected(e.latlng.lat, e.latlng.lng);
      }
      if (typeof this.onMapBackgroundClick === 'function') {
        this.onMapBackgroundClick();
      }
    });

    // Map contextmenu handler (long press on mobile / right-click on desktop)
    this.map.on('contextmenu', (e) => {
      if (e.originalEvent) {
        L.DomEvent.preventDefault(e.originalEvent);
      }
      this.showContextMenuPopup(e.latlng.lat, e.latlng.lng);
    });

    return this.map;
  },

  /**
   * Opens popup with options to set pilot position or destination
   */
  showContextMenuPopup(lat, lon) {
    const content = document.createElement('div');
    content.className = 'long-press-menu';
    content.innerHTML = `
      <div class="long-press-title">📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
      <div class="long-press-actions">
        <button class="long-press-btn btn-pilot" id="lp-btn-pilot" type="button">
          <span class="lp-icon">🪂</span>
          <span class="lp-label">Set Pilot Position</span>
        </button>
        <button class="long-press-btn btn-dest" id="lp-btn-dest" type="button">
          <span class="lp-icon">🏁</span>
          <span class="lp-label">Set Destination</span>
        </button>
      </div>
    `;

    const popup = L.popup({
      className: 'long-press-popup',
      closeButton: true,
      autoClose: true,
      closeOnClick: true,
      offset: [0, -5],
    })
      .setLatLng([lat, lon])
      .setContent(content)
      .openOn(this.map);

    const btnPilot = content.querySelector('#lp-btn-pilot');
    const btnDest = content.querySelector('#lp-btn-dest');

    if (btnPilot) {
      btnPilot.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.map.closePopup(popup);
        if (typeof this.onSetPilotPosition === 'function') {
          this.onSetPilotPosition(lat, lon);
        }
      });
    }

    if (btnDest) {
      btnDest.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.map.closePopup(popup);
        if (typeof this.onSetDestination === 'function') {
          this.onSetDestination(lat, lon);
        }
      });
    }
  },

  /**
   * Updates Pilot marker
   */
  setPilotMarker(lat, lon, altM) {
    if (this.pilotMarker) {
      this.markersLayer.removeLayer(this.pilotMarker);
    }

    const html = `
      <div class="pilot-pin">
        <div class="pilot-pin-icon">🪂</div>
        <div class="pilot-pin-alt">${Math.round(altM)}m</div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'custom-pilot-marker',
      html,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    this.pilotMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(this.markersLayer);
    this.pilotMarker.bindPopup(`
      <div class="popup-card">
        <h4>🪂 Pilot Position</h4>
        <p><strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lon.toFixed(5)}</p>
        <p><strong>Altitude:</strong> ${Math.round(altM)} m MSL</p>
      </div>
    `);
  },

  /**
   * Updates Destination marker
   */
  setDestinationMarker(lat, lon) {
    if (this.destMarker) {
      this.markersLayer.removeLayer(this.destMarker);
    }

    const html = `
      <div class="dest-pin">
        <div class="dest-pin-icon">🏁</div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'custom-dest-marker',
      html,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });

    this.destMarker = L.marker([lat, lon], { icon, zIndexOffset: 900 }).addTo(this.markersLayer);
    this.destMarker.bindPopup(`
      <div class="popup-card">
        <h4>🏁 Destination</h4>
        <p><strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lon.toFixed(5)}</p>
      </div>
    `);
  },

  /**
   * Clears all candidate stop markers and flight lines
   */
  clearStops() {
    this.linesLayer.clearLayers();
    this.flightLines = {};
    for (const [id, marker] of Object.entries(this.stopMarkers)) {
      this.markersLayer.removeLayer(marker);
    }
    this.stopMarkers = {};
  },

  /**
   * Renders candidate stop markers with numerical & color-coded badges.
   * Updates existing markers and flight lines in-place to prevent blinking during progressive streaming!
   */
  renderStops(stops, pilotCoord, destCoord, onStopClick, shouldFitBounds = false) {
    const currentStopIds = new Set(stops.map(s => String(s.id)));

    // Remove any markers that are no longer part of current stops
    for (const [id, marker] of Object.entries(this.stopMarkers)) {
      if (!currentStopIds.has(String(id))) {
        this.markersLayer.removeLayer(marker);
        delete this.stopMarkers[id];
      }
    }

    // Remove any flight lines that are no longer part of current stops
    for (const [id, line] of Object.entries(this.flightLines)) {
      if (!currentStopIds.has(String(id))) {
        this.linesLayer.removeLayer(line);
        delete this.flightLines[id];
      }
    }

    // Determine speed tier relative to confirmed timetable options
    const confirmedStops = stops.filter(s => s.transit && s.transit.hasSchedule && isFinite(s.totalTripMinutes));
    const minTripMin = confirmedStops.length > 0 ? confirmedStops[0].totalTripMinutes : Infinity;

    stops.forEach((stop, index) => {
      const rank = index + 1;
      const isReachable = stop.feasibility.status === 'reachable';
      const hasLiveSchedule = stop.transit && stop.transit.hasSchedule;
      const isQuerying = !!stop.isQuerying;

      // 1. Time string: departure -> arrival time, e.g. "12:44 -> 14:23"
      const depTime = Geo.formatTime(stop.transit?.departureTime);
      const arrTime = Geo.formatTime(stop.transit?.arrivalTime);
      const timePillText = (hasLiveSchedule && depTime && arrTime)
        ? `${depTime} -> ${arrTime}`
        : (isQuerying ? '...' : '--');

      const tripMin = (hasLiveSchedule && isFinite(stop.totalTripMinutes)) ? stop.totalTripMinutes : Infinity;
      const timeDiff = (isFinite(tripMin) && isFinite(minTripMin)) ? tripMin - minTripMin : Infinity;

      let timeClass = 'time-none';
      if (!hasLiveSchedule || !isFinite(stop.totalTripMinutes)) {
        timeClass = isQuerying ? 'time-querying' : 'time-none';
      } else if (index === 0 || timeDiff <= 10) {
        timeClass = 'time-fastest';
      } else if (timeDiff <= 30) {
        timeClass = 'time-fast';
      } else if (timeDiff <= 60) {
        timeClass = 'time-moderate';
      } else {
        timeClass = 'time-slow';
      }

      // 2. Glide value & color class
      const glidePillText = stop.glideRatio !== null
        ? `${stop.glideRatio}:1`
        : (stop.isUphill ? 'UP' : '--');

      let glideClass = 'glide-reachable';
      if (stop.feasibility.status === 'reachable') {
        glideClass = 'glide-reachable';
      } else if (stop.feasibility.status === 'marginal') {
        glideClass = 'glide-marginal';
      } else {
        glideClass = 'glide-unreachable';
      }

      const isBest = index === 0 && hasLiveSchedule && isFinite(stop.totalTripMinutes);
      const isSelected = String(this.selectedStopId) === String(stop.id);

      let marker = this.stopMarkers[stop.id];
      if (marker) {
        // UPDATE EXISTING MARKER IN-PLACE (No DOM destroy/recreate -> Zero blinking!)
        marker._stopData = stop;
        marker._stopRank = rank;
        marker.setZIndexOffset(isSelected ? 1200 : (500 - index));
        const el = marker.getElement();
        if (el) {
          const pill = el.querySelector('.stop-pill-marker');
          if (pill) {
            pill.className = `stop-pill-marker ${isBest ? 'is-best' : ''} ${isSelected ? 'is-selected' : ''}`;
            pill.title = `${stop.name}: ${timePillText}, Glide ${glidePillText}`;
            const timeSeg = pill.querySelector('.pill-time');
            if (timeSeg) {
              timeSeg.className = `pill-seg pill-time ${timeClass}`;
              timeSeg.textContent = timePillText;
            }
            const glideSeg = pill.querySelector('.pill-glide');
            if (glideSeg) {
              glideSeg.className = `pill-seg pill-glide ${glideClass}`;
              glideSeg.textContent = glidePillText;
            }
          }
        }
      } else {
        // CREATE NEW MARKER
        const markerHtml = `
          <div class="stop-pill-marker ${isBest ? 'is-best' : ''} ${isSelected ? 'is-selected' : ''}" title="${stop.name}: ${timePillText}, Glide ${glidePillText}">
            <div class="stop-pill-capsule">
              <span class="pill-seg pill-time ${timeClass}">${timePillText}</span>
              <span class="pill-seg pill-glide ${glideClass}">${glidePillText}</span>
            </div>
            <div class="stop-pill-pin"></div>
            <div class="stop-pill-dot"></div>
          </div>
        `;

        const stopIcon = L.divIcon({
          className: 'custom-stop-marker-container',
          html: markerHtml,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        marker = L.marker([stop.lat, stop.lon], {
          icon: stopIcon,
          zIndexOffset: isSelected ? 1200 : (500 - index),
          riseOnHover: true,
        });
        marker._stopId = stop.id;
        marker._stopData = stop;
        marker._stopRank = rank;

        const triggerSelect = (e) => {
          if (e && e.originalEvent) {
            L.DomEvent.stopPropagation(e.originalEvent);
          } else if (e) {
            L.DomEvent.stopPropagation(e);
          }
          if (typeof onStopClick === 'function') {
            onStopClick(marker._stopData || stop, marker._stopRank || rank);
          }
        };

        marker.on('click', triggerSelect);
        marker.addTo(this.markersLayer);

        const el = marker.getElement();
        if (el) {
          L.DomEvent.on(el, 'click', triggerSelect);
        }

        this.stopMarkers[stop.id] = marker;
      }

      // FLIGHT GLIDE LINE: UPDATE IN-PLACE OR CREATE
      const lineColor = stop.feasibility.color;
      let polyline = this.flightLines[stop.id];
      if (polyline) {
        polyline._defaultColor = lineColor;
        polyline._defaultWeight = rank === 1 ? 4 : 2.5;
        polyline._defaultDashArray = isReachable ? null : '6, 6';
        if (!this.selectedStopId) {
          polyline.setStyle({
            color: lineColor,
            weight: rank === 1 ? 4 : 2.5,
            opacity: 0.85,
            dashArray: isReachable ? null : '6, 6',
          });
        } else if (isSelected) {
          polyline.setStyle({
            color: '#38bdf8',
            weight: 5.5,
            opacity: 1.0,
            dashArray: null,
          });
          polyline.bringToFront();
        } else {
          polyline.setStyle({
            color: lineColor,
            weight: 1.8,
            opacity: 0.25,
            dashArray: isReachable ? null : '6, 6',
          });
        }
      } else {
        polyline = L.polyline(
          [[pilotCoord.lat, pilotCoord.lon], [stop.lat, stop.lon]],
          {
            color: isSelected ? '#38bdf8' : lineColor,
            weight: isSelected ? 5.5 : (rank === 1 ? 4 : 2.5),
            opacity: isSelected ? 1.0 : (this.selectedStopId ? 0.25 : 0.85),
            dashArray: isReachable ? null : '6, 6',
            interactive: false,
          }
        );
        polyline._defaultColor = lineColor;
        polyline._defaultWeight = rank === 1 ? 4 : 2.5;
        polyline._defaultOpacity = 0.85;
        polyline._defaultDashArray = isReachable ? null : '6, 6';
        polyline.addTo(this.linesLayer);

        if (isSelected) {
          polyline.bringToFront();
        }

        this.flightLines[stop.id] = polyline;
      }
    });

    if (shouldFitBounds) {
      // Calculate flight bounds focusing on pilot and all stops within 15 km
      const flightBounds = L.latLngBounds([[pilotCoord.lat, pilotCoord.lon]]);
      const stopsWithin15Km = stops.filter(s => s.distKm <= 15);

      if (stopsWithin15Km.length > 0) {
        stopsWithin15Km.forEach(s => flightBounds.extend([s.lat, s.lon]));
      } else {
        // Fallback: if all stops happen to be farther, include closest 5
        stops.slice(0, 5).forEach(s => flightBounds.extend([s.lat, s.lon]));
      }

      // Zoom to fit all stops within 15km
      this.map.fitBounds(flightBounds, { padding: [40, 40], maxZoom: 15 });
    }
  },

  /**
   * Highlights the selected stop marker and flight line, dimming others
   */
  selectStop(stopId) {
    this.selectedStopId = stopId;
    this.updateSelectionStyles();
  },

  /**
   * Clears stop and flight line selection
   */
  clearSelection() {
    this.selectedStopId = null;
    this.updateSelectionStyles();
  },

  /**
   * Updates CSS and line styles according to currently selected stop
   */
  updateSelectionStyles() {
    // Update markers
    for (const [id, marker] of Object.entries(this.stopMarkers)) {
      const isSelected = (String(id) === String(this.selectedStopId));
      marker.setZIndexOffset(isSelected ? 1200 : 500);
      const el = marker.getElement();
      if (el) {
        const markerDiv = el.querySelector('.stop-pill-marker');
        if (markerDiv) {
          if (isSelected) {
            markerDiv.classList.add('is-selected');
          } else {
            markerDiv.classList.remove('is-selected');
          }
        }
      }
    }

    // Update flight lines
    for (const [id, line] of Object.entries(this.flightLines)) {
      const isSelected = (String(id) === String(this.selectedStopId));
      if (!this.selectedStopId) {
        // Reset to original styling
        line.setStyle({
          color: line._defaultColor,
          weight: line._defaultWeight,
          opacity: line._defaultOpacity,
          dashArray: line._defaultDashArray,
        });
      } else if (isSelected) {
        // Highlight active line
        line.setStyle({
          color: '#38bdf8',
          weight: 5.5,
          opacity: 1.0,
          dashArray: null,
        });
        line.bringToFront();
      } else {
        // Dim other lines
        line.setStyle({
          color: line._defaultColor,
          weight: 1.8,
          opacity: 0.25,
          dashArray: line._defaultDashArray,
        });
      }
    }
  },

  /**
   * Pan to specific stop
   */
  focusStop(lat, lon) {
    this.map.setView([lat, lon], 14, { animate: true });
  },
};
