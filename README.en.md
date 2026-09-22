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

## Features

- **Selection map** (OpenStreetMap) with a hierarchical UTM grid: peninsula → 100 km cells → 10 km cells →
  2 km blocks. Each block shows its state: ready, partial, downloaded but not processed, downloadable, no direct
  link, or no data.
- **Place search** (Nominatim), rectangle selection with a block table, and blocks from neighbouring cells.
- **Automatic download and processing** where a public direct link exists (Castilla y León, geoEuskadi).
  Elsewhere, step-by-step help for the CNIG download centre; LAZ files you save to *Downloads* are detected.
- **3D terrain view**: DTM (ground) or DSM (with buildings and vegetation), per-pixel hillshade, color by
  height, slope, grey or **PNOA orthophoto**, free vertical exaggeration (and a separate one for objects),
  seamless joins between blocks.
- Configurable **contour lines** (interval or specific elevation, color, width, pattern).
- Compass, editable color scale bar (double-click) and **photo mode** (hides the UI, exports PNG).
- **Point cloud** view (COPC) with on-demand loading and class filtering.

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
2. Select blocks (click or rectangle) and press **Descargar** (download). The app downloads and builds the terrain.
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

## Contributing

Issues and pull requests are welcome. Run `npm test` before submitting changes.

## Licence

Code released under the [MIT](LICENSE) licence. Dependencies keep their own licences (three.js, copc.js and
Vite: MIT; laz-perf: Apache-2.0). Downloaded data follow their providers' licences.
