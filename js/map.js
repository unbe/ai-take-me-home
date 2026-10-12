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

  init(containerId = 'map') {
    if (this.map) return this.map;

    // Default center (Alps paragliding hub: Interlaken)
    this.map = L.map(containerId, {
      zoomControl: false, // We'll position zoom control carefully for mobile
    }).setView([46.6863, 7.8632], 12);

    // Zoom control in top right so it doesn't collide with bottom drawer
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Base Layers
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });

    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
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

    // Map click handler for setting locations
    this.map.on('click', (e) => {
      if (typeof this.onLocationSelected === 'function') {
        this.onLocationSelected(e.latlng.lat, e.latlng.lng);
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
  renderStops(stops, pilotCoord, destCoord, onStopClick) {
    // Clear existing candidate markers & lines while remembering any currently open popup
    let openStopId = null;
    this.linesLayer.clearLayers();
    this.markersLayer.eachLayer(layer => {
      if (layer !== this.pilotMarker && layer !== this.destMarker) {
        if (typeof layer.isPopupOpen === 'function' && layer.isPopupOpen() && layer._stopId) {
          openStopId = layer._stopId;
        }
        this.markersLayer.removeLayer(layer);
      }
    });

    // Determine speed tier relative to confirmed timetable options
    const confirmedStops = stops.filter(s => s.transit && s.transit.hasSchedule && isFinite(s.totalTripMinutes));
    const minTripMin = confirmedStops.length > 0 ? confirmedStops[0].totalTripMinutes : Infinity;

    stops.forEach((stop, index) => {
      const rank = index + 1;
      const isReachable = stop.feasibility.status === 'reachable';
      const isMarginal = stop.feasibility.status === 'marginal';
      
      const badgeColorClass = stop.feasibility.badgeClass;
      // 1. Time value & color class
      const hasLiveSchedule = stop.transit && stop.transit.hasSchedule;
      const isQuerying = !!stop.isQuerying;
      const totalTimeText = (hasLiveSchedule && isFinite(stop.totalTripMinutes))
        ? Geo.formatDurationMinutes(stop.totalTripMinutes)
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
      const glideText = stop.glideRatio !== null ? `${stop.glideRatio}:1` : 'N/A';

      let glideClass = 'glide-reachable';
      if (stop.feasibility.status === 'reachable') {
        glideClass = 'glide-reachable';
      } else if (stop.feasibility.status === 'marginal') {
        glideClass = 'glide-marginal';
      } else {
        glideClass = 'glide-unreachable';
      }

      const depText = hasLiveSchedule
        ? Geo.formatTime(stop.transit?.departureTime)
        : (isQuerying ? 'Querying...' : (stop.transit ? 'None scheduled' : 'Pending query...'));

      const transitText = hasLiveSchedule
        ? Geo.formatDurationMinutes(stop.transit?.transitDurationMinutes)
        : (isQuerying ? 'Querying...' : (stop.transit ? 'No timetable' : 'Pending...'));

      const totalTravelText = (hasLiveSchedule && isFinite(stop.totalTripMinutes))
        ? `${totalTimeText} (Arr ${Geo.formatTime(stop.transit?.arrivalTime)})`
        : (isQuerying ? 'Querying timetable...' : (stop.transit ? 'No route scheduled' : 'Timetable pending...'));

      const legsSummary = hasLiveSchedule
        ? (stop.transit?.summary || 'Transit route')
        : (stop.transit?.summary || 'Timetable query pending');

      const isBest = index === 0 && hasLiveSchedule && isFinite(stop.totalTripMinutes);

      // Mobile-friendly ultra-compact marker: color-coded Time + color-coded Glide only
      const markerHtml = `
        <div class="stop-pill-marker ${isBest ? 'is-best' : ''}" title="${stop.name}: ${totalTimeText}, Glide ${glidePillText}">
          <div class="stop-pill-capsule">
            <span class="pill-seg pill-time ${timeClass}">${totalTimeText}</span>
            <span class="pill-seg pill-glide ${glideClass}">${glidePillText}</span>
          </div>
          <div class="stop-pill-pin"></div>
          <div class="stop-pill-dot"></div>
        </div>
      `;

      const stopIcon = L.divIcon({
        className: 'custom-stop-marker-container',
        html: markerHtml,
        iconSize: [80, 30],
        iconAnchor: [40, 30],
        popupAnchor: [0, -30],
      });

      const marker = L.marker([stop.lat, stop.lon], { icon: stopIcon, zIndexOffset: 500 - index });
      marker._stopId = stop.id;

      // Click / tap callback: open popup and highlight in list
      marker.on('click', () => {
        marker.openPopup();
        if (typeof onStopClick === 'function') onStopClick(stop, index);
      });

      // Rich popup showing everything known so far
      const popupHtml = `
        <div class="popup-card">
          <div class="popup-header ${badgeColorClass}">
            <span class="popup-rank">#${rank}</span>
            <span class="popup-name">${stop.icon} ${stop.name}</span>
          </div>
          <div class="popup-body">
            <div class="popup-row">
              <span>Feasibility:</span>
              <strong style="color: ${stop.feasibility.color}">${stop.feasibility.label}</strong>
            </div>
            <div class="popup-row">
              <span>Glide Ratio (L/D):</span>
              <strong>${glideText}</strong>
            </div>
            <div class="popup-row">
              <span>Distance & Drop:</span>
              <span>${Geo.formatDistance(stop.distKm)} | -${stop.altDropM}m</span>
            </div>
            <div class="popup-row">
              <span>Time to reach stop:</span>
              <strong>${Geo.formatDurationMinutes(stop.reachTimeMinutes)}</strong>
            </div>
            <div class="popup-row">
              <span>Transit Departure:</span>
              <strong>${depText}</strong>
            </div>
            <div class="popup-row">
              <span>Transit Duration:</span>
              <strong>${transitText}</strong>
            </div>
            ${hasLiveSchedule && stop.transit?.waitAtStopMinutes >= 60 ? `
            <div class="popup-row" style="color: var(--accent-amber);">
              <span>Wait at stop:</span>
              <strong>${Geo.formatDurationMinutes(stop.transit.waitAtStopMinutes)}</strong>
            </div>` : ''}
            <div class="popup-row highlight">
              <span>Total Travel:</span>
              <strong>${totalTravelText}</strong>
            </div>
            <div class="popup-legs">
              <small>${legsSummary}</small>
            </div>
            <div class="popup-links-row">
              <a class="card-link-btn gmaps" href="${Geo.getGoogleMapsUrl(stop.lat, stop.lon, destCoord.lat, destCoord.lon)}" target="_blank" rel="noopener">
                <span>🗺️ Google Maps</span>
              </a>
              <a class="card-link-btn sbb-app" href="${Geo.getSbbMobileUrl(stop.name, destCoord.name || `${destCoord.lat.toFixed(4)},${destCoord.lon.toFixed(4)}`)}">
                <span>📱 SBB App</span>
              </a>
              <a class="card-link-btn sbb" href="${Geo.getSbbWebUrl(stop, destCoord, stop.transit?.departureTime || stop.targetDepartureDate)}" target="_blank" rel="noopener">
                <span>🚆 SBB Web</span>
              </a>
            </div>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, { autoPan: openStopId !== stop.id });
      marker.addTo(this.markersLayer);

      if (openStopId === stop.id) {
        marker.openPopup();
      }

      // Draw flight glide line from pilot to stop
      const lineColor = stop.feasibility.color;
      const flightLine = L.polyline(
        [[pilotCoord.lat, pilotCoord.lon], [stop.lat, stop.lon]],
        {
          color: lineColor,
          weight: rank === 1 ? 4 : 2.5,
          opacity: 0.85,
          dashArray: isReachable ? null : '6, 6',
        }
      ).addTo(this.linesLayer);

      flightLine.bindTooltip(`${stop.name}: L/D ${glideText}`, { sticky: true });
    });

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
  },

  /**
   * Pan to specific stop and open popup
   */
  focusStop(lat, lon) {
    this.map.setView([lat, lon], 14, { animate: true });
  },
};
