/**
 * Automated Verification Script for Take Me Home
 * Tests core formulas, APIs, and calculations
 */
import { Geo } from '../js/geo.js';
import { Transit } from '../js/transit.js';
import { Elevation } from '../js/elevation.js';
import { Overpass } from '../js/overpass.js';

async function runTests() {
  console.log('=== Starting Unit & Geodesic Tests ===');

  // Test 1: Haversine distance
  // Interlaken Ost: 46.6903, 7.8691
  // Interlaken West: 46.6833, 7.8500
  const d = Geo.haversineDistanceKm(46.6903, 7.8691, 46.6833, 7.8500);
  console.log(`Test 1: Distance Ost to West = ${d.toFixed(2)} km (expected ~1.64 km)`);
  if (Math.abs(d - 1.64) > 0.15) {
    throw new Error(`Distance mismatch: ${d}`);
  }

  // Test 2: Reach time formula (straight line distance at 30km/h + 30 minutes)
  // Distance = 15 km -> flight = (15 / 30) * 60 = 30 min -> total = 30 + 30 = 60 min
  const t = Geo.calculateReachTimeMinutes(15, 30, 30);
  console.log(`Test 2: Reach time for 15 km = ${t} min (expected 60 min)`);
  if (t !== 60) {
    throw new Error(`Reach time mismatch: ${t}`);
  }

  // Test 3: Glide ratio formula
  // Distance = 5000 m, Pilot alt = 1500m, Stop alt = 500m -> Drop = 1000m -> L/D = 5000 / 1000 = 5.0
  const g1 = Geo.calculateGlideRatio(5000, 1500, 500);
  console.log(`Test 3a: Glide ratio for 5000m / 1000m drop = ${g1.ratio} (expected 5.0)`);
  if (g1.ratio !== 5.0 || g1.altDropM !== 1000 || g1.isUphill) {
    throw new Error(`Glide ratio mismatch: ${JSON.stringify(g1)}`);
  }

  // Test 3b: Uphill case (stop is higher than pilot)
  const g2 = Geo.calculateGlideRatio(2000, 1000, 1200);
  console.log(`Test 3b: Uphill case = ratio:${g2.ratio}, isUphill:${g2.isUphill}`);
  if (g2.ratio !== null || !g2.isUphill) {
    throw new Error(`Uphill check failed: ${JSON.stringify(g2)}`);
  }

  // Test 4: Feasibility classification
  const fReachable = Geo.evaluateFeasibility(6.5, false, 7.5, 10.0);
  const fMarginal = Geo.evaluateFeasibility(8.8, false, 7.5, 10.0);
  const fUnreachable = Geo.evaluateFeasibility(12.0, false, 7.5, 10.0);
  const fUphill = Geo.evaluateFeasibility(null, true, 7.5, 10.0);

  if (fReachable.status !== 'reachable' || fMarginal.status !== 'marginal' || fUnreachable.status !== 'unreachable' || fUphill.status !== 'unreachable') {
    throw new Error('Feasibility evaluation failed');
  }
  console.log('Test 4: Feasibility classifications: PASS');

  // Test 5: Time formatting
  if (Geo.formatDurationMinutes(45) !== '45m' || Geo.formatDurationMinutes(75) !== '1h 15m') {
    throw new Error('Duration formatting failed');
  }
  // Test 6: SBB URL generation (Stop name as source, geocoded address as destination)
  const webUrlWithAddress = Geo.getSbbWebUrl(
    { name: 'Oberiberg, Wandli' },
    { address: 'Kornhausplatz 2, 3011 Bern' },
    new Date('2026-10-12T00:24:00')
  );
  const webUrlStrings = Geo.getSbbWebUrl('Oberiberg, Wandli', 'Kornhausplatz 2, 3011 Bern', new Date('2026-10-12T00:24:00'));
  const mobileUrl = Geo.getSbbMobileUrl('Oberiberg, Wandli', 'Kornhausplatz 2, 3011 Bern');
  console.log('Test 6a: SBB Web URL (with object):', webUrlWithAddress);
  console.log('Test 6b: SBB Web URL (with strings):', webUrlStrings);
  console.log('Test 6c: SBB Mobile URL:', mobileUrl);

  const expectedAddressUrl = 'https://www.sbb.ch/en?stops=Oberiberg,+Wandli%7EKornhausplatz+2,+3011+Bern&date=2026-10-12&time=00_24';
  if (webUrlWithAddress !== expectedAddressUrl) {
    throw new Error(`SBB Web URL mismatch:\nExpected: ${expectedAddressUrl}\nGot:      ${webUrlWithAddress}`);
  }
  if (webUrlStrings !== expectedAddressUrl) {
    throw new Error(`SBB Web strings mismatch: ${webUrlStrings}`);
  }
  const expectedMobileUrl = 'sbbmobile://timetable?from=Oberiberg%2C%20Wandli&to=Kornhausplatz%202%2C%203011%20Bern';
  if (mobileUrl !== expectedMobileUrl) {
    throw new Error(`SBB Mobile URL mismatch:\nExpected: ${expectedMobileUrl}\nGot:      ${mobileUrl}`);
  }

  // Verify Google Maps URL includes departure_time
  const gmapsUrl = Geo.getGoogleMapsUrl(46.68, 7.85, 46.95, 7.44, new Date('2026-10-12T14:30:00Z'));
  if (!gmapsUrl.includes('&departure_time=')) {
    throw new Error('Google Maps URL should include departure_time parameter');
  }

  // Ensure raw coordinates are never passed to SBB Web
  const webUrlRawCoords = Geo.getSbbWebUrl(
    { name: 'Oberiberg, Wandli' },
    '47.1234, 8.5678',
    new Date('2026-10-12T00:24:00')
  );
  if (webUrlRawCoords.includes('47.1234') || webUrlRawCoords.includes('8.5678')) {
    throw new Error('Raw coordinates should never be embedded in SBB Web URL');
  }
  console.log('Test 6: SBB link generation & Google Maps URL: PASS');

  // Test 7: URL query string reflection & parsing
  const testState = {
    pilot: { lat: 46.98000, lon: 8.75000, altM: 2500 },
    destination: { lat: 47.18900, lon: 8.48600 },
    settings: { stopsCount: 20, searchRadiusKm: 12, speedKmH: 35, bufferMinutes: 25, maxGlideRatio: 9.0 },
  };
  const testParams = new URLSearchParams();
  testParams.set('lat', testState.pilot.lat.toFixed(5));
  testParams.set('lon', testState.pilot.lon.toFixed(5));
  testParams.set('alt', Math.round(testState.pilot.altM));
  testParams.set('destLat', testState.destination.lat.toFixed(5));
  testParams.set('destLon', testState.destination.lon.toFixed(5));
  testParams.set('radius', testState.settings.searchRadiusKm);
  testParams.set('stops', testState.settings.stopsCount);
  testParams.set('speed', testState.settings.speedKmH);
  testParams.set('buffer', testState.settings.bufferMinutes);
  testParams.set('glide', testState.settings.maxGlideRatio);

  const queryStr = testParams.toString();
  const parsed = new URLSearchParams(queryStr);
  if (
    parseFloat(parsed.get('lat')) !== 46.98 ||
    parseFloat(parsed.get('alt')) !== 2500 ||
    parseFloat(parsed.get('destLat')) !== 47.189 ||
    parseFloat(parsed.get('destLon')) !== 8.486 ||
    parsed.has('destName') ||
    parseFloat(parsed.get('glide')) !== 9.0 ||
    parseInt(parsed.get('stops'), 10) !== 20
  ) {
    throw new Error('URL params roundtrip failed');
  }
  console.log('Test 7: URL params reflection & parsing: PASS');

  // Test 8: Immediate query abortion support
  const testAbortController = new AbortController();
  testAbortController.abort(); // already aborted

  let transitAborted = false;
  try {
    await Transit.planJourney(
      { lat: 46.68, lon: 7.85, name: 'Test Stop' },
      { lat: 46.95, lon: 7.44 },
      new Date(),
      3000,
      testAbortController.signal
    );
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'Aborted') {
      transitAborted = true;
    }
  }

  let elevAborted = false;
  try {
    await Elevation.getBatchElevations([{ lat: 46.68, lon: 7.85 }], testAbortController.signal);
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'Aborted') {
      elevAborted = true;
    }
  }

  let overpassAborted = false;
  try {
    await Overpass.findNearestStops(46.68, 7.85, 5, 2000, null, testAbortController.signal);
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'Aborted') {
      overpassAborted = true;
    }
  }

  if (!transitAborted || !elevAborted || !overpassAborted) {
    throw new Error(`Abort test failed! Transit: ${transitAborted}, Elevation: ${elevAborted}, Overpass: ${overpassAborted}`);
  }
  console.log('Test 8: Immediate query abortion support: PASS');

  // Test 9: Destination coordinates geocoding into an address for SBB
  const addressBern = await Geo.geocodeCoordinatesToAddress(46.9480, 7.4474);
  console.log('Test 9: Geocoded Bern coordinates to address:', addressBern);
  if (!addressBern || !addressBern.toLowerCase().includes('bern')) {
    throw new Error(`Destination address geocoding failed for Bern: ${addressBern}`);
  }
  console.log('Test 9: Destination coordinates geocoding into address for SBB: PASS');

  // Test 10: Station badge first transport method icon
  const mockTrainItinerary = {
    itineraries: [
      {
        duration: 3600,
        startTime: '2026-10-12T10:15:00Z',
        endTime: '2026-10-12T11:15:00Z',
        legs: [
          { mode: 'WALK', duration: 120, startTime: '2026-10-12T10:15:00Z', endTime: '2026-10-12T10:17:00Z' },
          { mode: 'RAIL', duration: 3480, startTime: '2026-10-12T10:17:00Z', endTime: '2026-10-12T11:15:00Z', routeShortName: 'IC 61' },
        ],
      },
    ],
  };
  const parsedTrain = Transit.parseItineraries(mockTrainItinerary, new Date('2026-10-12T10:15:00Z'), { lat: 46.68, lon: 7.85 }, { lat: 46.95, lon: 7.44 });
  if (parsedTrain.firstIcon !== '🚆') {
    throw new Error(`Expected train icon 🚆, got: ${parsedTrain.firstIcon}`);
  }

  const mockBusItinerary = {
    itineraries: [
      {
        duration: 1800,
        startTime: '2026-10-12T14:00:00Z',
        endTime: '2026-10-12T14:30:00Z',
        legs: [
          { mode: 'BUS', duration: 1800, startTime: '2026-10-12T14:00:00Z', endTime: '2026-10-12T14:30:00Z', routeShortName: 'B 103' },
        ],
      },
    ],
  };
  const parsedBus = Transit.parseItineraries(mockBusItinerary, new Date('2026-10-12T14:00:00Z'), { lat: 46.68, lon: 7.85 }, { lat: 46.95, lon: 7.44 });
  if (parsedBus.firstIcon !== '🚌') {
    throw new Error(`Expected bus icon 🚌, got: ${parsedBus.firstIcon}`);
  }

  const mockCableCarItinerary = {
    itineraries: [
      {
        duration: 900,
        startTime: '2026-10-12T09:00:00Z',
        endTime: '2026-10-12T09:15:00Z',
        legs: [
          { mode: 'CABLE_CAR', duration: 900, startTime: '2026-10-12T09:00:00Z', endTime: '2026-10-12T09:15:00Z', routeShortName: 'Firstbahn' },
        ],
      },
    ],
  };
  const parsedCableCar = Transit.parseItineraries(mockCableCarItinerary, new Date('2026-10-12T09:00:00Z'), { lat: 46.68, lon: 7.85 }, { lat: 46.95, lon: 7.44 });
  if (parsedCableCar.firstIcon !== '🚠') {
    throw new Error(`Expected cable car icon 🚠, got: ${parsedCableCar.firstIcon}`);
  }

  // S-Bahn check: commuter trains (S3, S5, S20) returned as METRO or SUBURBAN must get train icon 🚆 (not bus or tram)
  const mockSbahnItinerary = {
    itineraries: [
      {
        duration: 1800,
        startTime: '2026-10-12T21:57:00Z',
        endTime: '2026-10-12T22:30:00Z',
        legs: [
          { mode: 'METRO', duration: 1980, startTime: '2026-10-12T21:57:00Z', endTime: '2026-10-12T22:30:00Z', routeShortName: 'S3', agencyName: 'BLS AG' },
        ],
      },
    ],
  };
  const parsedSbahn = Transit.parseItineraries(mockSbahnItinerary, new Date('2026-10-12T21:57:00Z'), { lat: 47.12, lon: 7.27 }, { lat: 47.19, lon: 8.48 });
  if (parsedSbahn.firstIcon !== '🚆') {
    throw new Error(`Expected S-Bahn icon 🚆, got: ${parsedSbahn.firstIcon}`);
  }

  console.log(`Test 10: Station badge transport icons (Train: ${parsedTrain.firstIcon}, S-Bahn: ${parsedSbahn.firstIcon}, Bus: ${parsedBus.firstIcon}, Cable: ${parsedCableCar.firstIcon}): PASS`);

  // Test 11: Independent departure (latest best) and arrival (earliest best) color tier classification
  function calculateTimeTiers(depTime, arrTime, maxDepMs, minArrMs) {
    const depMs = new Date(depTime).getTime();
    const arrMs = new Date(arrTime).getTime();

    const depDiffMin = Math.max(0, (maxDepMs - depMs) / 60000);
    let depClass = 'tier-poor';
    if (depDiffMin <= 10) depClass = 'tier-best';
    else if (depDiffMin <= 30) depClass = 'tier-good';
    else if (depDiffMin <= 60) depClass = 'tier-moderate';

    const arrDiffMin = Math.max(0, (arrMs - minArrMs) / 60000);
    let arrClass = 'tier-poor';
    if (arrDiffMin <= 10) arrClass = 'tier-best';
    else if (arrDiffMin <= 30) arrClass = 'tier-good';
    else if (arrDiffMin <= 60) arrClass = 'tier-moderate';

    return { depClass, arrClass };
  }

  const maxDepMs = new Date('2026-10-12T15:00:00Z').getTime(); // Latest departure: 15:00
  const minArrMs = new Date('2026-10-12T16:00:00Z').getTime(); // Earliest arrival: 16:00

  // Option A: Departs at 15:00 (latest = best), Arrives at 16:45 (45m later than earliest = moderate)
  const optA = calculateTimeTiers('2026-10-12T15:00:00Z', '2026-10-12T16:45:00Z', maxDepMs, minArrMs);
  if (optA.depClass !== 'tier-best' || optA.arrClass !== 'tier-moderate') {
    throw new Error(`Option A tier mismatch: ${JSON.stringify(optA)}`);
  }

  // Option B: Departs at 13:45 (75m earlier than latest = poor), Arrives at 16:00 (earliest = best)
  const optB = calculateTimeTiers('2026-10-12T13:45:00Z', '2026-10-12T16:00:00Z', maxDepMs, minArrMs);
  if (optB.depClass !== 'tier-poor' || optB.arrClass !== 'tier-best') {
    throw new Error(`Option B tier mismatch: ${JSON.stringify(optB)}`);
  }

  console.log('Test 11: Independent departure (latest=best) & arrival (earliest=best) tiers: PASS');

  console.log('✅ ALL GEODESIC AND FORMULA TESTS PASSED!');
}

runTests();
