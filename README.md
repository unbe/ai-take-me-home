# 🪂 Take Me Home

A fast, serverless, mobile-optimized web application for paraglider, hang glider, and sailplane pilots. Given your current coordinates and altitude, it identifies the $N$ nearest public transport stops, calculates your glide ratio ($L/D$) and reachability to each stop, and computes public transit schedules and total travel time to your final destination.

---

## 🌟 Key Features

1. **100% Serverless & Client-Side JavaScript**:
   - Zero backend required. Runs entirely in modern web browsers.
   - Deployable anywhere (GitHub Pages, Cloudflare Pages, Netlify, local static server).
2. **High-Resolution Mapterhorn Terrain Tileset**:
   - Integrates the open-source **[Mapterhorn](https://mapterhorn.com)** global terrain tileset (`tiles.mapterhorn.com/tilejson.json`, Terrarium DEM format).
   - Renders GPU-accelerated 3D hillshading and relief directly beneath OSM labels and flight paths, giving glider pilots relief visualization across mountain terrain.
   - Includes standard OSM and Satellite layers in the top-right layer switcher.
3. **Terrain Elevation & Glide Ratio ($L/D$)**:
   - Queries the open, free Open-Meteo Elevation API in a single batch request to fetch ground elevation for all candidate stops.
   - Computes Glide Ratio:
     $$\text{Glide Ratio} = \frac{\text{Horizontal Distance (meters)}}{\text{Pilot Altitude (m)} - \text{Stop Ground Elevation (m)}}$$
4. **Calculated Reach Time**:
   - Computes time to reach each stop based on straight-line distance at $30\text{ km/h}$ plus a $30\text{-minute}$ pack/buffer time:
     $$t_{\text{reach}} = \left(\frac{d_{\text{km}}}{30}\right) \times 60 + 30\text{ minutes}$$
5. **Spatial Diversity & Cluster Pruning**:
   - Prioritizes stops that are further from each other across different transit corridors, villages, and valleys.
   - Prunes redundant stops clustered within walking distance of each other: avoids querying multiple stops near each other where walking between them yields the same transit outcome.
6. **Public Transit Routing with Offset Departure Time**:
   - Computes target journey departure time: $\text{Departure} = \text{Current Time} + t_{\text{reach}}$.
   - Queries the **Transitous / MOTIS v2** transit engine (free worldwide transit router with CORS support) from each stop to your destination.
   - Calculates transit duration, wait time, intermediate legs, and final destination arrival time.
7. **Mobile-First Cockpit / Field UX**:
   - **Hero Card**: Instantly highlights the **#1 Best Route** with large, bold, high-contrast numbers for immediate glanceability.
   - **Map Marker Badges**: Custom Leaflet pins displaying both **color coding** (🟢 Reachable, 🟡 Marginal, 🔴 Unreachable) and **explicit numbers** ($L/D$ ratio and transit time).
   - **Collapsible Coordinate Bar**: Input forms collapse into a 1-line chip (`📍 1600m ➔ 🏁 Bern [Change]`) to maximize map and results view on small mobile screens.
   - **1-Tap Quick Actions**: GPS locate button and presets for popular flying locations (Interlaken, Annecy, Bassano, Verbier).

---

## 📐 Formulas & Color Coding

### 1. Haversine Distance
$$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)$$
$$c = 2 \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1-a}\right)$$
$$d = R \cdot c \quad (R = 6371.0088\text{ km})$$

### 2. Time to Reach Stop
$$t_{\text{reach}} = \left(\frac{d_{\text{km}}}{30}\right) \times 60 + 30\text{ minutes}$$

### 3. Glide Ratio & Feasibility Thresholds
$$\text{L/D} = \frac{\text{Distance (m)}}{\text{Pilot Alt (m)} - \text{Stop Alt (m)}}$$

| Status | Color | Threshold | Meaning |
|---|---|---|---|
| **Reachable** | 🟢 Green | $L/D \le 7.5$ | Easy glide with standard paraglider |
| **Marginal** | 🟡 Yellow | $7.5 < L/D \le 10.0$ | Needs active piloting or high-performance glider |
| **Unreachable** | 🔴 Red | $L/D > 10.0$ or $\Delta h \le 0$ | Out of glide reach or landing is uphill |

---

## 🚀 Running & Network Access (HTTPS Enabled)

The server runs on **HTTPS** (port `8443`), which is required by mobile browsers (Safari, Chrome) to grant access to the **HTML5 Geolocation GPS API**.

Run the network server:
```bash
./serve.py 8443
# or: python3 serve.py 8443
```

- **Local:** `https://localhost:8443`
- **Mobile / Wi-Fi Network:** `https://192.168.5.15:8443`

> [!NOTE]
> When opening for the first time on your phone, your browser will display a standard self-signed certificate warning. Tap **"Advanced" ➔ "Proceed to 192.168.5.15 (unsafe)"** once to allow the connection. This unlocks native GPS geolocation directly in your mobile browser.

### Map Zoom
- The map automatically zooms and adjusts bounds to focus on the pilot and **all candidate transit stops within 15 km**, keeping landing options in clear view rather than zooming out to far-away destinations.

---

## 🧪 Running Automated Tests

Run unit and formula verification:
```bash
node test/verify.js
```

Run live API integration tests:
```bash
node test/integration.js
```

---

## 📁 File Structure

```
├── index.html          # Main application page (mobile-first layout)
├── css/
│   └── styles.css      # Responsive, high-contrast outdoor styling
├── js/
│   ├── app.js          # Main coordinator & state management
│   ├── geo.js          # Haversine distance, reach time, glide ratio calculations
│   ├── overpass.js     # Overpass API client with multi-mirror fallback
│   ├── elevation.js    # Open-Meteo batch elevation client
│   ├── transit.js      # Transitous / MOTIS v2 public transit router
│   └── map.js          # Leaflet map manager & custom numerical badges
├── test/
│   ├── verify.js       # Unit tests for geodesic math & formulas
│   └── integration.js  # Live API integration tests
└── README.md
```
