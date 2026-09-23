# Mapa LiDAR

[Castellano](README.md) · **English**

A local LiDAR terrain viewer for Spain. Pick 2×2 km blocks on a map; the app downloads and processes the
available PNOA-LiDAR data and shows it in 3D as a shaded relief, with contour lines, an editable color scale or
an orthophoto on top. It also includes tools to inspect terrain points and to study where a gravity canal (aqueduct)
could carry water. Everything runs on your own computer: no external server and no account.

![3D terrain view](docs/captura.jpg)

*1 m terrain over 6×6 km (9 PNOA blocks), colored by height, ×2.5 relief and 10 m contours. Data: PNOA-LiDAR 2021 © IGN / Junta de Castilla y León (CC BY 4.0).*

> Status: **v0.4, experimental.** Mostly used on Windows. Some parts (automatic geoEuskadi
> downloads) have seen little testing; see [Limitations](#limitations).
> The user interface is in Spanish.

> **Want it for your country or region?** See [Adapt it to your region](#adapt-it-to-your-region).

## What it can do

### 1. Selection map

The app opens on an OpenStreetMap map with the official UTM grid of LiDAR blocks. You drill down through
levels, like layers: **Peninsula** (UTM zones and 100 km squares) → **100 km** (10 km cells) → **10 km**
(2×2 km blocks) → **3D** (terrain of the chosen blocks). Arrows in the level selector move up and down, with
animated zoom between levels.

| Peninsula and cells | 2 km blocks |
| --- | --- |
| ![Peninsula level](docs/mapa-peninsula.jpg) | ![Block level](docs/mapa-bloques.jpg) |

- **Per-block state** shown by color: terrain ready, partial, downloaded but not processed, downloadable, in the
  catalogue but link unavailable, or no automatic download.
- **Place search** (Nominatim): centres the map and drops a marker.
- **Neighbouring cells**: at the 10 km level the surrounding blocks are shown too (greyed) and can be selected;
  arrows on the edges jump to the adjacent cell.
- **Area selection**: draw a rectangle to get a table of every block inside, its state and what to do with it
  (download, process, view in 3D, or how to get it).
- **Automatic download and processing** where a public direct link exists (Castilla y León and geoEuskadi): the
  app downloads the LAZ files, turns them into terrain with Python and marks them ready. A job queue shows progress.
- **Rest of Spain**: for each block, help with the link to the CNIG download centre, the coordinates to find it
  and the steps. LAZ files you save to your *Downloads* folder are detected and can be processed.

| Area selection | Help for blocks without direct download |
| --- | --- |
| ![Area selection](docs/mapa-seleccion.jpg) | ![CNIG help](docs/mapa-ayuda.jpg) |

### 2. 3D terrain view

- **Ground (DTM) or With objects (DSM)**: bare terrain, or with buildings and trees. In the DSM, objects have
  their own vertical exaggeration ("Objetos ×"), separate from the relief's.
- **Color**: by height (with an editable color scale), by slope, grey (shading only) or **PNOA orthophoto** from
  IGN draped over the relief.
- **Relief ×**: free vertical exaggeration (type any value, e.g. 32).
- **Light**: sun direction for the hillshade.
- Several blocks join **seamlessly**: edges are computed with the neighbouring block's data.
- **Scale bar** at the bottom with real heights; double-click to change colors and range.
- **Compass**: shows north; click it to turn the view to north.

| Orthophoto over the relief | With objects (buildings and trees) |
| --- | --- |
| ![Orthophoto](docs/3d-ortofoto.jpg) | ![With objects](docs/3d-objetos.jpg) |

### 3. Contour lines

Editable list of contours: **every N metres** or **at a specific elevation**, each with its own color, width
and pattern (solid, dashed, dotted, dash-dot). Quick buttons for 1, 2, 5, 10 and 25 m with index contours.

![Slope coloring with 10 m contours](docs/3d-pendiente.jpg)

### 4. Point cloud

View of the original LiDAR point cloud (COPC format), loaded in parts by distance. Real color (RGB), by
class, by height or by intensity; class filter (ground, vegetation, buildings, water…); adjustable quality and
point size.

![Point cloud in real color](docs/puntos.jpg)

### 5. Point inspector

With the pin button, every click on the terrain shows the coordinates (UTM and latitude/longitude, with copy
buttons), the ground elevation, the surface elevation when "Con objetos" is on, and the slope.

![Terrain point details](docs/punto.jpg)

### 6. Gravity canal: aqueducts

A tool to study where water could be taken from a spring, the way Roman engineers did. Everything is computed on
the LiDAR DTM.

- **Spring only:** traces, to both sides of the hillside, the canal that keeps descending at a constant gradient
  while hugging the terrain, going around every gully.
- **Spring, waypoints and destination:** the route is built **in legs**. Each leg starts at the elevation where the
  previous one arrived and can be a **canal** or a **siphon**.
- **Alternative routes:** on canal legs up to three routes are searched (least work, balanced, most direct) with a
  least-cost path search, like a map navigator, except the cost is construction work instead of time. You pick one
  and the rest of the route is recomputed.
- **Work shown by color:** blue along the hillside, red where a bridge or embankment would be needed, orange where a
  deep cut or tunnel would, purple for drops, and teal for siphons.
- **Siphon suggestions:** if a route needs a bridge taller than a set threshold (50 m by default), the app flags it
  and, if you accept, turns that stretch into a siphon and recomputes what follows. The decision is yours.
- **Per-leg figures:** length, drop, average gradient, metres of work and maximum height; for siphons, depth and
  approximate pressure as well.
- **Adjustable parameters:** minimum and maximum gradient, tolerance, siphon threshold and siphon head loss.

![Multi-leg route with a siphon](docs/canal.jpg)

> The default values (gradients, bridge threshold, siphon head loss) are reasonable starting points, not historical
> data: check them against your own sources. The route is an **approximation**: the canal elevation depends on the
> path taken, so the search does not guarantee the exact optimum.

### 7. Known springs

Optional layer with inventoried springs, on the map (10 km level) and in 3D:

- **IGME** water points database: place name, elevation, reference flow and municipality.
- **OpenStreetMap** nodes tagged `natural=spring`.

Clicking one shows its data, compares the source elevation with the LiDAR one, and lets you use it directly as the
canal's spring. Queries are cached in `data/manantiales`.

![Springs over the terrain](docs/manantiales.jpg)


### 8. Photo mode

Hides the interface (you choose what stays: compass, scale, attribution…) for clean screenshots, and saves the
3D view as PNG. `Esc` to exit.

![Photo mode](docs/modo-foto.jpg)

*Screenshots: PNOA terrain and orthophoto © IGN / Junta de Castilla y León (CC BY 4.0); base map ©
OpenStreetMap contributors.*

## Requirements

- [Node.js](https://nodejs.org/) 20 or later.
- Python 3.10+ with `numpy` and `laspy[lazrs]` to process terrain. The app detects Python and offers a button
  to install the packages; or install them yourself:
  ```
  pip install numpy "laspy[lazrs]"
  ```
- Optional, for COPC point clouds: `pip install -r tools/requirements.txt` (adds `copclib`).
- Disk space: each 2×2 km PNOA block is on the order of hundreds of MB as LAZ.

## Install and run

```
git clone <repository-url>
cd mapa-lidar
npm install
npm run dev          # opens http://localhost:4180
```

On Windows you can use the launchers: `launcher\CrearAccesoDirecto.bat` creates a desktop shortcut,
`launcher\MapaLidar.bat` starts the app (installing dependencies the first time) and `launcher\Detener.bat`
stops the server.

Basic workflow:

1. Search for a place or zoom the map down to the 2 km blocks.
2. Select blocks (click or rectangle) and press **Descargar y procesar** (download and process). The app downloads and builds the terrain.
3. Press the **3D** level to view them in relief.

Manual processing (e.g. LAZ files from CNIG):

```
python tools/lidar2mdt.py data/entrada/<folder>/*.laz --salida data/zonas/<zone> --res 1
python tools/lidar2copc.py data/entrada/BLOCK.laz data/zonas/<zone>/BLOCK.copc.laz   # point cloud
```

`python tools/lidar2mdt.py -h` describes the options (`--res`, `--nombre`, `--extension`, `--huso`…).

### Environment variables

| Variable | Purpose |
| --- | --- |
| `MAPA_LIDAR_DATOS` | Zones folder (default `data/zonas`) |
| `MAPA_LIDAR_PYTHON` | Path to the Python interpreter used for processing |
| `MAPA_LIDAR_WMS_ORTO` | Alternative WMS for the orthophoto |

## How it works

```
Official catalogues ──LAZ download──▶ data/entrada ──tools/lidar2mdt.py──▶ data/zonas/<zone>/*.mdt.bin, *.mds.bin
                                                   └─tools/lidar2copc.py─▶ data/zonas/<zone>/*.copc.laz
data/zonas ──server/ (Vite middleware: /api/…, Range requests)──▶ browser (three.js + GLSL shaders)
```

- `server/`: block catalogue, download/processing queue, search and orthophoto proxies (cached).
- `src/`: user interface (map, panels) and 3D viewer (`src/viewer`).
- `tools/`: Python converters (DTM/DSM grid with hole filling; COPC).
- Grids are little-endian Float32, row 0 = south; metadata lives in `*.terreno.json`.

Tests: `npm test`.

## Data and attribution

The app **ships no data**: everything is downloaded when you use it and stored in `data/` (ignored by Git). The
data have their own licences and terms; check them before redistributing anything derived from them.

| Source | Used for |
| --- | --- |
| PNOA-LiDAR, © Instituto Geográfico Nacional (IGN) / CNIG | LiDAR point clouds |
| [Lidar PNOA2 Castilla y León](https://open.scayle.es/dataset/lidar-pnoa) (Junta de Castilla y León) | Direct block downloads |
| [geoEuskadi](https://www.geo.euskadi.eus/) (Basque Government) | Direct tile downloads (licence not confirmed) |
| [CNIG download centre](https://centrodedescargas.cnig.es/) | Rest of Spain (manual download) |
| PNOA orthophoto, IGN WMS (`www.ign.es/wms-inspire/pnoa-ma`) | "Foto" texture; CC BY 4.0, scne.es |
| [IGME water points database](https://info.igme.es/catalogo/resource.aspx?portal=1&catalog=3&ctt=1&lang=spa&master=infoigme&resource=38) | Springs layer (check their terms of use) |
| © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | Base map, search (Nominatim) and `natural=spring` springs (ODbL) |

Public services: the base map uses the OpenStreetMap tile servers and search uses Nominatim, both under
fair-use policies (the app limits search to 1 request/s and caches results). For heavy or shared use, run your
own tile or geocoding server.

## Limitations

- Automatic download only works where a public direct link exists. In Castilla y León, the CE and NW blocks in
  the official list returned 403 when last tested; CNIG offers no documented public API.
- Orthophoto from the real IGN WMS and geoEuskadi downloads: lightly tested.
- Converting a 25–40 M point block to COPC may need 3–4 GB of RAM.
- Canal routes are approximations, not guaranteed optima, and the historical parameters (gradients, siphons) are
  assumptions worth checking against your own sources.
- The springs layer depends on third-party public services: if they are down, the app says so.
- The `.bat` launchers are Windows-only; elsewhere use `npm run dev`.

## Adapt it to your region

Mapa LiDAR was built for Spain, but most of it works anywhere with open LiDAR: the 3D viewer, contour lines,
point cloud view and the `tools/lidar2mdt.py` converter work with any classified LAZ/LAS file in UTM
coordinates. What is Spain-specific:

- the **download catalogue** (PNOA Castilla y León, geoEuskadi) and the CNIG help,
- the map **grid** (UTM zones 29–31 and 2×2 km blocks in ETRS89),
- the **orthophoto** (IGN WMS; already configurable with `MAPA_LIDAR_WMS_ORTO`),
- and the **user interface**, which is in Spanish.

**If your country or region publishes LiDAR openly and you'd like to add it, you're very welcome!** Another
region of Spain, another country with open data (many publish it), or a translation of the interface: it all
helps. [CONTRIBUTING.md](CONTRIBUTING.md) explains where each piece lives and how to add a new source. Open an
issue describing the data you'd like to add and we'll work it out together.

## Contributing

Issues and pull requests are welcome; the guide is in [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` before
submitting changes.

## Licence

Code released under the [MIT](LICENSE) licence. Dependencies keep their own licences (three.js, copc.js and
Vite: MIT; laz-perf: Apache-2.0). Downloaded data follow their providers' licences.
