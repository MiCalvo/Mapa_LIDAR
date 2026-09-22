# Mapa LiDAR

[Castellano](README.md) · **English**

A local LiDAR terrain viewer for Spain. Pick 2×2 km blocks on a map; the app downloads and processes the
available PNOA-LiDAR data and shows it in 3D as a shaded relief, with contour lines, an editable color scale or
an orthophoto on top. Everything runs on your own computer: no external server and no account.

![3D terrain view](docs/captura.jpg)

*1 m terrain over 6×6 km (9 PNOA blocks), colored by height, ×2.5 relief and 10 m contours. Data: PNOA-LiDAR 2021 © IGN / Junta de Castilla y León (CC BY 4.0).*

> Status: **v0.3, experimental.** Mostly used on Windows. Some parts (orthophoto from the real IGN WMS,
> geoEuskadi downloads) have seen little testing; see [Limitations](#limitations).
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

### 5. Photo mode

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
| © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | Base map (ODbL) and search (Nominatim) |

Public services: the base map uses the OpenStreetMap tile servers and search uses Nominatim, both under
fair-use policies (the app limits search to 1 request/s and caches results). For heavy or shared use, run your
own tile or geocoding server.

## Limitations

- Automatic download only works where a public direct link exists. In Castilla y León, the CE and NW blocks in
  the official list returned 403 when last tested; CNIG offers no documented public API.
- Orthophoto from the real IGN WMS and geoEuskadi downloads: lightly tested.
- Converting a 25–40 M point block to COPC may need 3–4 GB of RAM.
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
