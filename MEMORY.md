# Take Me Home — Architectural Memory & System Design

This document is the source of truth for architectural decisions, system design, domain models, and tricky edge cases. All agents working on this project must consult this file before making design changes and update it whenever new context or architectural trade-offs are established.

---

## 1. Project Overview & Architecture

**Take Me Home** is a 100% client-side, serverless web application designed for paraglider, hang glider, and sailplane pilots. Given current pilot coordinates and altitude:
1. Discovers nearby public transport stops via Overpass API.
2. Fetches ground elevation via Open-Meteo Elevation API to compute glide ratio ($L/D$).
3. Computes straight-line flight reach time with packing buffer.
4. Queries public transit timetables (Transitous / MOTIS v2) to the pilot's final destination.
5. Identifies the fastest overall route home and explores continuing down-corridor stops.

### Core Modules & Responsibilities

| File | Role |
|---|---|
| `index.html` | High-contrast, mobile-first responsive layout; Leaflet map viewport; collapsible chip header; progress overlay; tapped stop details card. |
| `css/styles.css` | High-visibility outdoor theme (dark slate `#0f172a`), badge status styling, pill markers, mobile touch targets. |
| `js/app.js` | App state manager, calculation pipeline orchestrator, sequential transit querying, progressive live map rendering, down-corridor follow-up queries. |
| `js/geo.js` | Geodesic math (Haversine, initial bearing), glide ratio calculations, reach times, stop similarity detection (`areSimilarStops`), stop ranking, SBB/Google Maps deep-link generation. |
| `js/overpass.js` | Overpass QL query generation, multi-mirror failover, stop parsing, platform deduplication, corridor stop discovery (`findFollowingStops`). |
| `js/elevation.js` | Batch elevation lookup via Open-Meteo API. |
| `js/transit.js` | Transitous / MOTIS v2 routing engine interface, itinerary parsing, wait time / transfer calculation. |
| `js/tiers.js` | Correlated arrival & departure smart color tiers (ranking options by earliest arrival, then latest departure). |
| `js/map.js` | Leaflet map controller, Mapterhorn 3D hillshading (MapLibre GL + Terrarium DEM), in-place DOM marker updating (prevents map blinking). |
| `js/util.js` | Shared utility functions (`fetchWithTimeout`, `throwIfAborted`, `escapeHtml`). |
| `serve.py` | HTTPS development server (port 8443) with self-signed TLS certificates for mobile Geolocation API access. |

---

## 2. Domain Models & Formulas

### Geodesics & Bearing
- **Haversine Distance**: Computes earth surface distance ($R = 6371.0088\text{ km}$).
- **Initial Bearing**: Computes initial heading $\theta \in [0^\circ, 360^\circ)$ between two points:
  $$\theta = \text{atan2}(\sin(\Delta\lambda)\cos(\phi_2), \cos(\phi_1)\sin(\phi_2) - \sin(\phi_1)\cos(\phi_2)\cos(\Delta\lambda))$$

### Glide Ratio ($L/D$) & Feasibility
$$\text{L/D} = \frac{\text{Horizontal Distance (meters)}}{\text{Pilot Altitude (m)} - \text{Stop Ground Elevation (m)}}$$
- **Reachable (🟢 Green)**: $L/D \le \text{threshold} - 0.5$ (default $\le 7.5$) — comfortably reachable on standard paraglider.
- **Marginal (🟡 Yellow)**: $\text{threshold} - 0.5 < L/D \le \text{threshold} + 2.0$ (default $7.5 < L/D \le 10.0$) — requires active piloting or speedbar.
- **Unreachable (🔴 Red)**: $L/D > 10.0$ or $\Delta h \le 0$ (uphill landing).

### Reach Time & Offset Departure
$$t_{\text{reach}} = \left(\frac{d_{\text{km}}}{\text{speed}_{\text{km/h}}}\right) \times 60 + \text{buffer}_{\text{min}} \quad (\text{defaults: } 30\text{ km/h speed}, 30\text{ min pack buffer})$$
$$\text{Target Departure Date} = \text{Current Time} + t_{\text{reach}}$$
Timetable queries search for transit departures at or shortly after $\text{Target Departure Date}$, calculating:
$$\text{Total Trip Time} = t_{\text{reach}} + \text{Wait At Stop} + \text{Transit Duration}$$

---

## 3. Key Design Decisions & Tricky Edge Cases

### A. "Similar" Stops vs. Sequential Bus Stops
- **The Problem**: A naive spatial dispersion algorithm using large distance tiers (e.g. 800m, 2000m, 3000m) stripped out major train stations across town (e.g., Interlaken West 1.5 km from Interlaken Ost) and pruned consecutive bus stops (which are typically 200–350m apart).
- **The Solution (`Geo.areSimilarStops`)**:
  1. **Micro-Distance ($\le 120\text{ m}$)**: Stops within 120m are on opposite sides of the street, opposite corners of an intersection/plaza (e.g. *Zentralplatz* vs *Jungfraustrasse*, 75m), or adjacent ferry piers (*Ländte 1/2/3/4*). These are "Similar" and pruned.
  2. **Station Forecourt Loop ($\le 200\text{ m}$)**: A bus stop right outside a railway station named after the station is pruned in favor of the train hub.
  3. **Name Similarity ($\le 250\text{ m}$)**: Stops sharing identical or sub-name stems within platform distance are pruned.
  4. **Sequential Stops ($\ge 150\text{ m}$ with distinct names)**: Consecutive stops along a bus line (e.g. *Sonnenhof*, *Kursaal*, *Drei Tannen*) are **not similar** and **both are explored**.
  5. **Train Station Protection**: Distinct train stations (like *Interlaken Ost* and *Interlaken West*) are never pruned by bus stops or by each other unless within 500m.

### B. Down-Corridor Exploration (`findFollowingStops`)
- **Rationale**: When a paraglider pilot is flying towards the best-ranked stop and has altitude to spare, landing at the first stop may not be optimal if gliding 3–8 km further down the valley/flight line reaches a faster express train station or a subsequent stop on the same transit line.
- **Direction of Travel (Transit Route & Destination Vector vs. Pilot Vector)**:
  - **Critical Trap**: Never use the `pilot -> bestStop` bearing as the corridor direction vector! If the best stop is slightly behind or lateral to the pilot (e.g. pilot at Gohl ridge, best stop in valley at Gohl Houetershus to the West), extending `pilot -> bestStop` points backwards into uninhabited dead-end valleys (e.g. Oberfrittenbach) yielding 35+ hour trip times.
  - **Priority 1 (Scheduled Line Stops)**: The primary source for the 3 following stops is `firstTransitLeg.intermediateStops` and `firstTransitLeg.to` from the transit routing engine (e.g. `BUS 285` towards `Wasen i.E.`). These subsequent stops on the actual vehicle route save the pilot hundreds of minutes of travel time with zero timetable penalty.
  - **Priority 2 (Corridor Extension)**: If fewer than 3 stops exist on the line, stops are queried from Overpass along the transit departure direction or directly towards the final destination (`Geo.bearingDegrees(bestStop, destination)`), explicitly filtering out any stops whose distance to the destination increases.
  - **Glide Horizon Ceiling (1:17)**: Down-corridor stops beyond 1:17 glide ($L/D > 17$ or uphill) are **never shown**. If a corridor candidate cannot be reached within a 1:17 glide, it is pruned before rendering on the map or querying timetables.
- **Workflow**:
  1. Initial candidate stops are queried and ranked.
  2. Best stop (`#1`, fastest confirmed total trip within glide) is identified.
  3. `Overpass.findFollowingStops(pilot, bestStop, 6, stops, signal, destination)` discovers candidate stops along the transit line or destination corridor.
  4. Candidate stops have terrain elevations and glide ratios calculated. Candidates beyond 1:17 glide ($L/D > 17$ or uphill) are discarded. Up to 3 viable stops within 1:17 glide are added to the map and have transit schedules queried sequentially.

### C. Overpass API Mirroring & Headers
- **Mirror List**: `osm.ch`, `openstreetmap.fr`, `overpass-api.de`, `lz4.overpass-api.de`, `kumi.systems`.
- **Mandatory User-Agent**: Several Overpass mirrors (e.g. `openstreetmap.fr` returns 403, `overpass-api.de` returns 406) reject requests missing a `User-Agent`. Always send:
  `'User-Agent': 'TakeMeHome/1.0 (https://github.com/artem/take-me-home)'`

### D. Mobile GPS & HTTPS Requirements
- Mobile WebKit and Chromium restrict `navigator.geolocation.getCurrentPosition` strictly to secure contexts (`https://` or `localhost`).
- `serve.py` uses pre-generated certificates in `cert/cert.pem` and `cert/key.pem` to serve HTTPS on port 8443 across the local Wi-Fi network.

### E. Leaflet In-Place DOM Marker Updates
- To prevent map markers from blinking or disappearing during progressive sequential transit schedule streaming, `MapManager.renderStops` updates existing Leaflet DOM elements (`.setZIndexOffset()`, `.querySelector()`) in-place rather than destroying and recreating layers.

### F. 16-Hour Transit Availability Horizon
- **Rule**: Any transit connection departing or with a wait time greater than 16 hours from the target departure time is treated as **not available** (`hasSchedule: false`, `summary: 'No service within 16h'`, `totalTripMinutes: Infinity`).
- **Rationale**:
  - Paraglider pilots landing in the late afternoon or evening often take a connection the following morning (~8–12 hours later).
  - However, routes in rural valleys without weekend service (e.g. Oberfrittenbach only running Monday morning) would otherwise return trips 32+ hours away.
  - To prevent long weekend waits from cluttering the rankings and appearing deceptively early on 24-hour clock faces, a strict 16-hour threshold marks them as unavailable.

### G. Glide Horizon Priority & Rating Isolation
- **Ranking Rule**: Stops beyond the glide horizon (`feasibility.status === 'unreachable'`) **never win** against stops within the glide (`reachable` or `marginal`). Confirmed stops within the glide always rank ahead of stops beyond the glide, regardless of whether a beyond-glide stop has a faster transit vehicle.
- **Rating & Color Tier Rule**:
  - Stops within the glide are compared **exclusively against the best stop within the glide**. Outside/unreachable stops are purely informational and cannot downgrade or penalize within-glide options to amber or red.
  - If a stop beyond the glide horizon has the fastest overall arrival, it is highlighted as **blue** (`tier-best`), but does not displace `#1` or affect within-glide stop tiers.

### H. Stop Prioritization: Combined Traffic Density & Official Hierarchy
- **The Problem**: A single rural valley directly below a pilot position (such as Gohl or Sundlauenen/Beatenberg) may contain dozens of small local bus stops, seasonal lake boat docks, and tourist funiculars. A naive proximity sort completely exhausts the candidate stop quota (e.g. `stops=15`) on a single low-frequency line or small village cluster, starving major regional rail hubs slightly further away (e.g. Spiez or Langnau i.E. Bahnhof with direct express trains) from ever being queried.
- **The Solution**:
  1. **Route Relations in Single Overpass Query**:
     - The Overpass query simultaneously fetches candidate stop nodes and their parent route relations in one single query: `rel(bn.stops)["route"~"train|railway|bus|tram|ferry"]; out body;`.
     - Zero extra HTTP round trips; queries complete in ~350–420 ms.
     - Routes are parsed into unique lines categorized into:
       - `icLines` (IC, IR, ICE, TGV, EC, RJX, PE, Eurostar)
       - `regTrainLines` (RE, S, R, S-Bahn, Regionalbahn)
       - `busLines`
       - `otherLines` (tram, ferry, etc.)
  2. **Combined Density Score Formula**:
     - **Route Traffic Density**:
       $$\text{Route Score} = 6 \times |\text{icLines}| + 3 \times |\text{regTrainLines}| + 1 \times \min(8, |\text{busLines}|) + 1 \times \min(4, |\text{otherLines}|)$$
     - **Official OSM Infrastructure Hierarchy**:
       - `railway=station` or `station=train`: +15 pts
       - `wikidata` / `wikipedia` / `wikidata:ref`: +5 pts
       - `railway:ref` / `uic_ref` / `ref`: +5 pts
       - Large platform/stop-position cluster ($\ge 4$ nodes): +5 pts
       - Railway halt (`railway=halt`): +5 pts
     - **Combined Score**:
       $$\text{Combined Score} = \text{Route Score} + \text{Infra Score}$$
     - **Hub Tiers**:
       - Tier 1: Major InterCity Hub (Score $\ge 40$, e.g., Spiez $\approx 65$, Interlaken Ost $\approx 78$)
       - Tier 2: Regional Interchange Hub (Score $\ge 20$, e.g., Wilderswil $\approx 25$, Mülenen $\approx 18$)
       - Tier 3: Minor Station / Rail Halt (Score $\ge 8$)
       - Local: Standard Bus / Tram roadside stop (Score $< 8$)
  3. **Effective Distance Discount**:
     - In `Geo.prioritizeDiverseStops`, each score point discounts the stop's physical distance by **120 meters**:
       $$\text{Effective Priority Distance} = \text{distM} - (\text{combinedDensityScore} \times 120)$$
     - Major hubs like Spiez (65 pts $\times 120\text{m} = 7,800\text{m}$) or Interlaken Ost (78 pts $\times 120\text{m} = 9,360\text{m}$) compete strongly against local single-post bus stops even from 7–9 km away.
     - Fallback: If `combinedDensityScore` is absent (e.g. synthetic test stops), falls back to $-8,000\text{m}$ for railway stations and $-5,000\text{m}$ for railway halts.
  4. **Corridor Prefix Cap (`maxPerPrefix = 1`)**:
     - In Pass 1, bus/tram/ferry stops sharing the same line/corridor prefix (e.g. `Sundlauenen`, `Beatenberg`, `Leissigen`, `Gohl`) are capped at **1 stop** to avoid redundant queries of stops catching the same vehicle.
     - Major hubs (`combinedDensityScore >= 40` or railway stations) are exempt from prefix capping.
  5. **Dynamic Boundary Alternate Recovery for No-Service Stops**:
     - Whenever stops are pruned by `maxPerPrefix`, their candidate objects are retained in `stop.prunedAlternates`.
     - During progressive transit querying, if a corridor's remaining stop turns out to have **no service** (`!transit.hasSchedule || totalTripMinutes === Infinity`), its pruned alternates are re-evaluated.
     - **Cluster Boundary Rule (`Geo.selectClusterBoundaryAlternates`)**: To prevent overwhelming the timetable engine with too many requests when a valley has no service, the app does **not** re-add all pruned stops. Instead, it re-adds **only the closest and the furthest stop in the cluster** relative to the pilot (at most 2 candidates). This tests both ends of the corridor (minimum reach effort and maximum valley penetration/junction) while keeping network overhead minimal.

### I. Time Simulation Parameter (`time`, `fakeTime`, `datetime`)
- **URL Parameter**: `time=HH:MM` (e.g. `time=14:30`), ISO 8601 string (e.g. `datetime=2026-10-18T23:30:00`), or Unix epoch timestamp (`time=1776510000`).
- **Geo.parseEffectiveTime**: Seamlessly parses any of these formats into a JavaScript `Date` object, defaulting to `new Date()` if omitted.
- **Use Case**: Allows pilots and developers to simulate landings at night, early morning, or weekends directly via URL without changing device clocks.

### J. Google Maps Start / Departure Time Format
- **Format**: `https://www.google.com/maps/dir/${originLat},${originLon}/${destLat},${destLon}/data=!3m2!1e3!4b1!4m6!4m5!2m3!6e0!7e2!8j${localEpochSec}!3e3?departure_time=${localEpochSec}`
- **Why this format**:
  - The standard query parameter URL (`?api=1&travelmode=transit&departure_time=...`) is ignored by Google Maps web and mobile, always opening with "Leave now".
  - The exact working Google Maps protobuf path encoding is `!3m2!1e3!4b1!4m6!4m5!2m3!6e0!7e2!8j{TIMESTAMP}!3e3`, where:
    - `!3m2!1e3!4b1`: Viewport configuration
    - `!4m6!4m5`: Directions parameter containers
    - `!2m3!6e0!7e2!8j{TIMESTAMP}`: "Depart at" mode (`!6e0`), time modifier (`!7e2`), and 64-bit Unix timestamp in seconds (`!8j`)
    - `!3e3`: Transit travel mode
  - **Timezone Offset Compensation (`!7e2`)**: The `!7e2` flag instructs Google Maps to interpret the `!8j` timestamp as seconds since 1970-01-01 in the *local* timezone rather than UTC. Therefore, JavaScript's UTC timestamp must be compensated via `d.getTime() - d.getTimezoneOffset() * 60000` so that the local wall-clock time (e.g. 20:00 CEST, UTC+2) matches Google Maps' rendered departure time without a 2-hour drift.
  - Fallback: If no departure date is supplied, falls back to `https://www.google.com/maps/dir/?api=1&origin=...&destination=...&travelmode=transit`.

### K. Mobile PWA Installation, Shortcut Creation & Persistent Configuration
- **The Requirement**: Mobile pilots need a fast 1-tap Home Screen shortcut to immediately route home from wherever they land.
- **Critical Architectural Rules**:
  1. **Never Save Pilot Position in Shortcuts**: The shortcut must **never** save the pilot's takeoff or current coordinates (`lat`, `lon`, `altM`). When the shortcut or PWA launches, `pilotSetInUrl` is `false`, triggering `useCurrentLocation()` to automatically acquire a fresh 3D GPS fix and elevation.
  2. **Persist Destination & Flight Settings**: Destination coordinates, geocoded address, and user settings (`stopsCount`, `searchRadiusKm`, `speedKmH`, `bufferMinutes`, `maxGlideRatio`) are saved in `localStorage` under `takemehome_config`.
  3. **Continuous Shortcut Synchronization**: Modifying settings or setting a new destination updates `localStorage` and cleans the URL (`Storage.saveConfig` / `Storage.prepareForShortcutCreation`). Because PWA standalone windows and browser shortcuts share the same origin storage, existing shortcuts automatically reflect new destinations without needing reinstallation.
  4. **iOS Safari Bookmark URL Sanitization**: Safari's native "Add to Home Screen" captures the current `window.location.href`. To prevent Safari from baking current coordinates into the bookmark, `Storage.prepareForShortcutCreation` executes `history.replaceState` with a clean URL (retaining only `destLat`, `destLon`, and settings) prior to user interaction.
- **Components**:
  - `manifest.json`: Web App Manifest with `start_url: "./"`, `display: "standalone"`, and branded SVG/PNG icons.
  - `sw.js`: Service worker providing app-shell caching for offline startup capability while bypassing live timetable and elevation APIs.
  - `js/storage.js`: Centralized manager for persistent configuration, platform detection (`detectPlatform`), standalone mode checking (`isStandalone`), and clean shortcut URL generation.
  - `#install-modal`: Native-feeling instruction modal tailored with step-by-step visual guidance for iOS Safari and Chromium.

