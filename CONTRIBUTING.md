# Contributing / Cómo contribuir

[English](#english) · [Castellano](#castellano)

## English

Thanks for your interest! Bug reports, ideas and pull requests are all welcome. The most useful contribution
right now is **adding LiDAR sources for other regions and countries**.

### Before you start

- Open an **issue** describing what you want to add (data source, feature, translation). For a new source,
  include: the download page, the licence, the file naming/tiling scheme and the coordinate system.
- Run `npm install` and `npm test`. Keep the tests passing and add tests for new parsers.
- Code and comments are currently in Spanish. English is fine in new code and in discussions.

### Where things live

| Piece | File | Notes |
| --- | --- | --- |
| Source metadata (name, list URL, licence, local folder, grid resolution) | `server/catalogo.js` → `FUENTES` | One entry per source |
| Catalogue parsers (file list → 2×2 km blocks) | `server/catalogo.js` → `parsearCyl`, `parsearTeselasEus` | Blocks are keyed by `clave(huso, x, y)`: UTM zone + **lower-left** corner in km (even numbers) |
| Catalogue download and cache (30 days in `data/catalogos`) | `server/servicio.js` → `cargarCyl`, `cargarEus`, `cargarCatalogos` | |
| Block download job | `server/servicio.js` → `hacer()` | One branch per source |
| Block states (combines local files and catalogues) | `server/catalogo.js` → `estados`, `indiceLocal` | |
| Map grid and levels | `src/ui/mapa.js` (`HUSOS = [29, 30, 31]`), `server/catalogo.js` (`BLOQUE_KM`, `CELDA_KM`) | The top level currently shows the Iberian Peninsula |
| Manual download help (CNIG) | `src/ui/manual.js` | |
| Orthophoto WMS | `server/servicio.js` → `servirOrto` | URL via `MAPA_LIDAR_WMS_ORTO`; layer `OI.OrthoimageCoverage` and CRS `EPSG:258<zone>` (ETRS89 / UTM) are hard-coded |
| Terrain grids from LAZ | `tools/lidar2mdt.py` | Generic: uses ASPRS classes (2 ground, 9 water; 7/18 noise). Works with any classified LAZ/LAS in UTM |
| 3D viewer and shaders | `src/viewer/` | |
| Gravity canal: contour-following trace | `src/analisis/canal.js` | Pure functions, no three.js |
| Gravity canal: route search and siphons | `src/analisis/ruta.js` (+ `ruta.worker.js`) | A* on a grid; cost = work |
| Canal UI (legs, options, suggestions) | `src/ui/canal.js` | |
| Springs layer (IGME, OpenStreetMap) | `server/manantiales.js`, `src/ui/manantiales.js` | Cached per 0.1° tile in `data/manantiales` |
| Terrain sampling, picking, active tool | `src/viewer/picar.js` | Shared by the canal and the point inspector |

### Adding a new LiDAR source (current, manual way)

There is no plugin system yet: sources are wired by hand. The steps, following the two existing sources:

1. Add an entry to `FUENTES` in `server/catalogo.js`.
2. Write a parser that turns the provider's file list into a `Map` from `clave(huso, x, y)` to a list of
   `{ url, fichero }` (plus any extra fields you need). If tiles are smaller than 2 km, group them per block as
   `parsearTeselasEus` does; if they are 2 km but named by another corner, convert as `parsearCyl` does.
3. In `server/servicio.js`, add a loader like `cargarCyl` (download + cache), register it in `cargarCatalogos`,
   and add a branch in `hacer()` that downloads the files for a block.
4. Add a test with a small sample of the provider's listing to `test/catalogo.test.mjs`.
5. If the region is outside UTM zones 29–31 or not in ETRS89, the map grid, the zone list and the orthophoto CRS
   need adjusting too.
6. Document the source and its licence in the README ("Data and attribution").

A pull request that turns sources into a simple, declarative configuration (so that new regions don't need
code changes) would be very welcome.

### Other good contributions

- **Translation of the interface** (texts are in `index.html` and `src/ui/*.js`; there is no i18n system yet).
- Launchers for macOS/Linux (only Windows `.bat` files exist).
- Testing on other systems and reporting what breaks.

---

## Castellano

¡Gracias por el interés! Se agradecen avisos de fallos, ideas y *pull requests*. Lo más útil ahora mismo es
**añadir fuentes de LiDAR de otras regiones y países**.

- Abre primero un *issue* con lo que quieres añadir. Para una fuente nueva: página de descarga, licencia,
  cómo se llaman y reparten los ficheros y el sistema de coordenadas.
- `npm install` y `npm test`; los tests deben seguir pasando, y conviene añadir uno por cada parser nuevo.
- La tabla de arriba («Where things live») indica dónde está cada pieza. Para añadir una fuente: entrada en
  `FUENTES`, un parser que convierta el listado en bloques de 2×2 km (clave: huso + esquina **inferior**
  izquierda en km), su carga y caché en `server/servicio.js` (`cargarCatalogos`), una rama de descarga en
  `hacer()`, un test y la atribución en el README.
- Fuera de los husos 29–31 o sin ETRS89 hay que ajustar también la cuadrícula del mapa y el CRS de la ortofoto.
- También se agradecen: traducción de la interfaz, lanzadores para macOS/Linux y pruebas en otros sistemas.
