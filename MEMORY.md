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


