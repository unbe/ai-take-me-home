/**
 * geo.js - Geodesic, reach time, glide ratio, and navigation computations
 */

export const Geo = {
  EARTH_RADIUS_KM: 6371.0088,

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  },

  /**
   * Convert radians to degrees
   */
  toDegrees(radians) {
    return (radians * 180) / Math.PI;
  },

  /**
   * Haversine formula to compute great-circle distance between two points
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} Distance in kilometers
   */
  haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const phi1 = this.toRadians(lat1);
    const phi2 = this.toRadians(lat2);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return this.EARTH_RADIUS_KM * c;
  },

  /**
   * Calculates initial bearing (direction) in degrees from point 1 to point 2
   */
  bearingDegrees(lat1, lon1, lat2, lon2) {
    const phi1 = this.toRadians(lat1);
    const phi2 = this.toRadians(lat2);
    const dLon = this.toRadians(lon2 - lon1);

    const y = Math.sin(dLon) * Math.cos(phi2);
    const x =
      Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);

    let brng = this.toDegrees(Math.atan2(y, x));
    return (brng + 360) % 360;
  },

  /**
   * Calculates time in minutes to reach a stop.
   * Formula: straight line distance at speedKmH (default 30 km/h) plus bufferMinutes (default 30 min).
   * @param {number} distanceKm Straight-line distance
   * @param {number} speedKmH Travel speed (default 30 km/h)
   * @param {number} bufferMinutes Pack-up / walking buffer (default 30 min)
   * @returns {number} Total reach time in minutes
   */
  calculateReachTimeMinutes(distanceKm, speedKmH = 30, bufferMinutes = 30) {
    const flightMinutes = (distanceKm / speedKmH) * 60;
    return flightMinutes + bufferMinutes;
  },

  /**
   * Computes the Glide Ratio (L/D) from pilot to stop.
   * Glide ratio = horizontal distance (m) / altitude drop (m).
   * @param {number} distanceMeters Horizontal distance in meters
   * @param {number} pilotAltM Pilot altitude in meters MSL
   * @param {number} stopAltM Stop elevation in meters MSL
   * @returns {{ ratio: number|null, altDropM: number, isUphill: boolean }}
   */
  calculateGlideRatio(distanceMeters, pilotAltM, stopAltM) {
    const altDropM = pilotAltM - stopAltM;
    if (altDropM <= 0) {
      return {
        ratio: null, // Impossible or uphill
        altDropM,
        isUphill: true,
      };
    }

    const ratio = distanceMeters / altDropM;
    return {
      ratio: Math.round(ratio * 10) / 10,
      altDropM: Math.round(altDropM),
      isUphill: false,
    };
  },

  /**
   * Evaluates glide feasibility based on ratio and threshold
   * @param {number|null} ratio
   * @param {boolean} isUphill
   * @param {number} okThreshold Default 7.5
   * @param {number} maxThreshold Default 10.0
   * @returns {{ status: 'reachable'|'marginal'|'unreachable', label: string, color: string, badgeClass: string }}
   */
  evaluateFeasibility(ratio, isUphill, okThreshold = 7.5, maxThreshold = 10.0) {
    if (isUphill || ratio === null) {
      return {
        status: 'unreachable',
        label: 'Uphill / Impossible',
        color: '#ef4444', // Red
        badgeClass: 'badge-unreachable',
      };
    }

    if (ratio <= okThreshold) {
      return {
        status: 'reachable',
        label: 'Reachable',
        color: '#10b981', // Green
        badgeClass: 'badge-reachable',
      };
    } else if (ratio <= maxThreshold) {
      return {
        status: 'marginal',
        label: 'Marginal',
        color: '#f59e0b', // Amber/Yellow
        badgeClass: 'badge-marginal',
      };
    } else {
      return {
        status: 'unreachable',
        label: 'Unreachable',
        color: '#ef4444', // Red
        badgeClass: 'badge-unreachable',
      };
    }
  },

  /**
   * Checks whether a stop is physically within the glide horizon (reachable or marginal)
   * @param {Object} stop
   * @returns {boolean}
   */
  isWithinGlide(stop) {
    return !!(stop && stop.feasibility && stop.feasibility.status !== 'unreachable');
  },

  /**
   * Format duration in minutes into clean readable string (e.g. "45m" or "1h 25m")
   */
  formatDurationMinutes(minutes) {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return '--';
    const mins = Math.round(minutes);
    if (mins < 60) {
      return `${mins}m`;
    }
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  },

  /**
   * Format distance nicely
   */
  formatDistance(distanceKm) {
    if (distanceKm < 1) {
      return `${Math.round(distanceKm * 1000)} m`;
    }
    return `${distanceKm.toFixed(1)} km`;
  },

  /**
   * Formats Date to HH:MM in local time
   */
  formatTime(date) {
    if (!date) return '--:--';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  },

  _geocodeCache: new Map(),

  /**
   * Reverse-geocodes coordinates into a street/postal address for SBB journey planning.
   * Primary provider: Swiss transport.opendata.ch (returns precise Swiss street addresses).
   * Fallback provider: OpenStreetMap Nominatim (for general/international coordinates).
   * @param {number} lat
   * @param {number} lon
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async geocodeCoordinatesToAddress(lat, lon, signal = null) {
    if (!isFinite(lat) || !isFinite(lon)) return '';
    const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (this._geocodeCache.has(cacheKey)) {
      return this._geocodeCache.get(cacheKey);
    }

    // Tries providers in order; only a caller abort propagates, other failures fall through
    const providers = [
      () => this._geocodeViaOpendata(lat, lon, signal),
      () => this._geocodeViaNominatim(lat, lon, signal),
    ];
    for (const provider of providers) {
      try {
        const addr = await provider();
        if (addr) {
          this._geocodeCache.set(cacheKey, addr);
          return addr;
        }
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') throw e;
      }
    }
    return '';
  },

  async _geocodeViaOpendata(lat, lon, signal) {
    const url = `https://transport.opendata.ch/v1/locations?x=${lat.toFixed(6)}&y=${lon.toFixed(6)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return '';
    const data = await res.json();
    const stations = (data && Array.isArray(data.stations)) ? data.stations : [];
    // Prefer an address entry (id === null), else the first location name
    const entry = stations.find(s => s && s.id === null && s.name) || stations[0];
    return entry && entry.name ? entry.name.trim() : '';
  },

  async _geocodeViaNominatim(lat, lon, signal) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&format=json`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TakeMeHome/1.0 (https://github.com/artem/take-me-home)',
      },
      signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    const a = data && data.address;
    if (!a) return '';

    const street = [a.road, a.house_number].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.municipality || '';
    const cityPart = [a.postcode, city].filter(Boolean).join(' ');
    const addr = [street, cityPart].filter(Boolean).join(', ');
    return addr || (data.display_name ? data.display_name.trim() : '');
  },

  /**
   * Returns the trimmed name, or '' if it is a raw coordinate pair (SBB does not understand those).
   */
  _sbbPlace(value, keys) {
    const raw = typeof value === 'object' && value
      ? keys.map(k => value[k]).find(Boolean) || ''
      : String(value || '');
    const trimmed = raw.trim();
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(trimmed) ? '' : trimmed;
  },

  /**
   * Generate SBB Web Timetable URL
   * Source: stop name (e.g. "Oberiberg, Wandli")
   * Destination: geocoded street address (e.g. "Kornhausplatz 2, 3011 Bern")
   * Format: https://www.sbb.ch/en?stops=Oberiberg,+Wandli%7EKornhausplatz+2,+3011+Bern&time=00_24
   */
  getSbbWebUrl(from, to, departureDate) {
    const fromName = this._sbbPlace(from, ['name', 'shortName']);
    const toAddress = this._sbbPlace(to, ['address', 'name']);

    const combined = toAddress ? `${fromName}~${toAddress}` : fromName;
    const encodedStops = encodeURIComponent(combined)
      .replace(/%20/g, '+')
      .replace(/~/g, '%7E')
      .replace(/%2C/g, ',');

    let dateTimeParam = '';
    const d = departureDate ? (typeof departureDate === 'string' ? new Date(departureDate) : departureDate) : new Date();
    if (!isNaN(d?.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      dateTimeParam = `&date=${yyyy}-${mm}-${dd}&time=${hh}_${min}`;
    }

    return `https://www.sbb.ch/en?stops=${encodedStops}${dateTimeParam}`;
  },

  /**
   * Generate SBB Mobile App Deep Link (for native iOS / Android SBB Mobile app)
   * Source: stop name, Destination: geocoded address
   * Format: sbbmobile://timetable?from=...&to=...
   */
  getSbbMobileUrl(from, to) {
    const fromName = this._sbbPlace(from, ['name']);
    const toAddress = this._sbbPlace(to, ['address', 'name']);
    return `sbbmobile://timetable?from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toAddress)}`;
  },

  /**
   * Generate Google Maps Transit Directions URL with optional departure timestamp
   */
  getGoogleMapsUrl(originLat, originLon, destLat, destLon, departureDate = null) {
    let depParam = '';
    if (departureDate) {
      const d = typeof departureDate === 'string' ? new Date(departureDate) : departureDate;
      if (!isNaN(d?.getTime())) {
        depParam = `&departure_time=${Math.floor(d.getTime() / 1000)}`;
      }
    }
    return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLon}&destination=${destLat},${destLon}&travelmode=transit${depParam}`;
  },

  /**
   * Prioritizes stops that are further from other stops, preventing redundant schedule queries
   * for clusters of stops within walking distance of each other.
   *
  /**
   * Checks if two transit stops are "similar" stops next to each other that should not both be explored.
   * Prevents exploring duplicate platforms, micro-distance stops on the same intersection/square (< 120m),
   * or station bus platforms right outside a train station (< 200m).
   * Crucially, preserves genuinely distinct sequential stops (such as the current and next stop of a bus line,
   * typically >= 150m apart with distinct names).
   */
  areSimilarStops(a, b, distM = null) {
    if (!a || !b) return false;
    const dM = distM !== null ? distM : this.haversineDistanceKm(a.lat, a.lon, b.lat, b.lon) * 1000;

    // 1. Same official station identifier
    if (a.uicRef && b.uicRef && a.uicRef === b.uicRef) {
      return true;
    }

    // 2. Micro-distance (< 120m): physical proximity on same street/junction/square,
    // opposite side of the road, or adjacent ferry piers.
    // Distinct sequential bus stops are never < 120m apart.
    if (dM <= 120) {
      return true;
    }

    // Helper to clean stop name for comparison
    const clean = (name) => {
      if (!name) return '';
      return name
        .toLowerCase()
        .replace(/\b(bahnhof|bhf|station|gare|stazione|steig\s+[a-z0-9]+|platform\s+[a-z0-9]+|gleis\s+[a-z0-9]+)\b/gi, '')
        .replace(/[^a-z0-9äöüéèà]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const normA = clean(a.name || a.shortName);
    const normB = clean(b.name || b.shortName);

    // 3. Train station vs bus stop directly at the station (< 200m)
    const isTrainBusPair = (a.type === 'train' && b.type === 'bus') || (a.type === 'bus' && b.type === 'train');
    if (isTrainBusPair && dM <= 200) {
      const busStop = a.type === 'bus' ? a : b;
      const busName = (busStop.name || '').toLowerCase();
      if (
        busName.includes('bahnhof') ||
        busName.includes('gare') ||
        busName.includes('stazione') ||
        (normA && normB && (normA.includes(normB) || normB.includes(normA)))
      ) {
        return true;
      }
    }

    // 4. Same/similar name within station platform/stop area (< 250m)
    // (e.g. "Ländte 1" vs "Ländte 2", or "Interlaken Ost" vs "Interlaken Ost, Bahnhof")
    if (dM <= 250) {
      if (normA && normB && (normA === normB || normA.includes(normB) || normB.includes(normA))) {
        return true;
      }
    }

    return false;
  },

  /**
   * Filters candidate stops so that "Similar" stops next to each other (duplicate platforms,
   * same intersection/square < 120m, or station bus stops < 200m) are not both explored,
   * while genuinely distinct stops (such as the current and next stop of a bus line)
   * are both explored.
   *
   * @param {Array} stops Candidate stops from Overpass or app state
   * @param {number} count Maximum number of stops to keep (default: 15)
   * @param {Object} options Optional settings (minSeparationM, forceFilter)
   * @returns {Array} Selected stops prioritized by value and deduplicated of similar neighbors
   */
  prioritizeDiverseStops(stops, count = 15, options = {}) {
    if (!Array.isArray(stops) || stops.length === 0) return [];
    if (count <= 0) return [];

    // Rank candidate stops so that within any cluster, the most valuable stop is evaluated first
    // (e.g. train stations preferred over bus stops, reachable glide over uphill/unreachable)
    const getPriority = (stop) => {
      let score = 0;
      if (stop.isUphill) {
        score += 50000;
      } else if (typeof stop.glideRatio === 'number') {
        if (stop.glideRatio <= 7.5) score -= 15000;
        else if (stop.glideRatio <= 10.0) score -= 5000;
        else score += 10000;
      } else if (stop.feasibility) {
        if (stop.feasibility.status === 'reachable') score -= 15000;
        else if (stop.feasibility.status === 'marginal') score -= 5000;
        else score += 10000;
      }

      // Train stations are primary hubs with faster regional transit
      if (stop.type === 'train') {
        score -= 800;
      }

      // Distance from pilot in meters
      const distM = stop.distM ?? (stop.distKm ? stop.distKm * 1000 : 0);
      score += distM;
      return score;
    };

    const sortedCandidates = [...stops].sort((a, b) => getPriority(a) - getPriority(b));

    const selected = [];
    const selectedIds = new Set();

    for (const cand of sortedCandidates) {
      if (selected.length >= count) break;
      const candId = cand.id ?? `${cand.lat.toFixed(5)},${cand.lon.toFixed(5)}`;
      if (selectedIds.has(candId)) continue;

      let similar = false;
      for (const sel of selected) {
        if (this.areSimilarStops(cand, sel)) {
          similar = true;
          break;
        }
        if (options.minSeparationM && options.minSeparationM > 0) {
          const sepM = this.haversineDistanceKm(cand.lat, cand.lon, sel.lat, sel.lon) * 1000;
          if (sepM < options.minSeparationM) {
            similar = true;
            break;
          }
        }
      }

      if (!similar) {
        selected.push(cand);
        selectedIds.add(candId);
      }
    }

    // Sort final selected stops by distance to pilot
    selected.sort((a, b) => (a.distM || 0) - (b.distM || 0));

    return this._attachMinDistances(selected);
  },

  /**
   * Helper to compute each stop's minimum distance to any other stop in the selected set
   */
  _attachMinDistances(stops) {
    for (let i = 0; i < stops.length; i++) {
      let minDist = Infinity;
      for (let j = 0; j < stops.length; j++) {
        if (i === j) continue;
        const dM = this.haversineDistanceKm(stops[i].lat, stops[i].lon, stops[j].lat, stops[j].lon) * 1000;
        if (dM < minDist) minDist = dM;
      }
      stops[i].minDistToOtherStopsM = isFinite(minDist) ? Math.round(minDist) : null;
    }
    return stops;
  },
};
