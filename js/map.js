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

    return this.map;
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
  setDestinationMarker(lat, lon, label = 'Destination') {
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
        <p>${label}</p>
        <p><strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lon.toFixed(5)}</p>
      </div>
    `);
  },

  /**
   * Renders candidate stop markers with numerical & color-coded badges
   */
  renderStops(stops, pilotCoord, destCoord, onStopClick, shouldFitBounds = false) {
    this.linesLayer.clearLayers();
    this.stopMarkers = {};
    this.flightLines = {};

    this.markersLayer.eachLayer(layer => {
      if (layer !== this.pilotMarker && layer !== this.destMarker) {
        this.markersLayer.removeLayer(layer);
      }
    });

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

      // Mobile-friendly ultra-compact marker: color-coded Time (dep -> arr) + color-coded Glide only
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
        iconSize: [140, 30],
        iconAnchor: [70, 30],
      });

      const marker = L.marker([stop.lat, stop.lon], {
        icon: stopIcon,
        zIndexOffset: isSelected ? 1200 : (500 - index),
        riseOnHover: true,
      });
      marker._stopId = stop.id;

      // Click / tap handler: DO NOT show duplicate popup on map. Only notify onStopClick to show bottom card!
      const triggerSelect = (e) => {
        if (e && e.originalEvent) {
          L.DomEvent.stopPropagation(e.originalEvent);
        } else if (e) {
          L.DomEvent.stopPropagation(e);
        }
        if (typeof onStopClick === 'function') {
          onStopClick(stop, rank);
        }
      };

      marker.on('click', triggerSelect);
      marker.addTo(this.markersLayer);

      const el = marker.getElement();
      if (el) {
        L.DomEvent.on(el, 'click', triggerSelect);
      }

      this.stopMarkers[stop.id] = marker;

      // Draw flight glide line from pilot to stop (interactive: false so line never blocks taps)
      const lineColor = stop.feasibility.color;
      const polyline = L.polyline(
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
