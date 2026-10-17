/**
 * Automated Verification Script for Take Me Home
 * Tests core formulas, APIs, and calculations
 */
import { Geo } from '../js/geo.js';
import { Transit } from '../js/transit.js';
import { Elevation } from '../js/elevation.js';
import { Overpass } from '../js/overpass.js';
import { computeTiers } from '../js/tiers.js';

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

  // Verify Google Maps URL includes departure_time and native data timestamp for transit
  const gmapsUrl = Geo.getGoogleMapsUrl(46.68, 7.85, 46.95, 7.44, new Date('2026-10-12T14:30:00Z'));
  if (!gmapsUrl.includes('&departure_time=')) {
    throw new Error('Google Maps URL should include departure_time parameter');
  }
  if (!gmapsUrl.includes('!6e0!7e2!8j') || !gmapsUrl.includes('!3e3')) {
    throw new Error(`Google Maps URL missing native transit departure protobuf payload: ${gmapsUrl}`);
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

  // Test 11: Smart correlated departure and arrival tier classification
  // Uses the real tier logic from js/tiers.js
  function calculateSmartTimeTiers(currentStop, allConfirmedStops) {
    const toTransit = s => ({ departureTime: s.dep, arrivalTime: s.arr });
    return computeTiers(toTransit(currentStop), allConfirmedStops.map(toTransit));
  }

  const allStops = [
    { name: 'Stop 1 (Dep 14:40, Arr 16:00)', dep: '2026-10-12T14:40:00Z', arr: '2026-10-12T16:00:00Z' },
    { name: 'Stop 2 (Dep 14:15, Arr 16:00)', dep: '2026-10-12T14:15:00Z', arr: '2026-10-12T16:00:00Z' },
    { name: 'Stop 3 (Dep 16:30, Arr 20:30)', dep: '2026-10-12T16:30:00Z', arr: '2026-10-12T20:30:00Z' },
    { name: 'Stop 4 (Dep 14:46, Arr 16:00)', dep: '2026-10-12T14:46:00Z', arr: '2026-10-12T16:00:00Z' },
  ];

  // 1. Arrival about the same: Stop 1 vs Stop 2 vs Stop 4 all arrive at 16:00.
  // Stop 4 departs at 14:46 (latest in cohort) -> depClass should be tier-best
  const s4 = calculateSmartTimeTiers(allStops[3], allStops);
  if (s4.depClass !== 'tier-best' || s4.arrClass !== 'tier-best') {
    throw new Error(`Stop 4 mismatch: ${JSON.stringify(s4)}`);
  }

  // Stop 1 departs at 14:40 (6 min earlier than Stop 4 -> <= 10m) -> depClass should be tier-good
  const s1 = calculateSmartTimeTiers(allStops[0], allStops);
  if (s1.depClass !== 'tier-good' || s1.arrClass !== 'tier-best') {
    throw new Error(`Stop 1 mismatch: ${JSON.stringify(s1)}`);
  }

  // Stop 2 departs at 14:15 (31 min earlier than Stop 4 -> > 30m) -> depClass should be tier-poor
  const s2 = calculateSmartTimeTiers(allStops[1], allStops);
  if (s2.depClass !== 'tier-poor' || s2.arrClass !== 'tier-best') {
    throw new Error(`Stop 2 mismatch: ${JSON.stringify(s2)}`);
  }

  // 2. Late/bad arrival: Stop 3 arrives at 20:30 (4.5 hours late) -> departure MUST be colored as tier-poor too
  const s3 = calculateSmartTimeTiers(allStops[2], allStops);
  if (s3.depClass !== 'tier-poor' || s3.arrClass !== 'tier-poor') {
    throw new Error(`Stop 3 mismatch: ${JSON.stringify(s3)}`);
  }


  console.log('Test 11: Smart correlated departure & arrival tiers: PASS');

  // Test 12: Similar stops deduplication & sequential bus stop preservation
  // 12a: areSimilarStops tests:
  // - Micro-distance stops (< 120m on same junction or opposite sides) are similar
  const stopNorth = { name: 'Jungfraustrasse', type: 'bus', lat: 46.68523, lon: 7.85530 };
  const stopSouth = { name: 'Zentralplatz', type: 'bus', lat: 46.68456, lon: 7.85519 };
  if (!Geo.areSimilarStops(stopNorth, stopSouth)) {
    throw new Error('Expected micro-distance stops (< 120m) to be detected as similar');
  }

  // - Station bus loop right outside train station (< 200m) is similar
  const trainHub = { name: 'Interlaken Ost, Bahnhof', type: 'train', lat: 46.6903, lon: 7.8691 };
  const busAtStation = { name: 'Interlaken Ost, Bahnhof', type: 'bus', lat: 46.6901, lon: 7.8688 };
  if (!Geo.areSimilarStops(trainHub, busAtStation)) {
    throw new Error('Expected bus stop directly at train station to be detected as similar');
  }

  // - Consecutive bus stops on the bus line (e.g. 270m apart) are NOT similar and MUST be explored
  const busStopA = { name: 'Interlaken Kursaal', type: 'bus', lat: 46.6880, lon: 7.8650 };
  const busStopB = { name: 'Interlaken Post', type: 'bus', lat: 46.6860, lon: 7.8630 };
  if (Geo.areSimilarStops(busStopA, busStopB)) {
    throw new Error('Expected consecutive bus stops to NOT be detected as similar');
  }

  // - Two distinct train stations (~1.5km apart) are NOT similar
  const trainOst = { name: 'Interlaken Ost, Bahnhof', type: 'train', lat: 46.6903, lon: 7.8691 };
  const trainWest = { name: 'Interlaken West, Bahnhof', type: 'train', lat: 46.6834, lon: 7.8507 };
  if (Geo.areSimilarStops(trainOst, trainWest)) {
    throw new Error('Expected distinct train stations to NOT be detected as similar');
  }

  // 12b: Corridor diversity stop selection - distinct lines/towns prioritized over multiple stops on same line
  const candidateStops = [
    { id: 's1', name: 'Interlaken Ost (Train)', type: 'train', lat: 46.6903, lon: 7.8691, distM: 1000 },
    { id: 's2', name: 'Interlaken Kursaal (Bus)', type: 'bus', lat: 46.6880, lon: 7.8650, distM: 1100 },
    { id: 's3', name: 'Interlaken Post (Bus)', type: 'bus', lat: 46.6860, lon: 7.8630, distM: 1200 },
    { id: 's3_dup', name: 'Interlaken Post Platform 2 (Bus)', type: 'bus', lat: 46.6861, lon: 7.8631, distM: 1210 },
    { id: 's4', name: 'Unterseen Dorf (Bus)', type: 'bus', lat: 46.6850, lon: 7.8420, distM: 1900 },
    { id: 's5', name: 'Bönigen See (Bus)', type: 'bus', lat: 46.6860, lon: 7.9050, distM: 2800 },
    { id: 's6', name: 'Wilderswil (Train)', type: 'train', lat: 46.6660, lon: 7.8670, distM: 3200 },
  ];

  const selectedStops = Geo.prioritizeDiverseStops(candidateStops, 4);
  const selectedNames = selectedStops.map(s => s.name);
  console.log('Test 12b: Selected 4 stops (diverse lines + train hubs):', selectedNames);

  // Diverse lines (Kursaal and Unterseen) and train stations must be prioritized
  if (!selectedNames.includes('Interlaken Kursaal (Bus)') || !selectedNames.includes('Unterseen Dorf (Bus)')) {
    throw new Error(`Diverse corridor lines were not prioritized: ${JSON.stringify(selectedNames)}`);
  }
  // Duplicate platform (< 120m) must be pruned
  if (selectedNames.includes('Interlaken Post Platform 2 (Bus)')) {
    throw new Error(`Duplicate platform was not pruned: ${JSON.stringify(selectedNames)}`);
  }

  // Pass 2: when count is large enough, subsequent stops on the same line are retained
  const sixStops = Geo.prioritizeDiverseStops(candidateStops, 6).map(s => s.name);
  if (!sixStops.includes('Interlaken Post (Bus)')) {
    throw new Error(`Pass 2 did not fill remaining slots with subsequent stops: ${JSON.stringify(sixStops)}`);
  }

  // 12c: Check minDistToOtherStopsM is attached and positive
  for (const s of selectedStops) {
    if (typeof s.minDistToOtherStopsM !== 'number' || s.minDistToOtherStopsM <= 0) {
      throw new Error(`Invalid minDistToOtherStopsM for ${s.name}: ${s.minDistToOtherStopsM}`);
    }
  }

  // 12d: Train station retention - Interlaken Ost and Interlaken West (~1.5km apart) must both be included
  const candidatesWithWest = [
    { id: 'ost', name: 'Interlaken Ost, Bahnhof', type: 'train', lat: 46.6903, lon: 7.8691, distM: 630 },
    { id: 'west', name: 'Interlaken West, Bahnhof', type: 'train', lat: 46.6834, lon: 7.8507, distM: 912 },
    { id: 'kursaal', name: 'Interlaken Kursaal (Bus)', type: 'bus', lat: 46.6880, lon: 7.8650, distM: 700 },
    { id: 'post', name: 'Interlaken Post (Bus)', type: 'bus', lat: 46.6860, lon: 7.8630, distM: 800 },
    { id: 'wilderswil', name: 'Wilderswil (Train)', type: 'train', lat: 46.6660, lon: 7.8670, distM: 2300 },
  ];
  const diverseWithWest = Geo.prioritizeDiverseStops(candidatesWithWest, 4);
  const diverseWithWestNames = diverseWithWest.map(s => s.name);
  console.log('Test 12d: Selected stops including West:', diverseWithWestNames);
  if (!diverseWithWestNames.includes('Interlaken Ost, Bahnhof') || !diverseWithWestNames.includes('Interlaken West, Bahnhof')) {
    throw new Error(`Interlaken West was skipped: ${JSON.stringify(diverseWithWestNames)}`);
  }

  // 12e: Train stations must never be pruned by nearby bus stops
  const busBeforeTrain = [
    { id: 'bus_close', name: 'Local Stop (Bus)', type: 'bus', lat: 46.6850, lon: 7.8510, distM: 200 },
    { id: 'train_hub', name: 'Interlaken West (Train)', type: 'train', lat: 46.6834, lon: 7.8507, distM: 350 },
  ];
  const trainKept = Geo.prioritizeDiverseStops(busBeforeTrain, 2);
  const trainKeptNames = trainKept.map(s => s.name);
  if (!trainKeptNames.includes('Interlaken West (Train)')) {
    throw new Error(`Train station was pruned by nearby bus stop: ${JSON.stringify(trainKeptNames)}`);
  }

  console.log('Test 12: Spatial diversity stop prioritization: PASS');

  // Test 13: Query stops that follow the direction of the best stop
  const pilotPos = { lat: 46.6863, lon: 7.8632, altM: 1600 };
  const bestStop = {
    id: 's_best',
    name: 'Interlaken Ost, Bahnhof',
    type: 'train',
    lat: 46.6903,
    lon: 7.8691,
    distM: 630,
    distKm: 0.63,
  };
  // Pre-seed pool with candidate stops
  Overpass.allDiscoveredStops = [
    // Behind best stop or opposite direction (South-West)
    { id: 'opp1', name: 'Wilderswil (Opposite)', type: 'train', lat: 46.6660, lon: 7.8670, distM: 2300, distKm: 2.3 },
    // Along North-East corridor (following best stop bearing ~45°)
    { id: 'fwd1', name: 'Ringgenberg (Train)', type: 'train', lat: 46.7020, lon: 7.8960, distM: 3100, distKm: 3.1 },
    { id: 'fwd2', name: 'Niederried (Train)', type: 'train', lat: 46.7160, lon: 7.9300, distM: 6000, distKm: 6.0 },
    { id: 'fwd3', name: 'Oberried (Train)', type: 'train', lat: 46.7320, lon: 7.9620, distM: 9000, distKm: 9.0 },
    // Duplicate of fwd1 within 80m
    { id: 'fwd1_dup', name: 'Ringgenberg Platform 2', type: 'train', lat: 46.7022, lon: 7.8962, distM: 3120, distKm: 3.12 },
  ];

  const following = await Overpass.findFollowingStops(pilotPos, bestStop, 3, [bestStop]);
  const followingNames = following.map(s => s.name);
  console.log('Test 13: 3 stops following direction of best stop:', followingNames);

  if (following.length !== 3) {
    throw new Error(`Expected 3 following stops, got ${following.length}`);
  }
  if (!followingNames.includes('Ringgenberg (Train)') ||
      !followingNames.includes('Niederried (Train)') ||
      !followingNames.includes('Oberried (Train)')) {
    throw new Error(`Following stops did not match expected corridor stops: ${JSON.stringify(followingNames)}`);
  }
  if (followingNames.includes('Wilderswil (Opposite)') || followingNames.includes('Ringgenberg Platform 2')) {
    throw new Error(`Invalid stop included in corridor results: ${JSON.stringify(followingNames)}`);
  }

  console.log('Test 13: Query 3 stops following direction of best stop: PASS');

  // Test 14: Transit-line route & destination corridor stop selection
  // In Gohl (pilot at 46.97463, 7.83943, best stop Gohl Houetershus at 46.97239, 7.82379),
  // pilot-to-stop bearing is 258° (West, dead-end valley), but destination is Zug (47.19151, 8.48387, bearing ~64° NE).
  // The transit vehicle route departs along 40° towards Wasen i.E.
  const gohlPilot = { lat: 46.97463, lon: 7.83943, altM: 1600 };
  const gohlDestination = { lat: 47.19151, lon: 8.48387 };
  const gohlBestStop = {
    id: 'gohl_best',
    name: 'Gohl, Houetershus',
    lat: 46.97239,
    lon: 7.82379,
    distM: 1210,
    distKm: 1.21,
    transit: {
      hasSchedule: true,
      firstTransitLeg: {
        mode: 'BUS',
        from: { name: 'Gohl, Houetershus', lat: 46.97239, lon: 7.82379 },
        to: { name: 'Wasen i.E., Abzw. Churzenei', lat: 47.0180, lon: 7.8870 },
        intermediateStops: [
          { name: 'Wasen i.E., Sparenegg', lat: 46.9980, lon: 7.8540 },
          { name: 'Wasen i.E., Aeschberg', lat: 47.0060, lon: 7.8690 },
        ]
      }
    }
  };

  const lineFollowing = await Overpass.findFollowingStops(
    gohlPilot,
    gohlBestStop,
    3,
    [gohlBestStop],
    null,
    gohlDestination
  );
  const lineFollowingNames = lineFollowing.map(s => s.name);
  console.log('Test 14: Transit route following stops:', lineFollowingNames);

  if (lineFollowing.length !== 3) {
    throw new Error(`Expected 3 transit following stops, got ${lineFollowing.length}`);
  }
  if (!lineFollowingNames.includes('Wasen i.E., Sparenegg') ||
      !lineFollowingNames.includes('Wasen i.E., Aeschberg') ||
      !lineFollowingNames.includes('Wasen i.E., Abzw. Churzenei')) {
    throw new Error(`Did not pick up scheduled transit route stops: ${JSON.stringify(lineFollowingNames)}`);
  }

  console.log('Test 14: Transit-line route & destination corridor stop selection: PASS');

  // Test 15: Treat transit more than 16 hours away as not available
  const baseTargetDate = new Date('2026-10-17T20:00:00.000Z');
  const dummyStop = { lat: 46.97239, lon: 7.82379, name: 'Gohl, Houetershus' };
  const dummyDest = { lat: 47.19151, lon: 8.48387 };

  // 15a: Itinerary departing in 10h (within 16h) -> available
  const dataWithin16h = {
    itineraries: [{
      duration: 180 * 60, // 3 hours
      startTime: new Date('2026-10-18T06:00:00.000Z').getTime(), // 10h wait
      endTime: new Date('2026-10-18T09:00:00.000Z').getTime(),
      legs: [{
        mode: 'BUS',
        startTime: new Date('2026-10-18T06:00:00.000Z').getTime(),
        endTime: new Date('2026-10-18T09:00:00.000Z').getTime(),
        routeShortName: '285',
      }]
    }]
  };
  const resWithin = Transit.parseItineraries(dataWithin16h, baseTargetDate, dummyStop, dummyDest);
  if (!resWithin.hasSchedule || !resWithin.success) {
    throw new Error(`Expected itinerary within 16h to be available, got: ${JSON.stringify(resWithin)}`);
  }

  // 15b: Itinerary departing in 32h (Monday morning after weekend, > 16h) -> not available
  const dataOver16h = {
    itineraries: [{
      duration: 160 * 60,
      startTime: new Date('2026-10-19T04:00:00.000Z').getTime(), // 32h wait
      endTime: new Date('2026-10-19T06:40:00.000Z').getTime(),
      legs: [{
        mode: 'BUS',
        startTime: new Date('2026-10-19T04:00:00.000Z').getTime(),
        endTime: new Date('2026-10-19T06:40:00.000Z').getTime(),
        routeShortName: '286',
      }]
    }]
  };
  const resOver = Transit.parseItineraries(dataOver16h, baseTargetDate, dummyStop, dummyDest);
  if (resOver.hasSchedule || resOver.success || resOver.summary !== 'No service within 16h') {
    throw new Error(`Expected itinerary >16h away to be unavailable, got: ${JSON.stringify(resOver)}`);
  }

  console.log('Test 15: 16-hour transit availability limit: PASS');

  // Test 16: Glide horizon sorting priority & tier rating isolation
  // 16a: Check Geo.isWithinGlide
  const reachableStop = { feasibility: { status: 'reachable' } };
  const marginalStop = { feasibility: { status: 'marginal' } };
  const unreachableStop = { feasibility: { status: 'unreachable' } };
  if (!Geo.isWithinGlide(reachableStop) || !Geo.isWithinGlide(marginalStop) || Geo.isWithinGlide(unreachableStop)) {
    throw new Error('Geo.isWithinGlide classification failed');
  }

  // 16b: Sorting - reachable stop (90 min) vs unreachable stop (60 min)
  // Unreachable stop MUST NOT win over reachable stop
  const testStops = [
    {
      id: 'unreachable_fast',
      name: 'Unreachable Express Station',
      feasibility: { status: 'unreachable' },
      transit: { hasSchedule: true },
      totalTripMinutes: 60,
      distM: 5000,
    },
    {
      id: 'reachable_regular',
      name: 'Reachable Local Stop',
      feasibility: { status: 'reachable' },
      transit: { hasSchedule: true },
      totalTripMinutes: 90,
      distM: 1000,
    },
  ];

  testStops.sort((a, b) => {
    const aHas = a.transit && a.transit.hasSchedule && isFinite(a.totalTripMinutes);
    const bHas = b.transit && b.transit.hasSchedule && isFinite(b.totalTripMinutes);
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) {
      const aWithin = Geo.isWithinGlide(a);
      const bWithin = Geo.isWithinGlide(b);
      if (aWithin && !bWithin) return -1;
      if (!aWithin && bWithin) return 1;
      if (a.totalTripMinutes !== b.totalTripMinutes) {
        return a.totalTripMinutes - b.totalTripMinutes;
      }
      return a.distM - b.distM;
    }
    return 0;
  });

  if (testStops[0].id !== 'reachable_regular') {
    throw new Error(`Expected reachable stop to win #1, but got: ${testStops[0].id}`);
  }

  // 16c: Tier rating isolation
  // Stop A (reachable, arr 12:00)
  // Stop B (reachable, arr 12:10)
  // Stop X (unreachable, arr 11:20 - 40 min earlier!)
  // Stop Y (unreachable, arr 13:00 - 60 min later)
  const stopA_transit = { departureTime: '2026-10-18T10:00:00Z', arrivalTime: '2026-10-18T12:00:00Z' };
  const stopB_transit = { departureTime: '2026-10-18T10:10:00Z', arrivalTime: '2026-10-18T12:10:00Z' };
  const stopX_transit = { departureTime: '2026-10-18T09:30:00Z', arrivalTime: '2026-10-18T11:20:00Z' };
  const stopY_transit = { departureTime: '2026-10-18T11:00:00Z', arrivalTime: '2026-10-18T13:00:00Z' };

  const allConfirmed = [stopA_transit, stopB_transit, stopX_transit, stopY_transit];
  const withinConfirmed = [stopA_transit, stopB_transit];

  // Stop X (beyond glide, but best overall) -> MUST be shown as blue (tier-best)
  const tiersX = computeTiers(stopX_transit, allConfirmed, withinConfirmed, false);
  if (tiersX.arrClass !== 'tier-best') {
    throw new Error(`Expected beyond-glide best stop X to have blue arrClass, got: ${tiersX.arrClass}`);
  }

  // Stop A (best within glide) -> MUST be shown as blue (tier-best)
  const tiersA = computeTiers(stopA_transit, allConfirmed, withinConfirmed, true);
  if (tiersA.arrClass !== 'tier-best') {
    throw new Error(`Expected within-glide best stop A to have blue arrClass, got: ${tiersA.arrClass}`);
  }

  // Stop B (within glide, 10 min after Stop A) -> MUST be blue (tier-best) because compared against Stop A (not Stop X!)
  const tiersB = computeTiers(stopB_transit, allConfirmed, withinConfirmed, true);
  if (tiersB.arrClass !== 'tier-best') {
    throw new Error(`Expected stop B to be tier-best within glide, got: ${tiersB.arrClass} (dragged down by outside stop?)`);
  }

  // Stop Y (beyond glide, 60 min after best within glide) -> MUST NOT be blue
  const tiersY = computeTiers(stopY_transit, allConfirmed, withinConfirmed, false);
  if (tiersY.arrClass === 'tier-best') {
    throw new Error(`Expected slow beyond-glide stop Y to not be tier-best, got: ${tiersY.arrClass}`);
  }

  console.log('Test 16: Glide horizon sorting priority & tier rating isolation: PASS');

  // Test 17: Down-corridor stops: filter anything beyond 1:17 glide (or uphill)
  const candidateCorridorStops = [
    { name: 'Corridor 1 (10:1)', distM: 5000, elevM: 500 }, // drop = 500m -> 10:1 (ok)
    { name: 'Corridor 2 (16:1)', distM: 8000, elevM: 500 }, // drop = 500m -> 16:1 (ok)
    { name: 'Corridor 3 (20:1)', distM: 10000, elevM: 500 }, // drop = 500m -> 20:1 (>17 -> drop)
    { name: 'Corridor 4 (uphill)', distM: 3000, elevM: 1100 }, // drop = -100m (uphill -> drop)
    { name: 'Corridor 5 (14:1)', distM: 7000, elevM: 500 }, // drop = 500m -> 14:1 (ok)
  ];
  const testPilotAlt = 1000;
  const filteredCorridor = [];
  for (const s of candidateCorridorStops) {
    const g = Geo.calculateGlideRatio(s.distM, testPilotAlt, s.elevM);
    s.glideRatio = g.ratio;
    s.isUphill = g.isUphill;
    if (s.isUphill || s.glideRatio === null || s.glideRatio > 17) {
      continue;
    }
    filteredCorridor.push(s);
    if (filteredCorridor.length >= 3) break;
  }

  const keptNames = filteredCorridor.map(s => s.name);
  if (keptNames.length !== 3 ||
      !keptNames.includes('Corridor 1 (10:1)') ||
      !keptNames.includes('Corridor 2 (16:1)') ||
      !keptNames.includes('Corridor 5 (14:1)')) {
    throw new Error(`Unexpected down-corridor filtering: ${JSON.stringify(keptNames)}`);
  }
  if (keptNames.includes('Corridor 3 (20:1)') || keptNames.includes('Corridor 4 (uphill)')) {
    throw new Error(`Stops beyond 1:17 glide were not dropped: ${JSON.stringify(keptNames)}`);
  }

  console.log('Test 17: Down-corridor stops 1:17 glide ratio filter: PASS');

  // Test 18: Line prefix diversity & railway hub prioritization
  // 10 bus stops in Gohl valley (1.2km to 3.9km) + 1 major train station in Langnau (5.7km) + other corridors
  const valleyCandidates = [
    { id: 'g1', name: 'Gohl, Houetershus', type: 'bus', distM: 1220 },
    { id: 'g2', name: 'Gohl, Gmünden', type: 'bus', distM: 1320 },
    { id: 'g3', name: 'Gohl, Obeningohl', type: 'bus', distM: 1730 },
    { id: 'g4', name: 'Gohl, Aeugsteren', type: 'bus', distM: 1950 },
    { id: 'g5', name: 'Gohl, Mettlen', type: 'bus', distM: 2570 },
    { id: 'g6', name: 'Gohl, Schulhaus', type: 'bus', distM: 2790 },
    { id: 'g7', name: 'Gohl, Matten', type: 'bus', distM: 3070 },
    { id: 'g8', name: 'Gohl, Dorf', type: 'bus', distM: 3330 },
    { id: 'langnau', name: 'Langnau i.E., Bahnhof', type: 'train', distM: 5730 },
    { id: 'trub', name: 'Trub, Löwenplatz', type: 'bus', distM: 4580 },
    { id: 'barau', name: 'Bärau, Dorf', type: 'bus', distM: 4300 },
    { id: 'wasen', name: 'Wasen i.E., Sparenegg', type: 'bus', distM: 4100 },
  ];

  const diverseSelection = Geo.prioritizeDiverseStops(valleyCandidates, 5);
  const diverseNames = diverseSelection.map(s => s.name);
  console.log('Test 18: Diverse selection result:', diverseNames);

  // Train station at Langnau MUST be included
  if (!diverseNames.includes('Langnau i.E., Bahnhof')) {
    throw new Error(`Langnau train station was excluded by valley bus stops: ${JSON.stringify(diverseNames)}`);
  }

  // Gohl bus stops must be capped at 2 (not taking 4 or 5 slots)
  const gohlCount = diverseNames.filter(n => n.startsWith('Gohl')).length;
  if (gohlCount > 2) {
    throw new Error(`Expected at most 2 Gohl bus stops, got ${gohlCount}: ${JSON.stringify(diverseNames)}`);
  }

  // Other distinct corridors (Wasen, Bärau, etc.) must be included because Gohl stopped at 2
  if (!diverseNames.includes('Wasen i.E., Sparenegg') && !diverseNames.includes('Bärau, Dorf')) {
    throw new Error(`Other diverse corridors were not included: ${JSON.stringify(diverseNames)}`);
  }

  console.log('Test 18: Line prefix diversity & railway hub prioritization: PASS');

  // Test 19: Hub prioritization and boundary pruned alternates tracking
  const hubCandidates = [
    { id: 'b1', name: 'Sundlauenen, Geisskilche', type: 'bus', distM: 950 },
    { id: 'b2', name: 'Sundlauenen, Balmholz', type: 'bus', distM: 1060 },
    { id: 'b2_mid', name: 'Sundlauenen, MidStop', type: 'bus', distM: 1500 },
    { id: 'b3', name: 'Sundlauenen, Pilgerweg', type: 'bus', distM: 1930 },
    { id: 'b3_far', name: 'Sundlauenen, FarEnd', type: 'bus', distM: 3200 },
    { id: 'b4', name: 'Merligen, Nastel', type: 'bus', distM: 1200 },
    { id: 'spiez', name: 'Spiez, Bahnhof', type: 'train', tags: { railway: 'station' }, distM: 6840 },
  ];

  // Request 3 stops: Sundlauenen Geisskilche (1 bus), Merligen Nastel (1 bus), Spiez Bahnhof (major train hub)
  const hubResult = Geo.prioritizeDiverseStops(hubCandidates, 3, { maxPerPrefix: 1 });
  const hubNames = hubResult.map(s => s.name);
  console.log('Test 19: Hub prioritization result:', hubNames);

  if (!hubNames.includes('Spiez, Bahnhof')) {
    throw new Error(`Major hub Spiez Bahnhof was not selected: ${JSON.stringify(hubNames)}`);
  }

  // Sundlauenen Geisskilche should have Balmholz, MidStop, Pilgerweg, and FarEnd in prunedAlternates
  const sundlauenenStop = hubResult.find(s => s.name.startsWith('Sundlauenen'));
  if (!sundlauenenStop || !Array.isArray(sundlauenenStop.prunedAlternates) || sundlauenenStop.prunedAlternates.length < 4) {
    throw new Error(`Pruned alternates not properly attached to Sundlauenen: ${JSON.stringify(sundlauenenStop?.prunedAlternates)}`);
  }

  // Unit check Geo.selectClusterBoundaryAlternates
  const testAlts = [
    { id: '1', distM: 2000 },
    { id: '2', distM: 1000 },
    { id: '3', distM: 5000 },
    { id: '4', distM: 3000 },
  ];
  const boundaries = Geo.selectClusterBoundaryAlternates(testAlts);
  if (boundaries.length !== 2 || boundaries[0].id !== '2' || boundaries[1].id !== '3') {
    throw new Error(`selectClusterBoundaryAlternates did not pick closest (1000m) and furthest (5000m): ${JSON.stringify(boundaries)}`);
  }

  // Simulate Sundlauenen Geisskilche has no service: boundary alternates (closest & furthest only) are re-added
  sundlauenenStop.transit = { hasSchedule: false, success: false };
  sundlauenenStop.totalTripMinutes = Infinity;

  const remainingInCorridor = hubResult.filter(s => s.corridorKey === sundlauenenStop.corridorKey && s !== sundlauenenStop);
  const hasActiveCandidate = remainingInCorridor.some(s => s.transit === undefined || (s.transit?.hasSchedule && isFinite(s.totalTripMinutes)));
  if (!hasActiveCandidate && sundlauenenStop.prunedAlternates?.length > 0) {
    const available = sundlauenenStop.prunedAlternates.filter(p => !hubResult.some(s => s.id === p.id));
    const toAdd = Geo.selectClusterBoundaryAlternates(available);
    sundlauenenStop.prunedAlternates = [];
    hubResult.push(...toAdd);
  }

  const recoveredNames = hubResult.map(s => s.name);
  // Must include Balmholz (closest, 1060m) and FarEnd (furthest, 3200m)
  if (!recoveredNames.includes('Sundlauenen, Balmholz') || !recoveredNames.includes('Sundlauenen, FarEnd')) {
    throw new Error(`Boundary alternates were not recovered after no-service detection: ${JSON.stringify(recoveredNames)}`);
  }
  // Must NOT include the intermediate stops (MidStop, Pilgerweg) to prevent querying too many stops
  if (recoveredNames.includes('Sundlauenen, MidStop') || recoveredNames.includes('Sundlauenen, Pilgerweg')) {
    throw new Error(`Intermediate stops should have been skipped, but found in recovered: ${JSON.stringify(recoveredNames)}`);
  }

  console.log('Test 19: Hub prioritization and boundary alternates recovery: PASS');

  // Test 20: Effective time parsing & combined density score prioritization
  // 20a: parseEffectiveTime variations
  const now = new Date();
  const defTime = Geo.parseEffectiveTime(null);
  if (Math.abs(defTime.getTime() - now.getTime()) > 5000) {
    throw new Error(`Default effective time should be close to now: ${defTime}`);
  }

  const parsedHHMM = Geo.parseEffectiveTime('14:30');
  if (parsedHHMM.getHours() !== 14 || parsedHHMM.getMinutes() !== 30 || parsedHHMM.getSeconds() !== 0) {
    throw new Error(`Failed to parse HH:MM: got ${parsedHHMM.toTimeString()}`);
  }

  const parsedHHMMSS = Geo.parseEffectiveTime('08:45:15');
  if (parsedHHMMSS.getHours() !== 8 || parsedHHMMSS.getMinutes() !== 45 || parsedHHMMSS.getSeconds() !== 15) {
    throw new Error(`Failed to parse HH:MM:SS: got ${parsedHHMMSS.toTimeString()}`);
  }

  const unixSec = Geo.parseEffectiveTime('1700000000');
  if (unixSec.getTime() !== 1700000000000) {
    throw new Error(`Failed to parse Unix seconds timestamp: got ${unixSec.getTime()}`);
  }

  const isoTime = Geo.parseEffectiveTime('2026-10-18T12:00:00Z');
  if (isoTime.toISOString() !== '2026-10-18T12:00:00.000Z') {
    throw new Error(`Failed to parse ISO time string: got ${isoTime.toISOString()}`);
  }

  // 20b: combinedDensityScore prioritization
  const densityStops = [
    { id: 'hub_spiez', name: 'Spiez, Bahnhof', type: 'train', distM: 6000, combinedDensityScore: 65, hubTier: 'Tier 1' },
    { id: 'local_stop', name: 'Sundlauenen, Pilgerweg', type: 'bus', distM: 1000, combinedDensityScore: 1, hubTier: 'Local' },
  ];
  // Spiez is 6000m away, but has score 65 -> discount 65 * 120 = 7800m -> effective -1800m
  // Local stop is 1000m away, score 1 -> discount 120m -> effective 880m
  const topStop = Geo.prioritizeDiverseStops(densityStops, 1);
  if (topStop.length !== 1 || topStop[0].id !== 'hub_spiez') {
    throw new Error(`Expected high-density hub Spiez to be prioritized over local stop: ${JSON.stringify(topStop)}`);
  }

  console.log('Test 20: Effective time parsing & combined density scoring: PASS');

  console.log('✅ ALL GEODESIC AND FORMULA TESTS PASSED!');
}

runTests();

