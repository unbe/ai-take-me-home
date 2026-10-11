/**
 * Integration test testing live APIs: Overpass, Open-Meteo Elevation, Transitous routing
 */
import { Overpass } from '../js/overpass.js';
import { Elevation } from '../js/elevation.js';
import { Transit } from '../js/transit.js';
import { Geo } from '../js/geo.js';

async function testIntegration() {
  console.log('=== Starting Live API Integration Tests ===');

  const pilot = { lat: 46.6863, lon: 7.8632, altM: 1600 };
  const dest = { lat: 46.9480, lon: 7.4474 };

  // 1. Test Overpass
  console.log('[1/3] Testing Overpass API nearest stops lookup...');
  const stops = await Overpass.findNearestStops(pilot.lat, pilot.lon, 3, 5000);
  console.log(`Found ${stops.length} stops:`);
  stops.forEach((s, i) => console.log(`  #${i+1}: ${s.name} (${s.type}) - ${Geo.formatDistance(s.distKm)} away`));
  if (stops.length === 0) throw new Error('Overpass returned 0 stops');

  // 2. Test Open-Meteo Elevation
  console.log('[2/3] Testing Open-Meteo Elevation lookup...');
  await Elevation.populateStopElevations(stops);
  stops.forEach(s => console.log(`  ${s.name} elevation: ${s.elevationM} m`));
  if (stops.some(s => typeof s.elevationM !== 'number')) throw new Error('Elevation missing');

  // 3. Test Transitous / MOTIS routing
  console.log('[3/3] Testing Transitous route planning...');
  const stop = stops[0];
  const reachMin = Geo.calculateReachTimeMinutes(stop.distKm, 30, 30);
  const depTime = new Date(Date.now() + reachMin * 60000);
  console.log(`Planning from ${stop.name} starting at ${depTime.toISOString()}...`);

  const transitPlan = await Transit.planJourney(stop, dest, depTime);
  console.log('Transit Plan Result:');
  console.log(`  Duration: ${transitPlan.transitDurationMinutes} min`);
  console.log(`  Departure: ${transitPlan.departureTime}`);
  console.log(`  Arrival: ${transitPlan.arrivalTime}`);
  console.log(`  Summary: ${transitPlan.summary}`);
  if (!transitPlan.success) throw new Error('Transit routing failed');

  console.log('✅ ALL LIVE API INTEGRATIONS PASSED SUCCESSFULLY!');
}

testIntegration().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
