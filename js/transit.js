/**
 * transit.js - Public transit routing client using Transitous (MOTIS v2) API
 */
import { Geo } from './geo.js';

export const Transit = {
  ENDPOINT: 'https://api.transitous.org/api/v1/plan',
  _cache: new Map(),

  /**
   * Plans a transit journey from a stop to destination starting at a specific ISO timestamp
   * Uses lightweight parameters and in-memory cache to maximize sequential performance.
   * @param {Object} fromStop Stop object with lat, lon
   * @param {Object} toCoord Destination coordinates {lat, lon}
   * @param {Date} departureDate Target departure time (now + reach time)
   * @returns {Promise<Object>} Formatted journey summary
   */
  async planJourney(fromStop, toCoord, departureDate, maxWalkDistanceM = 3000, signal = null) {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    const fromPlace = `${fromStop.lat.toFixed(6)},${fromStop.lon.toFixed(6)}`;
    const toPlace = `${toCoord.lat.toFixed(6)},${toCoord.lon.toFixed(6)}`;
    const isoTime = departureDate.toISOString();

    // Cache key rounded to nearest 5 minutes
    const roundedMinutes = Math.floor(departureDate.getTime() / (5 * 60 * 1000));
    const cacheKey = `${fromPlace}->${toPlace}@${roundedMinutes}_${maxWalkDistanceM}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    // Allow walking up to 3km (3000m) for final destination reachability
    const url = `${this.ENDPOINT}?fromPlace=${encodeURIComponent(fromPlace)}&toPlace=${encodeURIComponent(toPlace)}&time=${encodeURIComponent(isoTime)}&numItineraries=1&maxWalkDistance=${maxWalkDistanceM}`;

    const headers = { 'Accept': 'application/json' };
    if (typeof navigator === 'undefined') {
      headers['User-Agent'] = 'TakeMeHome-ParaglidingTransit/1.0 (https://github.com/artem/take-me-home)';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }

      if (!response.ok) {
        throw new Error(`Transitous API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = this.parseItineraries(data, departureDate, fromStop, toCoord);
      this._cache.set(cacheKey, result);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (signal?.aborted || err.name === 'AbortError') {
        throw err;
      }
      console.warn(`[Transit] Routing failed for stop ${fromStop.name}:`, err.message);
      return this.generateFallbackRoute(fromStop, toCoord, departureDate);
    }
  },

  /**
   * Parses MOTIS itineraries into a clean, easy-to-render object
   */
  parseItineraries(data, targetDepartureDate, fromStop, toCoord) {
    const itineraries = data && data.itineraries;
    if (!itineraries || itineraries.length === 0) {
      return this.generateFallbackRoute(fromStop, toCoord, targetDepartureDate, 'No scheduled transit found');
    }

    // Pick best itinerary (usually first one or shortest duration)
    const best = itineraries[0];

    const transitDurationMinutes = Math.round(best.duration / 60);
    const actualDeparture = new Date(best.startTime);
    const arrival = new Date(best.endTime);

    // Wait time at stop before first transport leaves
    const waitAtStopMinutes = Math.max(0, Math.round((actualDeparture - targetDepartureDate) / (1000 * 60)));

    // Parse legs
    const legs = (best.legs || []).map(leg => {
      const mode = leg.mode || 'TRANSIT';
      const line = leg.routeShortName || leg.headsign || leg.agencyName || '';
      const depTime = leg.startTime ? new Date(leg.startTime) : null;
      const arrTime = leg.endTime ? new Date(leg.endTime) : null;
      const legDurationMin = leg.duration ? Math.round(leg.duration / 60) : 0;

      let icon = '🚌';
      if (mode === 'WALK') icon = '🚶';
      else if (mode === 'RAIL' || mode === 'LONG_DISTANCE' || mode === 'REGIONAL') icon = '🚆';
      else if (mode === 'TRAM' || mode === 'SUBWAY') icon = '🚊';
      else if (mode === 'BUS') icon = '🚌';
      else if (mode === 'FERRY') icon = '⛴️';

      return {
        mode,
        line,
        fromName: leg.from && leg.from.name ? leg.from.name : '',
        toName: leg.to && leg.to.name ? leg.to.name : '',
        durationMin: legDurationMin,
        depTime,
        arrTime,
        icon,
      };
    });

    const transfers = Math.max(0, legs.filter(l => l.mode !== 'WALK').length - 1);

    return {
      success: true,
      hasSchedule: true,
      departureTime: actualDeparture,
      arrivalTime: arrival,
      transitDurationMinutes,
      waitAtStopMinutes,
      transfers,
      legs,
      summary: legs.filter(l => l.mode !== 'WALK').map(l => `${l.icon} ${l.line || l.mode}`).join(' ➔ ') || '🚶 Walk direct',
    };
  },

  /**
   * Generates a truthful fallback response when transit feed lacks scheduled service or cannot be reached
   */
  generateFallbackRoute(fromStop, toCoord, targetDepartureDate, note = 'No scheduled transit found') {
    const transitDistKm = Geo.haversineDistanceKm(fromStop.lat, fromStop.lon, toCoord.lat, toCoord.lon);
    return {
      success: false,
      hasSchedule: false,
      note,
      departureTime: null,
      arrivalTime: null,
      transitDurationMinutes: null,
      waitAtStopMinutes: null,
      transfers: 0,
      legs: [],
      summary: note,
      directDistanceKm: Math.round(transitDistKm * 10) / 10,
    };
  },
};
