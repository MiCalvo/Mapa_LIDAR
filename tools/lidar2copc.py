"""LAZ/LAS → COPC (Cloud Optimized Point Cloud) sin PDAL.

Construye el octree por muestreo en rejilla (como untwine, en memoria) y lo
escribe con copclib. Pensado para bloques de hasta ~40 millones de puntos.

Uso:  python lidar2copc.py entrada.laz salida.copc.laz [--res 128] [--max-depth 9]

Requisitos: pip install "laspy[lazrs]" copclib numpy
"""
import argparse
import sys
import time

import copclib as copc
import laspy
import numpy as np


def build_octree(xyz, cmin, size, res, max_depth, rng):
    n = len(xyz)
    order = rng.permutation(n)
    remaining = order
    nodes = {}  # (d, x, y, z) -> índices
    rel = ((xyz - cmin) / size).astype(np.float32)  # 0..1, float32 para ahorrar memoria
    for d in range(max_depth + 1):
        if len(remaining) == 0:
            break
        cells = 1 << d
        r = rel[remaining] * np.float32(cells)
        node = np.minimum(np.floor(r).astype(np.int32), cells - 1).astype(np.int64)
        if d == max_depth:
            take = np.arange(len(remaining))
        else:
            vox = np.minimum(((r - node) * res).astype(np.int32), res - 1).astype(np.int64)
            key = (((node[:, 0] * cells + node[:, 1]) * cells + node[:, 2]) * res * res * res
                   + (vox[:, 0] * res + vox[:, 1]) * res + vox[:, 2])
            _, take = np.unique(key, return_index=True)
        sel = remaining[take]
        nsel = node[take]
        nkey = (nsel[:, 0] * cells + nsel[:, 1]) * cells + nsel[:, 2]
        srt = np.argsort(nkey, kind="stable")
        nkey_s = nkey[srt]
        bounds = np.flatnonzero(np.diff(nkey_s)) + 1
        starts = np.concatenate(([0], bounds))
        ends = np.concatenate((bounds, [len(nkey_s)]))
        for s, e in zip(starts, ends):
            k = int(nkey_s[s])
            x, rest = divmod(k, cells * cells)
            y, z = divmod(rest, cells)
            nodes[(d, x, y, z)] = np.sort(sel[srt[s:e]])
        del r, node
        mask = np.ones(len(remaining), dtype=bool)
        mask[take] = False
        remaining = remaining[mask]
        print(f"  nivel {d}: {len(sel):>10,} puntos en {len(starts):>6,} nodos; quedan {len(remaining):,}", flush=True)
    return nodes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--res", type=int, default=128)
    ap.add_argument("--max-depth", type=int, default=9)
    args = ap.parse_args()

    t0 = time.time()
    las = laspy.read(args.src)
    h = las.header
    pf = h.point_format.id
    if pf not in (6, 7, 8):
        las = laspy.convert(las, point_format_id=8 if pf in (2, 3, 5) else 6)
        h = las.header
        pf = h.point_format.id
    if list(h.point_format.extra_dimension_names):
        raise SystemExit("Dimensiones extra no soportadas en esta versión")
    xyz = np.column_stack((las.x, las.y, las.z)).astype(np.float64)
    print(f"leído {len(xyz):,} puntos (PF{pf}) en {time.time() - t0:.0f}s", flush=True)
    mins, maxs = xyz.min(axis=0), xyz.max(axis=0)
    size = float((maxs - mins).max()) * 1.0001
    cmin = mins
    center = cmin + size / 2

    nodes = build_octree(xyz, cmin, size, args.res, args.max_depth, np.random.default_rng(42))
    del xyz
    print(f"octree: {len(nodes):,} nodos en {time.time() - t0:.0f}s", flush=True)

    scale = copc.Vector3(*[float(s) for s in h.scales])
    offset = copc.Vector3(*[float(o) for o in h.offsets])
    wkt = ""
    try:
        crs = h.parse_crs()
        wkt = crs.to_wkt() if crs else ""
    except Exception:
        pass
    cfg = copc.CopcConfigWriter(pf, scale, offset, wkt)
    cfg.copc_info.center_x, cfg.copc_info.center_y, cfg.copc_info.center_z = map(float, center)
    cfg.copc_info.halfsize = size / 2
    cfg.copc_info.spacing = size / args.res
    cfg.las_header.min = copc.Vector3(*map(float, mins))
    cfg.las_header.max = copc.Vector3(*map(float, maxs))

    raw = las.points.array
    writer = copc.FileWriter(args.dst, cfg)
    for (d, x, y, z), idx in sorted(nodes.items()):
        data = np.ascontiguousarray(raw[idx]).tobytes()
        writer.AddNode(copc.VoxelKey(d, x, y, z), copc.VectorChar(np.frombuffer(data, dtype=np.int8)))
    writer.Close()
    print(f"escrito {args.dst} en {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    sys.exit(main())
