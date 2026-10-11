/**
 * elevation.js - Open-Meteo Elevation API client for looking up terrain elevation
 */

export const Elevation = {
  ENDPOINT: 'https://api.open-meteo.com/v1/elevation',

  /**
   * Looks up elevations for a list of coordinate points in a single batch request
   * @param {Array<{lat: number, lon: number}>} points
   * @returns {Promise<Array<number>>} Array of elevations in meters MSL
   */
  async getBatchElevations(points) {
    if (!points || points.length === 0) return [];

    const lats = points.map(p => p.lat.toFixed(6)).join(',');
    const lons = points.map(p => p.lon.toFixed(6)).join(',');
    const url = `${this.ENDPOINT}?latitude=${lats}&longitude=${lons}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Elevation API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data.elevation)) {
        return data.elevation.map(el => (el !== null && el !== undefined ? Math.round(el) : 0));
      } else if (typeof data.elevation === 'number') {
        return [Math.round(data.elevation)];
      }

      throw new Error('Unexpected elevation response format');
    } catch (err) {
      console.warn('[Elevation] Batch lookup failed, using fallback estimations:', err.message);
      // Fallback: return default estimated ground level if offline
      return points.map(() => 500);
    }
  },

  /**
   * Populates stop objects with their elevation
   * @param {Array<Object>} stops
   * @returns {Promise<Array<Object>>}
   */
  async populateStopElevations(stops) {
    if (!stops || stops.length === 0) return stops;

    const elevations = await this.getBatchElevations(stops);
    stops.forEach((stop, idx) => {
      stop.elevationM = elevations[idx] !== undefined ? elevations[idx] : 500;
    });
    return stops;
  },
};
