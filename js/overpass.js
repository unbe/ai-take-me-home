/**
 * overpass.js - Discovers public transport stops around coordinates using Overpass API with mirror fallback
 */
import { Geo } from './geo.js';
import { fetchWithTimeout, throwIfAborted } from './util.js';

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
   * in internal database order rather than distance order.
   */
  buildQuery(lat, lon, radiusM = 4000) {
    return `[out:json][timeout:15];
(
  node["highway"="bus_stop"](around:${radiusM},${lat},${lon});
  node["railway"~"station|halt|tram_stop"](around:${radiusM},${lat},${lon});
  node["railway"="stop"]["train"="yes"](around:${radiusM},${lat},${lon});
  node["public_transport"~"platform|stop_position|station"](around:${radiusM},${lat},${lon});
  way["railway"~"station|halt"](around:${radiusM},${lat},${lon});
)->.stops;
.stops out center;
rel(bn.stops)["route"~"train|railway|bus|tram|ferry"];
out body;`;
  },

  /**
   * POSTs an Overpass query with timeout and external abort signal support
   */
  async fetchQuery(url, body, timeoutMs = 7000, signal = null) {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'TakeMeHome/1.0 (https://github.com/artem/take-me-home)',
      },
      body: `data=${encodeURIComponent(body)}`,
    }, timeoutMs, signal);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  },

  /**
   * Queries Overpass trying each server until one succeeds (or aborted)
   */
  async executeQuery(query, signal = null) {
    let lastError = null;
    for (const server of this.SERVERS) {
      throwIfAborted(signal);
      try {
        console.log(`[Overpass] Trying server: ${server}`);
        const data = await this.fetchQuery(server, query, 8000, signal);
        if (data && Array.isArray(data.elements)) {
          console.log(`[Overpass] Success from ${server}: ${data.elements.length} elements`);
          return data;
        }
      } catch (err) {
        // Only a caller abort stops the failover; a per-server timeout moves on to the next mirror
        throwIfAborted(signal);
        console.warn(`[Overpass] Server ${server} failed:`, err.message);
        lastError = err;
      }
    }
    throwIfAborted(signal);
    throw new Error(`All Overpass API servers failed. Last error: ${lastError?.message || 'unknown'}`);
  },

  /**
   * Helper to query Overpass for a given radius and parse & deduplicate the returned stops
   */
  async _queryAndParseStops(lat, lon, radiusM, signal = null) {
    throwIfAborted(signal);
    const query = this.buildQuery(lat, lon, radiusM);
    let result = null;

    try {
      result = await this.executeQuery(query, signal);
    } catch (err) {
      throwIfAborted(signal);
      console.warn(`[Overpass] Query for radius ${radiusM}m failed:`, err);
      return [];
    }

    const rawElements = (result && result.elements) || [];
    const rawNodes = rawElements.filter(el => el.type !== 'relation');
    const rawRelations = rawElements.filter(el => el.type === 'relation');

    // Index parent routes from relations: nodeId -> Map<lineKey, { routeType, ref }>
    const nodeRoutes = new Map();
    for (const rel of rawRelations) {
      const routeType = (rel.tags?.route || 'transit').toLowerCase();
      const ref = (rel.tags?.ref || rel.tags?.name || '').trim();
      if (!ref && !rel.tags?.operator) continue;
      const lineKey = `${routeType}:${ref}`;
      for (const m of (rel.members || [])) {
        if (m.type === 'node') {
          if (!nodeRoutes.has(m.ref)) nodeRoutes.set(m.ref, new Map());
          nodeRoutes.get(m.ref).set(lineKey, { routeType, ref, tags: rel.tags });
        }
      }
    }

    const candidates = [];

    for (const el of rawNodes) {
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

    // Compute Traffic Density & Infrastructure Hierarchy score for each deduplicated stop
    for (const stop of dedupedStops) {
      const cluster = rawNodes.filter(n => {
        const nLat = n.lat !== undefined ? n.lat : (n.center && n.center.lat);
        const nLon = n.lon !== undefined ? n.lon : (n.center && n.center.lon);
        if (nLat === undefined || nLon === undefined) return false;
        return (Geo.haversineDistanceKm(stop.lat, stop.lon, nLat, nLon) * 1000) <= 300;
      });
      stop.clusterNodeCount = cluster.length;

      const clusterLines = new Map();
      for (const n of cluster) {
        const rMap = nodeRoutes.get(n.id);
        if (rMap) {
          for (const [k, v] of rMap.entries()) {
            clusterLines.set(k, v);
          }
        }
      }

      const icLines = [];
      const regTrainLines = [];
      const busLines = [];
      const otherLines = [];

      for (const [k, line] of clusterLines.entries()) {
        const isTrain = line.routeType === 'train' || line.routeType === 'railway';
        const isBus = line.routeType === 'bus' || line.routeType === 'tram';
        const refUpper = (line.ref || '').toUpperCase();
        if (isTrain) {
          if (/^(IC|ICE|EC|TGV|IR|RJ)/.test(refUpper) || refUpper.startsWith('IC') || refUpper.startsWith('ICE')) {
            icLines.push(line.ref);
          } else {
            regTrainLines.push(line.ref);
          }
        } else if (isBus) {
          busLines.push(line.ref);
        } else {
          otherLines.push(line.ref);
        }
      }

      stop.icLines = icLines;
      stop.regTrainLines = regTrainLines;
      stop.busLines = busLines;
      stop.otherLines = otherLines;
      stop.totalLinesCount = icLines.length + regTrainLines.length + busLines.length + otherLines.length;

      // Component A: Route Service Score
      const routeScore = (icLines.length * 5) + (regTrainLines.length * 3) + (busLines.length * 1) + (otherLines.length * 0.5);

      // Component B: Official Hierarchy & Infrastructure Scale
      let infraScore = 0;
      const isMajorStation = stop.tags?.railway === 'station' || stop.tags?.station === 'train';
      const isHalt = stop.tags?.railway === 'halt' || stop.type === 'train' || stop.tags?.train === 'yes';

      if (isMajorStation) infraScore += 12;
      else if (isHalt) infraScore += 5;

      if (stop.tags?.['railway:ref']) infraScore += 3;
      if (stop.tags?.wikidata || stop.tags?.wikipedia) infraScore += 4;
      if (stop.clusterNodeCount >= 4) infraScore += Math.min(6, stop.clusterNodeCount);

      stop.routeScore = routeScore;
      stop.infraScore = infraScore;
      stop.combinedDensityScore = Math.round(routeScore + infraScore);

      if (stop.combinedDensityScore >= 40) stop.hubTier = 'Major Hub';
      else if (stop.combinedDensityScore >= 15) stop.hubTier = 'Transit Junction';
      else if (stop.combinedDensityScore >= 5) stop.hubTier = 'Multi-Line Stop';
      else stop.hubTier = 'Local Stop';
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
    throwIfAborted(signal);

    const MAX_QUERIES = 5;
    const baseRadiusM = 1000; // Start at 1,000 meters
    const HARD_MAX_RADIUS_M = Math.min(maxRadiusM || 20000, 20000); // Strict 20km ceiling
    let stops = [];

    for (let attempt = 1; attempt <= MAX_QUERIES; attempt++) {
      throwIfAborted(signal);

      // Exponential increase: 1km -> 2km -> 4km -> 8km -> 16km -> 20km
      let currentRadiusM = Math.round(baseRadiusM * Math.pow(2, attempt - 1));
      if (currentRadiusM > HARD_MAX_RADIUS_M || attempt === MAX_QUERIES) {
        currentRadiusM = HARD_MAX_RADIUS_M;
      }

      console.log(`[Overpass] Query ${attempt}/${MAX_QUERIES}: Checking radius ${currentRadiusM}m (need ${count} stops, max ${HARD_MAX_RADIUS_M}m)...`);
      stops = await this._queryAndParseStops(lat, lon, currentRadiusM, signal);
      throwIfAborted(signal);
      this.allDiscoveredStops = stops;
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
            throwIfAborted(signal);
            console.warn('[Overpass] Error in shouldContinueExpanding callback:', e);
            keepGoing = false;
          }
        }

        throwIfAborted(signal);

        if (!keepGoing) {
          console.log(`[Overpass] Reached stop count threshold (${stops.length} >= ${count}) with satisfactory radius (${currentRadiusM}m). Stopping search.`);
          return Geo.prioritizeDiverseStops(stops, count);
        }

        console.log(`[Overpass] Glide ratio for stops found so far (${stops.length} stops) is still great! Expanding radius beyond ${currentRadiusM}m (up to ${HARD_MAX_RADIUS_M}m max)...`);
      }
    }

    if (stops.length === 0) {
      throw new Error(`No public transport stops found within ${Math.round(HARD_MAX_RADIUS_M / 1000)}km after ${MAX_QUERIES} queries. Try a different area.`);
    }

    return Geo.prioritizeDiverseStops(stops, count);
  },

  /**
   * Discovers stops that follow the direction of travel from the best stop.
   * Prioritizes subsequent stops along the scheduled transit vehicle route leaving the best stop,
   * followed by stops along the transit departure corridor towards the final destination.
   *
   * @param {Object} pilot Pilot position { lat, lon, altM }
   * @param {Object} bestStop Identified best stop { id, lat, lon, distM, name, transit }
   * @param {number} count Number of stops to find (default: 3)
   * @param {Array} existingStops Stops already known/selected
   * @param {AbortSignal} [signal] Optional abort signal
   * @param {Object} [destination] Final destination { lat, lon }
   * @returns {Promise<Array>} Array of candidate stops following the direction of bestStop
   */
  async findFollowingStops(pilot, bestStop, count = 3, existingStops = [], signal = null, destination = null) {
    throwIfAborted(signal);
    if (!pilot || !bestStop || count <= 0) return [];

    const existingIds = new Set(existingStops.map(s => String(s.id)));
    existingIds.add(String(bestStop.id));
    const selected = [];

    // 1. PRIMARY SOURCE: Subsequent stops directly along the scheduled transit route leaving bestStop
    const firstTransit = bestStop.transit?.firstTransitLeg ||
      (bestStop.transit?.legs || []).find(l => l.mode !== 'WALK');

    if (firstTransit) {
      const lineStops = [
        ...(firstTransit.intermediateStops || []),
        firstTransit.to,
      ].filter(Boolean);

      for (const s of lineStops) {
        if (selected.length >= count) break;
        const sName = s.name || '';
        if (!sName) continue;
        if (existingStops.some(e => e.name === sName || e.shortName === sName)) continue;

        const distKm = Geo.haversineDistanceKm(pilot.lat, pilot.lon, s.lat, s.lon);
        const distM = distKm * 1000;
        const cand = {
          id: s.id || `transit_${s.lat.toFixed(5)}_${s.lon.toFixed(5)}`,
          name: sName,
          shortName: sName,
          lat: s.lat,
          lon: s.lon,
          type: (firstTransit.mode === 'RAIL' || firstTransit.icon === '🚆') ? 'train' : 'bus',
          icon: firstTransit.icon || (firstTransit.mode === 'RAIL' ? '🚆' : '🚌'),
          distKm,
          distM,
          bearing: Geo.bearingDegrees(pilot.lat, pilot.lon, s.lat, s.lon),
        };

        let similar = false;
        for (const sel of [...existingStops, ...selected, bestStop]) {
          if (Geo.areSimilarStops(cand, sel)) {
            similar = true;
            break;
          }
        }

        if (!similar) {
          selected.push(cand);
          existingIds.add(String(cand.id));
        }
      }
    }

    if (selected.length >= count) {
      return selected;
    }

    // 2. CORRIDOR EXTENSION: Stops from Overpass along the transit departure direction / towards destination
    let directionBearing;
    if (firstTransit && firstTransit.from && firstTransit.to && firstTransit.from.lat && firstTransit.to.lat) {
      directionBearing = Geo.bearingDegrees(firstTransit.from.lat, firstTransit.from.lon, firstTransit.to.lat, firstTransit.to.lon);
    } else if (destination) {
      directionBearing = Geo.bearingDegrees(bestStop.lat, bestStop.lon, destination.lat, destination.lon);
    } else {
      directionBearing = Geo.bearingDegrees(pilot.lat, pilot.lon, bestStop.lat, bestStop.lon);
    }

    let pool = (this.allDiscoveredStops || []).filter(s => !existingIds.has(String(s.id)));

    const filterAndSelect = (candidates) => {
      const matching = [];
      for (const cand of candidates) {
        if (existingIds.has(String(cand.id))) continue;

        // Must be in the forward direction from bestStop
        const bearingFromBest = Geo.bearingDegrees(bestStop.lat, bestStop.lon, cand.lat, cand.lon);
        let diff = Math.abs(bearingFromBest - directionBearing);
        if (diff > 180) diff = 360 - diff;
        if (diff > 50) continue;

        const distFromBestM = Geo.haversineDistanceKm(bestStop.lat, bestStop.lon, cand.lat, cand.lon) * 1000;
        if (distFromBestM <= 200) continue;

        // If destination is available, verify it is heading towards destination
        if (destination) {
          const candToDest = Geo.haversineDistanceKm(cand.lat, cand.lon, destination.lat, destination.lon);
          const bestToDest = Geo.haversineDistanceKm(bestStop.lat, bestStop.lon, destination.lat, destination.lon);
          if (candToDest > bestToDest + 1.0) continue; // Skip stops moving away from destination
        }

        matching.push({ ...cand, angleDiff: diff, distFromBestM });
      }

      // Sort by distance from best stop with train station bonus
      matching.sort((a, b) => {
        const bonusA = a.type === 'train' ? -1500 : 0;
        const bonusB = b.type === 'train' ? -1500 : 0;
        return (a.distFromBestM + bonusA) - (b.distFromBestM + bonusB);
      });

      for (const cand of matching) {
        if (selected.length >= count) break;
        let similar = false;
        for (const sel of [...existingStops, ...selected, bestStop]) {
          if (Geo.areSimilarStops(cand, sel)) {
            similar = true;
            break;
          }
        }
        if (!similar) {
          selected.push(cand);
          existingIds.add(String(cand.id));
        }
      }
    };

    filterAndSelect(pool);

    // If still need more stops, query Overpass around best stop
    if (selected.length < count) {
      throwIfAborted(signal);
      console.log(`[Overpass] Found ${selected.length}/${count} corridor stops; querying around best stop (${bestStop.name})...`);
      const radiusM = 8000;
      const additionalStops = await this._queryAndParseStops(bestStop.lat, bestStop.lon, radiusM, signal);
      throwIfAborted(signal);

      for (const s of additionalStops) {
        s.distKm = Geo.haversineDistanceKm(pilot.lat, pilot.lon, s.lat, s.lon);
        s.distM = s.distKm * 1000;
        s.bearing = Geo.bearingDegrees(pilot.lat, pilot.lon, s.lat, s.lon);
      }

      pool = [...pool, ...additionalStops];
      filterAndSelect(pool);
    }

    return selected;
  },
};
