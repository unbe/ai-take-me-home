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

  // 12b: Sequential bus stops preservation - current and next stop of the bus must both be explored
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
  console.log('Test 12b: Selected 4 stops (including current & next bus stop):', selectedNames);

  // Both current stop (Kursaal) and next stop (Post) must be included
  if (!selectedNames.includes('Interlaken Kursaal (Bus)') || !selectedNames.includes('Interlaken Post (Bus)')) {
    throw new Error(`Current and next bus stop were not both kept: ${JSON.stringify(selectedNames)}`);
  }
  // Duplicate platform (< 120m) must be pruned
  if (selectedNames.includes('Interlaken Post Platform 2 (Bus)')) {
    throw new Error(`Duplicate platform was not pruned: ${JSON.stringify(selectedNames)}`);
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

  console.log('✅ ALL GEODESIC AND FORMULA TESTS PASSED!');
}

runTests();
