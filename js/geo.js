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
   * Haversine distance in meters
   */
  haversineDistanceM(lat1, lon1, lat2, lon2) {
    return this.haversineDistanceKm(lat1, lon1, lat2, lon2) * 1000;
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

    // 1. Try transport.opendata.ch (Swiss locations & street addresses)
    try {
      const url = `https://transport.opendata.ch/v1/locations?x=${lat.toFixed(6)}&y=${lon.toFixed(6)}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.stations) && data.stations.length > 0) {
          // Look for an address entry (id === null)
          const addrEntry = data.stations.find((s) => s && s.id === null && s.name);
          if (addrEntry && addrEntry.name) {
            const addr = addrEntry.name.trim();
            this._geocodeCache.set(cacheKey, addr);
            return addr;
          }
          // If no entry with id === null, use the first location name
          if (data.stations[0] && data.stations[0].name) {
            const addr = data.stations[0].name.trim();
            this._geocodeCache.set(cacheKey, addr);
            return addr;
          }
        }
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
      // Fall through to Nominatim fallback
    }

    // 2. Fallback to OpenStreetMap Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&format=json`;
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'TakeMeHome/1.0 (https://github.com/artem/take-me-home)',
        },
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.address) {
          const a = data.address;
          const street = [a.road, a.house_number].filter(Boolean).join(' ');
          const city = a.city || a.town || a.village || a.municipality || '';
          const postcode = a.postcode || '';
          const parts = [];
          if (street) parts.push(street);
          const cityPart = [postcode, city].filter(Boolean).join(' ');
          if (cityPart) parts.push(cityPart);
          if (parts.length > 0) {
            const addr = parts.join(', ');
            this._geocodeCache.set(cacheKey, addr);
            return addr;
          }
          if (data.display_name) {
            const addr = data.display_name.trim();
            this._geocodeCache.set(cacheKey, addr);
            return addr;
          }
        }
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
    }

    return '';
  },

  /**
   * Helper to clean station and town names for SBB URL search queries.
   */
  cleanSbbName(name) {
    if (!name) return '';
    const trimmed = String(name).trim();
    // Never pass raw coordinates to SBB since SBB does not understand them
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(trimmed)) {
      return '';
    }
    return trimmed;
  },

  /**
   * Helper to build an SBB stop token (uses stop name, with optional fallback / uicRef)
   */
  buildSbbStopToken(stopOrName) {
    if (!stopOrName) return '';
    if (typeof stopOrName === 'object' && stopOrName.resolvedStop) {
      stopOrName = stopOrName.resolvedStop;
    }
    let name = typeof stopOrName === 'object' ? (stopOrName.address || stopOrName.name || '') : String(stopOrName);
    const uicRef = typeof stopOrName === 'object' ? (stopOrName.uicRef || stopOrName.uic_ref || null) : null;
    let cleanName = name.trim();
    // Never pass raw coordinates to SBB as SBB cannot understand coordinate pairs
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(cleanName)) {
      cleanName = '';
    }
    if (!cleanName) return '';
    return uicRef ? `${cleanName}_I${uicRef}` : cleanName;
  },

  /**
   * Generate SBB Web Timetable URL
   * Source: stop name (e.g. "Oberiberg, Wandli")
   * Destination: geocoded street address (e.g. "Kornhausplatz 2, 3011 Bern")
   * Format: https://www.sbb.ch/en?stops=Oberiberg,+Wandli%7EKornhausplatz+2,+3011+Bern&time=00_24
   */
  getSbbWebUrl(from, to, departureDate) {
    let fromName = '';
    if (from) {
      fromName = typeof from === 'object' ? (from.name || from.shortName || '') : String(from);
    }
    let toAddress = '';
    if (to) {
      toAddress = typeof to === 'object' ? (to.address || to.name || '') : String(to);
    }

    // Strip raw coordinates if passed
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(fromName.trim())) fromName = '';
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(toAddress.trim())) toAddress = '';

    const combined = toAddress.trim() ? `${fromName.trim()}~${toAddress.trim()}` : fromName.trim();
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
    let fromName = typeof from === 'object' ? (from?.name || '') : String(from || '');
    let toAddress = typeof to === 'object' ? (to?.address || to?.name || '') : String(to || '');

    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(fromName.trim())) fromName = '';
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(toAddress.trim())) toAddress = '';

    return `sbbmobile://timetable?from=${encodeURIComponent(fromName.trim())}&to=${encodeURIComponent(toAddress.trim())}`;
  },

  /**
   * Generate Universal SBB Mobile Web URL (https://app.sbbmobile.ch)
   * Works on both mobile browsers and desktop, offering a 1-tap 'Open in App' button.
   */
  getSbbUniversalUrl(from, to) {
    let fromName = typeof from === 'object' ? (from?.name || '') : String(from || '');
    let toAddress = typeof to === 'object' ? (to?.address || to?.name || '') : String(to || '');

    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(fromName.trim())) fromName = '';
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(toAddress.trim())) toAddress = '';

    return `https://app.sbbmobile.ch/timetable?from=${encodeURIComponent(fromName.trim())}&to=${encodeURIComponent(toAddress.trim())}`;
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
};
