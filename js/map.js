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
    // Clear existing candidate markers & lines
    this.linesLayer.clearLayers();
    this.markersLayer.eachLayer(layer => {
      if (layer !== this.pilotMarker && layer !== this.destMarker) {
        this.markersLayer.removeLayer(layer);
      }
    });

    // Determine speed tier relative to other options (stops are already sorted by totalTripMinutes)
    const minTripMin = stops.length > 0 ? (stops[0].totalTripMinutes || 1) : 1;
    const maxTripMin = stops.length > 0 ? (stops[stops.length - 1].totalTripMinutes || minTripMin) : minTripMin;

    stops.forEach((stop, index) => {
      const rank = index + 1;
      const isReachable = stop.feasibility.status === 'reachable';
      const isMarginal = stop.feasibility.status === 'marginal';
      
      const badgeColorClass = stop.feasibility.badgeClass;
      const glideText = stop.glideRatio !== null ? `${stop.glideRatio}:1` : 'N/A';
      const transitText = Geo.formatDurationMinutes(stop.transit?.transitDurationMinutes);
      const totalTimeText = Geo.formatDurationMinutes(stop.totalTripMinutes);

      // Departure and Arrival times
      const depTime = Geo.formatTime(stop.transit?.departureTime);
      const arrTime = Geo.formatTime(stop.transit?.arrivalTime);

      // Speed color-coding relative to the best option:
      // Fastest tier (top 15% / within 15 min of best): Bright Cyan/Blue #0ea5e9
      // Fast tier (next 35%): Emerald Green #10b981
      // Moderate tier (next 30%): Amber/Yellow #f59e0b
      // Slow tier (slowest 20%): Orange/Red #f97316
      const tripMin = stop.totalTripMinutes || minTripMin;
      const timeDiff = tripMin - minTripMin;
      let speedClass = 'speed-fastest';
      let speedBadgeText = '⚡ FASTEST';

      if (index === 0 || timeDiff <= 10) {
        speedClass = 'speed-fastest';
        speedBadgeText = '⚡ FASTEST';
      } else if (timeDiff <= 30) {
        speedClass = 'speed-fast';
        speedBadgeText = `+${timeDiff}m`;
      } else if (timeDiff <= 60) {
        speedClass = 'speed-moderate';
        speedBadgeText = `+${timeDiff}m`;
      } else {
        speedClass = 'speed-slow';
        speedBadgeText = `+${Geo.formatDurationMinutes(timeDiff)}`;
      }

      // Marker pin pointing exactly to the stop coordinates with the info box placed cleanly next to it
      const displayName = stop.shortName || stop.name;
      const markerHtml = `
        <div class="stop-marker-wrapper ${badgeColorClass} ${speedClass} ${rank === 1 ? 'is-best' : ''}">
          <div class="stop-pin-pointer" title="${stop.name}">
            <div class="stop-pin-dot"></div>
          </div>
          <div class="stop-callout-box">
            <div class="stop-badge-rank-group">
              <span class="stop-badge-rank">#${rank}</span>
              <span class="speed-pill ${speedClass}">${speedBadgeText}</span>
            </div>
            <div class="stop-badge-content">
              <div class="stop-badge-top-row">
                <span class="stop-badge-name" title="${stop.name}">${displayName}</span>
                <span class="stop-badge-glide">📐 ${glideText}</span>
              </div>
              <div class="stop-badge-times-row">
                <span class="badge-time-flow">🕒 ${depTime} ➔ ${arrTime}</span>
                <span class="badge-time-total">(${totalTimeText})</span>
              </div>
            </div>
          </div>
        </div>
      `;

      const stopIcon = L.divIcon({
        className: 'custom-stop-marker-container',
        html: markerHtml,
        iconSize: [260, 44],
        iconAnchor: [7, 7], // Pins the 14x14 dot center exactly to [stop.lat, stop.lon]
      });

      const marker = L.marker([stop.lat, stop.lon], { icon: stopIcon, zIndexOffset: 500 - index });

      // Click callback
      marker.on('click', () => {
        if (typeof onStopClick === 'function') onStopClick(stop, index);
      });

      // Rich popup
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
              <strong>${Geo.formatTime(stop.transit?.departureTime)}</strong>
            </div>
            <div class="popup-row">
              <span>Transit Duration:</span>
              <strong>${transitText}</strong>
            </div>
            <div class="popup-row highlight">
              <span>Total Travel:</span>
              <strong>${totalTimeText} (Arr ${Geo.formatTime(stop.transit?.arrivalTime)})</strong>
            </div>
            <div class="popup-legs">
              <small>${stop.transit?.summary || 'Transit route'}</small>
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

      marker.bindPopup(popupHtml);
      marker.addTo(this.markersLayer);

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
