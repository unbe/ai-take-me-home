/**
 * transit.js - Public transit routing client using Transitous (MOTIS v2) API
 */
import { Geo } from './geo.js';
import { fetchWithTimeout, throwIfAborted } from './util.js';

const TRAIN_MODES = new Set([
  'RAIL', 'LONG_DISTANCE', 'REGIONAL', 'REGIONAL_RAIL', 'SUBURBAN', 'TRAIN', 'HIGH_SPEED_RAIL',
]);
const CABLE_MODES = new Set(['CABLE_CAR', 'FUNICULAR', 'GONDOLA', 'AERIALWAY', 'CABLEWAY']);

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
    throwIfAborted(signal);

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

    try {
      const response = await fetchWithTimeout(url, { method: 'GET', headers }, 7000, signal);
      if (!response.ok) {
        throw new Error(`Transitous API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = this.parseItineraries(data, departureDate, fromStop, toCoord);
      this._cache.set(cacheKey, result);
      return result;
    } catch (err) {
      // Only a caller abort propagates; request timeouts/HTTP errors fall back to "no schedule"
      throwIfAborted(signal);
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
      const mode = (leg.mode || 'TRANSIT').toUpperCase();
      const line = (leg.routeShortName || leg.headsign || leg.agencyName || '').trim();
      const depTime = leg.startTime ? new Date(leg.startTime) : null;
      const arrTime = leg.endTime ? new Date(leg.endTime) : null;
      const legDurationMin = leg.duration ? Math.round(leg.duration / 60) : 0;

      // S-Bahn in Switzerland/Germany/Austria (e.g. S3, S5, S20, S-Bahn) is a commuter train, never a bus or tram
      const isSbahn = /^S(?:\s*\d+|\b)/i.test(line);

      let icon = '🚌';
      if (mode === 'WALK') {
        icon = '🚶';
      } else if (isSbahn || TRAIN_MODES.has(mode)) {
        icon = '🚆';
      } else if (mode === 'TRAM' || mode === 'LIGHT_RAIL') {
        icon = '🚊';
      } else if (mode === 'SUBWAY' || mode === 'METRO') {
        icon = '🚇';
      } else if (mode === 'FERRY' || mode === 'BOAT' || mode === 'SHIP') {
        icon = '⛴️';
      } else if (CABLE_MODES.has(mode)) {
        icon = '🚠';
      }

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
    const transitLegs = legs.filter(l => l.mode !== 'WALK');
    const firstTransitLeg = transitLegs.length > 0 ? transitLegs[0] : (legs.length > 0 ? legs[0] : null);
    const firstIcon = firstTransitLeg ? firstTransitLeg.icon : '🚆';
    const lastTransitLeg = transitLegs.length > 0 ? transitLegs[transitLegs.length - 1] : null;
    const destinationStopName = lastTransitLeg ? lastTransitLeg.toName : (legs.length > 0 ? legs[legs.length - 1].toName : null);

    // Official scheduled transit vehicle departure and arrival times (matching SBB & Google Maps schedules)
    const transitDepartureTime = firstTransitLeg?.depTime || actualDeparture;
    const transitArrivalTime = lastTransitLeg?.arrTime || arrival;

    // Detailed summary including significant walking legs (>= 2 min)
    const summaryParts = legs.map((l, idx) => {
      if (l.mode === 'WALK') {
        if (l.durationMin >= 2) {
          if (idx === 0) return `🚶 ${l.durationMin}m to ${l.toName || 'station'}`;
          if (idx === legs.length - 1) return `🚶 ${l.durationMin}m to destination`;
          return `🚶 ${l.durationMin}m`;
        }
        return null;
      }
      return `${l.icon} ${l.line || l.mode}`;
    }).filter(Boolean);

    const summary = summaryParts.join(' ➔ ') || '🚶 Walk direct';

    return {
      success: true,
      hasSchedule: true,
      departureTime: actualDeparture,
      arrivalTime: arrival,
      transitDepartureTime,
      transitArrivalTime,
      transitDurationMinutes,
      waitAtStopMinutes,
      transfers,
      destinationStopName: destinationStopName || null,
      legs,
      firstIcon,
      summary,
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
