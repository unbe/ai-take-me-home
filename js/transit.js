/**
 * transit.js - Public transit routing client using Transitous (MOTIS v2) API
 */
import { Geo } from './geo.js';

export const Transit = {
  ENDPOINT: 'https://api.transitous.org/api/v1/plan',

  /**
   * Plans a transit journey from a stop to destination starting at a specific ISO timestamp
   * @param {Object} fromStop Stop object with lat, lon
   * @param {Object} toCoord Destination coordinates {lat, lon}
   * @param {Date} departureDate Target departure time (now + reach time)
   * @returns {Promise<Object>} Formatted journey summary
   */
  async planJourney(fromStop, toCoord, departureDate) {
    const fromPlace = `${fromStop.lat.toFixed(6)},${fromStop.lon.toFixed(6)}`;
    const toPlace = `${toCoord.lat.toFixed(6)},${toCoord.lon.toFixed(6)}`;
    const isoTime = departureDate.toISOString();

    const url = `${this.ENDPOINT}?fromPlace=${encodeURIComponent(fromPlace)}&toPlace=${encodeURIComponent(toPlace)}&time=${encodeURIComponent(isoTime)}`;

    const headers = { 'Accept': 'application/json' };
    if (typeof navigator === 'undefined') {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Transitous API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.parseItineraries(data, departureDate, fromStop, toCoord);
    } catch (err) {
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
   * Generates a fallback distance-based travel estimation when transit feed lacks coverage
   */
  generateFallbackRoute(fromStop, toCoord, targetDepartureDate, note = 'Estimated routing') {
    const transitDistKm = Geo.haversineDistanceKm(fromStop.lat, fromStop.lon, toCoord.lat, toCoord.lon);
    // Estimated average speed: 45 km/h for regional transit + 10 min connection buffer
    const estTransitMin = Math.round((transitDistKm / 45) * 60 + 10);
    const departure = new Date(targetDepartureDate.getTime() + 5 * 60000); // 5 min buffer
    const arrival = new Date(departure.getTime() + estTransitMin * 60000);

    return {
      success: true,
      hasSchedule: false,
      note,
      departureTime: departure,
      arrivalTime: arrival,
      transitDurationMinutes: estTransitMin,
      waitAtStopMinutes: 5,
      transfers: 1,
      legs: [
        {
          mode: 'TRANSIT',
          line: 'Regional Service',
          icon: '🚌',
          durationMin: estTransitMin,
          depTime: departure,
          arrTime: arrival,
          fromName: fromStop.name,
          toName: 'Destination',
        },
      ],
      summary: `Estimated (${Geo.formatDistance(transitDistKm)})`,
    };
  },
};
