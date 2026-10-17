// Time color tiers for station badges (pure logic, no DOM).
//
// - Earliest arrival is best.
// - When arrival is about the same, departure is differentiated (latest departure is best).
// - When arrival is bad/late, departure is colored as bad too (capped by arrival tier).

export const TIER_NAMES = ['tier-best', 'tier-good', 'tier-moderate', 'tier-poor'];

export const TIER_COLORS = {
  'tier-best': '#0284c7',
  'tier-good': '#0d9488',
  'tier-moderate': '#d97706',
  'tier-poor': '#dc2626',
  'tier-querying': '#1e293b',
  'tier-none': '#475569',
};

const MIN = 60000;
const ARR_LIMITS_MIN = [15, 35, 60]; // minutes after earliest arrival
const DEP_LIMITS_MIN = [5, 10, 30]; // minutes before latest departure in cohort
const ARR_COHORT_WINDOW_MIN = 20;

/** Maps a minute difference to a tier index (0 = best ... 3 = poor). */
function rankFor(diffMin, limits) {
  const i = limits.findIndex(limit => diffMin <= limit);
  return i === -1 ? limits.length : i;
}

function toMs(iso) {
  return new Date(iso).getTime();
}

/**
 * Whether a stop has a confirmed timetable option with both times.
 */
export function isConfirmed(stop) {
  return !!(stop.transit && stop.transit.hasSchedule && stop.transit.departureTime && stop.transit.arrivalTime);
}

/**
 * Computes departure/arrival tier classes for one stop.
 * Stops outside the glide are informational and do not affect ratings of stops within the glide.
 * If a stop beyond the glide is the best overall arrival, it is shown as blue (tier-best).
 *
 * @param {{departureTime: string, arrivalTime: string}} transit
 * @param {Array<{departureTime: string, arrivalTime: string}>} confirmed - all confirmed options
 * @param {Array<{departureTime: string, arrivalTime: string}>} [confirmedWithin] - confirmed options within glide
 * @param {boolean} [isThisWithin=true] - whether this stop is within the glide horizon
 * @returns {{depClass: string, arrClass: string}}
 */
export function computeTiers(transit, confirmed, confirmedWithin = null, isThisWithin = true) {
  const none = { depClass: 'tier-none', arrClass: 'tier-none' };
  const depMs = toMs(transit.departureTime);
  const arrMs = toMs(transit.arrivalTime);
  if (isNaN(depMs) || isNaN(arrMs)) return none;

  const allOptions = confirmed
    .map(t => ({ dep: toMs(t.departureTime), arr: toMs(t.arrivalTime) }))
    .filter(o => !isNaN(o.arr));
  if (!allOptions.length) return none;

  const withinOptions = (confirmedWithin && confirmedWithin.length > 0)
    ? confirmedWithin
        .map(t => ({ dep: toMs(t.departureTime), arr: toMs(t.arrivalTime) }))
        .filter(o => !isNaN(o.arr))
    : allOptions;

  // The baseline arrival is always the earliest arrival among options within the glide
  const minWithinArrMs = Math.min(...withinOptions.map(o => o.arr));

  let arrRank;
  let rawDepRank;

  if (!isThisWithin && arrMs <= minWithinArrMs) {
    // If the stop beyond the glide is best, show it as blue (tier-best)
    arrRank = 0;
    rawDepRank = 0;
  } else {
    arrRank = rankFor(Math.max(0, (arrMs - minWithinArrMs) / MIN), ARR_LIMITS_MIN);

    // Departure ranking:
    // For stops within glide, the cohort is drawn ONLY from within-glide options so outside stops
    // do not affect or penalize within-glide ratings.
    const cohortPool = isThisWithin ? withinOptions : allOptions;
    const cohortDeps = cohortPool
      .filter(o => o.arr <= arrMs + ARR_COHORT_WINDOW_MIN * MIN && !isNaN(o.dep))
      .map(o => o.dep);
    const maxDepMs = cohortDeps.length > 0 ? Math.max(depMs, ...cohortDeps) : depMs;
    rawDepRank = rankFor(Math.max(0, (maxDepMs - depMs) / MIN), DEP_LIMITS_MIN);
  }

  return {
    arrClass: TIER_NAMES[arrRank],
    depClass: TIER_NAMES[Math.max(rawDepRank, arrRank)],
  };
}
