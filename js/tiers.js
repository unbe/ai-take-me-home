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
 * @param {{departureTime: string, arrivalTime: string}} transit
 * @param {Array<{departureTime: string, arrivalTime: string}>} confirmed - all confirmed options
 * @returns {{depClass: string, arrClass: string}}
 */
export function computeTiers(transit, confirmed) {
  const none = { depClass: 'tier-none', arrClass: 'tier-none' };
  const depMs = toMs(transit.departureTime);
  const arrMs = toMs(transit.arrivalTime);
  if (isNaN(depMs) || isNaN(arrMs)) return none;

  const options = confirmed
    .map(t => ({ dep: toMs(t.departureTime), arr: toMs(t.arrivalTime) }))
    .filter(o => !isNaN(o.arr));
  if (!options.length) return none;

  const minArrMs = Math.min(...options.map(o => o.arr));
  const arrRank = rankFor(Math.max(0, (arrMs - minArrMs) / MIN), ARR_LIMITS_MIN);

  // Departure vs. the latest departure among options arriving at a similar time
  const cohortDeps = options
    .filter(o => o.arr <= arrMs + ARR_COHORT_WINDOW_MIN * MIN && !isNaN(o.dep))
    .map(o => o.dep);
  const maxDepMs = Math.max(depMs, ...cohortDeps);
  const rawDepRank = rankFor(Math.max(0, (maxDepMs - depMs) / MIN), DEP_LIMITS_MIN);

  return {
    arrClass: TIER_NAMES[arrRank],
    depClass: TIER_NAMES[Math.max(rawDepRank, arrRank)],
  };
}
