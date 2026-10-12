/**
 * overpass.js - Discovers public transport stops around coordinates using Overpass API with mirror fallback
 */
import { Geo } from './geo.js';

export const Overpass = {
  // Known high-availability public Overpass mirrors
  SERVERS: [
    'https://overpass.osm.ch/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ],

  /**
   * Builds an Overpass QL query string
   * Searches for bus stops, train stations, tram stops, halts, and transit platforms.
   * Note: We avoid small artificial limits (like 'out 40') because Overpass outputs
   * in internal database order rather than distance order. We retrieve all candidate
   * nodes within radius (or up to 300) and let the Haversine formula find the true nearest N.
   */
  /**
   * Builds an Overpass QL query string
   * Searches for bus stops, train stations, tram stops, halts, and transit platforms.
   * Note: We avoid small artificial limits (like 'out 40') because Overpass outputs
   * in internal database order rather than distance order.
   */
  buildQuery(lat, lon, radiusM = 4000) {
    return `[out:json][timeout:12];
(
  node["highway"="bus_stop"](around:${radiusM},${lat},${lon});
  node["railway"~"station|halt|tram_stop"](around:${radiusM},${lat},${lon});
  node["railway"="stop"]["train"="yes"](around:${radiusM},${lat},${lon});
  node["public_transport"~"platform|stop_position|station"](around:${radiusM},${lat},${lon});
  way["railway"~"station|halt"](around:${radiusM},${lat},${lon});
);
out center;`;
  },

  /**
   * Fetches data with timeout and external abort signal support
   */
  async fetchWithTimeout(url, body, timeoutMs = 7000, signal = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: `data=${encodeURIComponent(body)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      throw err;
    }
  },

  /**
   * Queries Overpass trying each server until one succeeds (or aborted)
   */
  async executeQuery(query, signal = null) {
    let lastError = null;
    for (const server of this.SERVERS) {
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      try {
        console.log(`[Overpass] Trying server: ${server}`);
        const data = await this.fetchWithTimeout(server, query, 8000, signal);
        if (data && Array.isArray(data.elements)) {
          console.log(`[Overpass] Success from ${server}: ${data.elements.length} elements`);
          return data;
        }
      } catch (err) {
        if (signal?.aborted || err.name === 'AbortError') {
          throw err;
        }
        console.warn(`[Overpass] Server ${server} failed:`, err.message);
        lastError = err;
      }
    }
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    throw new Error(`All Overpass API servers failed. Last error: ${lastError?.message || 'unknown'}`);
  },

  /**
   * Helper to query Overpass for a given radius and parse & deduplicate the returned stops
   */
  async _queryAndParseStops(lat, lon, radiusM, signal = null) {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    const query = this.buildQuery(lat, lon, radiusM);
    let result = null;

    try {
      result = await this.executeQuery(query, signal);
    } catch (err) {
      if (signal?.aborted || err.name === 'AbortError') {
        throw err;
      }
      console.warn(`[Overpass] Query for radius ${radiusM}m failed:`, err);
      return [];
    }

    const rawElements = (result && result.elements) || [];
    const candidates = [];

    for (const el of rawElements) {
      const stopLat = el.lat !== undefined ? el.lat : (el.center && el.center.lat);
      const stopLon = el.lon !== undefined ? el.lon : (el.center && el.center.lon);
      if (stopLat === undefined || stopLon === undefined) continue;

      const tags = el.tags || {};
      if (tags.railway === 'buffer_stop') continue;

      // Exclude chairlift, ski gondola, and cable transport stations
      // (aerialway=*, station=funicular/cable_car, or lift transport nodes)
      if (
        tags.aerialway ||
        tags.station === 'funicular' ||
        tags.station === 'cable_car' ||
        tags.funicular === 'station' ||
        tags.cable_car ||
        tags.chair_lift ||
        tags.gondola ||
        tags.drag_lift ||
        tags.t_bar
      ) {
        continue;
      }

      // Check name for explicit ski/gondola/cableway terms
      const rawNameCheck = (tags.name || tags.uic_name || '').toLowerCase();
      if (
        rawNameCheck.includes('sesselbahn') ||
        rawNameCheck.includes('chairlift') ||
        rawNameCheck.includes('gondelbahn') ||
        rawNameCheck.includes('skilift') ||
        rawNameCheck.includes('télésiège') ||
        rawNameCheck.includes('télécabine') ||
        rawNameCheck.includes('funivia') ||
        rawNameCheck.includes('seggiovia')
      ) {
        continue;
      }

      // Ensure stop has a recognizable name
      // In Switzerland and Europe, tags.uic_name contains the official detailed network name (e.g. "Interlaken, Sonnenhof")
      // whereas tags.name is often just local "Sonnenhof".
      const uicName = tags.uic_name ? tags.uic_name.trim() : null;
      const rawShortName = tags.name || tags['name:en'] || uicName;
      if (!rawShortName) continue; // Skip unnamed technical infrastructure nodes
      const shortName = rawShortName.trim();
      const fullName = uicName || shortName;
      
      // Determine transport type
      let type = 'bus';
      let icon = '🚌';
      const isTrainStation =
        tags.railway === 'station' ||
        tags.railway === 'halt' ||
        tags.train === 'yes' ||
        tags.suburban === 'yes' ||
        /\b(Bahnhof|Gare|Stazione|S-Bahn)\b/i.test(fullName);

      if (isTrainStation) {
        type = 'train';
        icon = '🚆';
      } else if (tags.railway === 'tram_stop' || tags.tram === 'yes') {
        type = 'tram';
        icon = '🚊';
      } else if (tags.amenity === 'ferry_terminal') {
        type = 'ferry';
        icon = '⛴️';
      } else if (tags.aerialway || tags.cable_car === 'yes' || tags.funicular === 'yes') {
        type = 'cable_car';
        icon = '🚠';
      }

      const distKm = Geo.haversineDistanceKm(lat, lon, stopLat, stopLon);
      const distM = distKm * 1000;
      const bearing = Geo.bearingDegrees(lat, lon, stopLat, stopLon);

      const candidate = {
        id: el.id,
        osmType: el.type,
        name: fullName,       // Use full detailed name (e.g. "Interlaken, Sonnenhof")
        shortName,           // Keep short name for compact badge display
        uicName,
        uicRef: tags.uic_ref || null,
        lat: stopLat,
        lon: stopLon,
        type,
        icon,
        distKm,
        distM,
        bearing,
        tags,
      };

      candidates.push(candidate);
    }

    // Sort candidate platforms by proximity to the pilot first
    candidates.sort((a, b) => a.distM - b.distM);

    // Helper to normalize stop name for platform matching (removes platform/steig suffixes, punct, etc.)
    const normalizeName = (s) => {
      if (!s) return '';
      return s
        .toLowerCase()
        .replace(/\b(bahnhof|bhf|steig\s+[a-z0-9]+|platform\s+[a-z0-9]+)\b/g, '')
        .replace(/[^a-z0-9äöüéèà]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Deduplicate opposite platforms into a single stop option
    // (e.g. northbound vs southbound bus stops on opposite sides of the street)
    const dedupedStops = [];

    for (const cand of candidates) {
      const candNormFull = normalizeName(cand.name);
      const candNormShort = normalizeName(cand.shortName);

      // Check if this candidate belongs to an already accepted stop
      const match = dedupedStops.find(existing => {
        const sepDistM = Geo.haversineDistanceKm(cand.lat, cand.lon, existing.lat, existing.lon) * 1000;

        // 1. Same official station identifier (uic_ref)
        if (cand.uicRef && existing.uicRef && cand.uicRef === existing.uicRef) {
          return true;
        }

        // 2. Micro-distance (< 40m): physical proximity on same street/junction
        if (sepDistM <= 40) {
          return true;
        }

        // 3. Same stop name within typical station platform separation radius (up to 250m)
        const existNormFull = normalizeName(existing.name);
        const existNormShort = normalizeName(existing.shortName);
        const sameName = (
          candNormFull === existNormFull ||
          candNormShort === existNormShort ||
          cand.name.toLowerCase() === existing.name.toLowerCase() ||
          cand.shortName.toLowerCase() === existing.shortName.toLowerCase()
        );

        if (sameName && sepDistM <= 250) {
          return true;
        }

        return false;
      });

      if (!match) {
        dedupedStops.push(cand);
      }
    }

    return dedupedStops;
  },

  /**
   * Finds the N nearest public transport stops using Exponential Radius Expansion:
   * Starts with a tight radius (e.g. 1,000m) and exponentially doubles the radius
   * Finds nearest public transport stops using Adaptive Exponential Radius Expansion:
   * - Starts with a tight radius (e.g. 1,000m) and doubles the radius (1km -> 2km -> 4km -> 8km -> 16km -> 20km).
   * - Capped strictly at maxRadiusM (20,000m / 20km max).
   * - If shouldContinueExpanding callback is provided and indicates stops found so far still have great glide ratios,
   *   it keeps expanding up to maxRadiusM (max 5 queries) to discover even better transit connections.
   *
   * @param {number} lat Pilot latitude
   * @param {number} lon Pilot longitude
   * @param {number} count Number of nearest stops to return (N, default: 15)
   * @param {number} maxRadiusM Maximum upper search radius in meters (strictly capped at 20,000m / 20km)
   * @param {Function} shouldContinueExpanding Optional async callback (currentStops, currentRadiusM) => boolean
   * @returns {Promise<Array>} Array of parsed stop objects sorted by distance
   */
  async findNearestStops(lat, lon, count = 15, maxRadiusM = 20000, shouldContinueExpanding = null, signal = null) {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    const MAX_QUERIES = 5;
    const baseRadiusM = 1000; // Start at 1,000 meters
    const HARD_MAX_RADIUS_M = Math.min(maxRadiusM || 20000, 20000); // Strict 20km ceiling
    let stops = [];

    for (let attempt = 1; attempt <= MAX_QUERIES; attempt++) {
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }

      // Exponential increase: 1km -> 2km -> 4km -> 8km -> 16km -> 20km
      let currentRadiusM = Math.round(baseRadiusM * Math.pow(2, attempt - 1));
      if (currentRadiusM > HARD_MAX_RADIUS_M || attempt === MAX_QUERIES) {
        currentRadiusM = HARD_MAX_RADIUS_M;
      }

      console.log(`[Overpass] Query ${attempt}/${MAX_QUERIES}: Checking radius ${currentRadiusM}m (need ${count} stops, max ${HARD_MAX_RADIUS_M}m)...`);
      stops = await this._queryAndParseStops(lat, lon, currentRadiusM, signal);
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      console.log(`[Overpass] Query ${attempt}/${MAX_QUERIES}: Found ${stops.length} unique stops`);

      // If already at or beyond the 20km hard ceiling, or on last attempt, return results
      if (currentRadiusM >= HARD_MAX_RADIUS_M || attempt === MAX_QUERIES) {
        break;
      }

      // If we met the count threshold, check if we should keep expanding
      if (stops.length >= count) {
        let keepGoing = false;
        if (typeof shouldContinueExpanding === 'function') {
          try {
            keepGoing = await shouldContinueExpanding(stops, currentRadiusM);
          } catch (e) {
            if (signal?.aborted || e?.name === 'AbortError') {
              throw e;
            }
            console.warn('[Overpass] Error in shouldContinueExpanding callback:', e);
            keepGoing = false;
          }
        }

        if (signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }

        if (!keepGoing) {
          console.log(`[Overpass] Reached stop count threshold (${stops.length} >= ${count}) with satisfactory radius (${currentRadiusM}m). Stopping search.`);
          return stops.slice(0, count);
        }

        console.log(`[Overpass] Glide ratio for stops found so far (${stops.length} stops) is still great! Expanding radius beyond ${currentRadiusM}m (up to ${HARD_MAX_RADIUS_M}m max)...`);
      }
    }

    if (stops.length === 0) {
      throw new Error(`No public transport stops found within ${Math.round(HARD_MAX_RADIUS_M / 1000)}km after ${MAX_QUERIES} queries. Try a different area.`);
    }

    return stops.slice(0, count);
  },
};
