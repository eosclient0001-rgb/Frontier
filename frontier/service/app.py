"""HTTP service for the terrain generator.

A deliberately thin layer over :mod:`frontier.pipeline.engine`.  The service is
*not* a node editor: the client sends a :class:`Document` (a fixed, ordered list
of authoring stages) plus strokes/paths, and gets back a rendered satmap, a
hillshade, the height field and statistics.

Endpoints
---------
``GET  /api/presets``            preset documents
``GET  /api/schema``             parameter schema (drives the UI controls)
``POST /api/preview``            bake at a modest resolution, returns images
``POST /api/bake``               bake at production resolution (background job)
``GET  /api/jobs/{id}``          job status / result
``POST /api/export``             write PNG/OBJ/PLY asset set to ./out/<name>
``GET  /assets/{job}/{file}``    rendered artefacts of a finished bake
"""
from __future__ import annotations

import base64
import io
import json
import os
import threading
import time
import uuid
from dataclasses import asdict
from typing import Any, Dict, Optional

import numpy as np

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, Response
    from fastapi.staticfiles import StaticFiles
    from pydantic import BaseModel
except Exception as exc:  # pragma: no cover
    raise SystemExit("pip install fastapi uvicorn") from exc

from ..core.grid import Terrain
from ..pipeline.engine import (Document, BakeResult, PRESETS, bake,
                               SculptStroke, BaseStage, ErosionStage,
                               TextureStage)
from ..spline.path import PathSpec
from ..texture.export import export_all, save_png, export_all as _export_all

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "out"))
os.makedirs(OUT_ROOT, exist_ok=True)

app = FastAPI(title="Frontier terrain generator", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])

# --------------------------------------------------------------------------
# in-process job registry
# --------------------------------------------------------------------------
JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


class BakeRequest(BaseModel):
    doc: Dict[str, Any]
    nx: Optional[int] = None
    ny: Optional[int] = None
    include_sdf: Optional[bool] = None
    run_erosion: Optional[bool] = None


class ExportRequest(BaseModel):
    doc: Dict[str, Any]
    nx: int = 1024
    name: Optional[str] = None
    mesh: bool = False
    hillshade: bool = True
    job: Optional[str] = None      # reuse an already-baked job instead of re-baking


def _doc_from_payload(payload: Dict[str, Any]) -> Document:
    doc = Document.from_json(json.dumps(payload))
    return doc


def _hillshade(z: np.ndarray, cell: float, az_deg: float = 315.0,
               el_deg: float = 38.0, exag: float = 1.6) -> np.ndarray:
    z = z.astype(np.float64) * exag
    gy, gx = np.gradient(z, cell)
    n = np.dstack([-gx, -gy, np.ones_like(z)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    a, e = np.radians(az_deg), np.radians(el_deg)
    L = np.array([np.cos(e) * np.sin(a), np.cos(e) * np.cos(a), np.sin(e)])
    return np.clip(n @ L, 0.0, 1.0)


def _png_b64(arr: np.ndarray) -> str:
    buf = io.BytesIO()
    from PIL import Image
    if arr.dtype != np.uint8:
        a = np.clip(arr, 0.0, 1.0)
        arr = (a * 255.0 + 0.5).astype(np.uint8)
    Image.fromarray(arr).save(buf, format="PNG", optimize=False)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _result_payload(res: BakeResult, with_images: bool = True,
                    preview_scale: int = 0) -> Dict[str, Any]:
    z = res.terrain.z
    payload: Dict[str, Any] = {
        "stats": {k: (float(v) if isinstance(v, (int, float, np.floating)) else v)
                  for k, v in res.stats.items()},
        "timings": {k: round(float(v), 3) for k, v in res.timings.items()},
        "nx": int(z.shape[1]), "ny": int(z.shape[0]),
        "cell": float(res.terrain.cell),
        "world_size": float(res.terrain.extent),
    }
    if res.sat:
        payload["materials"] = []
    if with_images and res.sat and "image" in res.sat:
        img = res.sat["image"]
        payload["satmap_png"] = _png_b64(img)
        shade = _hillshade(z, res.terrain.cell)
        payload["hillshade_png"] = _png_b64(shade)
        if "normal" in res.sat:
            payload["normal_png"] = _png_b64(res.sat["normal"])
        if res.attrs is not None:
            payload["slope_png"] = _png_b64(
                np.clip(res.attrs.slope_deg / 45.0, 0, 1))
            payload["sand_png"] = _png_b64(
                np.clip(res.terrain.z_sed / max(1.0, float(res.terrain.z_sed.max())), 0, 1))
    return payload


def _run_bake(job_id: str, req: Dict[str, Any]):
    try:
        doc = _doc_from_payload(req["doc"])
        nx = int(req.get("nx") or doc.nx)
        ny = int(req.get("ny") or doc.ny)

        def prog(frac, msg):
            with JOBS_LOCK:
                JOBS[job_id]["progress"] = float(frac)
                JOBS[job_id]["message"] = msg

        t0 = time.time()
        res = bake(doc, nx=nx, ny=ny, progress=prog,
                   include_sdf=req.get("include_sdf"),
                   run_erosion=req.get("run_erosion"))
        with JOBS_LOCK:
            JOBS[job_id].update(status="done", progress=1.0,
                                message=f"baked {nx}x{ny} in {time.time()-t0:.1f}s",
                                result=_result_payload(res))
            JOBS[job_id]["_terrain"] = res.terrain
            JOBS[job_id]["_result"] = res
    except Exception as exc:  # pragma: no cover
        import traceback
        traceback.print_exc()
        with JOBS_LOCK:
            JOBS[job_id].update(status="error", message=f"{type(exc).__name__}: {exc}")


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------
@app.get("/api/presets")
def api_presets():
    out = {}
    for name, fn in PRESETS.items():
        out[name] = json.loads(fn().to_json())
    return JSONResponse(out)


@app.get("/api/schema")
def api_schema():
    """Parameter metadata for the UI: (key, label, min, max, step, kind)."""
    defs = {
        "base": [
            ("relief", "Structural relief (m)", 40, 3000, 10, "lin"),
            ("scale", "Dominant wavelength (m)", 400, 20000, 100, "lin"),
            ("octaves", "Structure octaves", 1, 7, 1, "int"),
            ("detail", "Seed roughness", 0.0, 0.4, 0.01, "lin"),
            ("ridged_mix", "Ridged character", 0.0, 1.0, 0.02, "lin"),
            ("warp_strength", "Domain warp (m)", 0, 1200, 10, "lin"),
            ("warp_scale", "Warp wavelength (m)", 300, 12000, 100, "lin"),
            ("tilt", "Regional tilt (m)", -1200, 1200, 10, "lin"),
            ("tilt_dir_deg", "Tilt azimuth (deg)", 0, 360, 5, "lin"),
            ("terraces", "Bedding terraces", 0.0, 1.0, 0.02, "lin"),
            ("terrace_step", "Terrace step (m)", 2, 200, 1, "lin"),
            ("seed", "Seed", 1, 9999, 1, "int"),
        ],
        "erosion": [
            ("years", "Simulation time (yr)", 1e4, 2e7, 1e4, "log"),
            ("dt", "Time step (yr)", 100, 5e4, 100, "log"),
            ("m", "m (area exponent)", 0.1, 1.0, 0.05, "lin"),
            ("n", "n (slope exponent)", 0.5, 2.0, 0.1, "lin"),
            ("K", "K erodibility", 1e-8, 1e-4, 1e-7, "log"),
            ("uplift", "Uplift U (m/yr)", 0.0, 1e-3, 5e-6, "log"),
            ("uplift_gradient", "Uplift gradient (m/yr)", 0.0, 5e-4, 5e-6, "log"),
            ("deposition_G", "Deposition G", 0.0, 1.5, 0.05, "lin"),
            ("hillslope_Kd", "Hillslope D (m2/yr)", 0.0, 0.1, 1e-4, "log"),
            ("Sc", "Critical slope Sc", 0.4, 2.0, 0.05, "lin"),
            ("precip", "Precipitation factor", 0.1, 4.0, 0.05, "lin"),
            ("precip_gradient", "Precipitation gradient", -1.0, 1.0, 0.05, "lin"),
            ("hardness_exponent", "Lithology contrast", 0.0, 4.0, 0.1, "lin"),
            ("reroute_every", "Reroute every N steps", 1, 20, 1, "int"),
            ("route_smooth", "Routing smoothing (cells)", 0.0, 3.0, 0.1, "lin"),
            ("mfd_p", "Flow spreading exponent", 0.5, 3.0, 0.1, "lin"),
            ("hyd_iterations", "Hydraulic passes", 0, 400, 5, "int"),
            ("hyd_rain", "Rain rate", 0.0, 4.0, 0.05, "lin"),
            ("hyd_Kc", "Hydraulic Kc", 0.0, 4.0, 0.05, "lin"),
            ("hyd_thermal", "Hydraulic thermal", 0.0, 1.0, 0.05, "lin"),
            ("aeolian_iterations", "Aeolian steps", 0, 200, 1, "int"),
            ("aeolian_years", "Aeolian interval (yr)", 0, 1e6, 1e3, "log"),
            ("wind_speed", "Wind (m/s)", 0, 30, 0.5, "lin"),
            ("wind_dir_deg", "Wind azimuth (deg)", 0, 360, 5, "lin"),
            ("sand_supply", "Sand supply (m/step)", 0.0, 0.5, 0.002, "lin"),
            ("thermal_iterations", "Talus passes", 0, 200, 1, "int"),
            ("repose_deg", "Repose angle (deg)", 20, 45, 0.5, "lin"),
        ],
        "texture": [
            ("sun_az_deg", "Sun azimuth (deg)", 0, 360, 5, "lin"),
            ("sun_el_deg", "Sun elevation (deg)", 5, 90, 1, "lin"),
            ("haze", "Haze", 0.0, 0.8, 0.02, "lin"),
            ("dust", "Dust / lichen", 0.0, 1.0, 0.02, "lin"),
            ("vegetation", "Vegetation", 0.0, 1.0, 0.02, "lin"),
            ("sand_max_slope", "Sand max slope (deg)", 5, 40, 1, "lin"),
            ("macro_variation", "Macro variation", 0.0, 0.5, 0.02, "lin"),
            ("micro_variation", "Micro variation", 0.0, 0.5, 0.02, "lin"),
            ("detail_scale", "Detail scale (m)", 5, 400, 5, "lin"),
        ],
    }
    return JSONResponse(defs)


@app.get("/api/tools")
def api_tools():
    """Sculpting tool catalogue (surface brushes + CSG/SDF structure tools)."""
    return JSONResponse({
        "brushes": [
            {"id": "raise", "label": "Raise", "hint": "dome up the surface"},
            {"id": "lower", "label": "Lower", "hint": "excavate a bowl"},
            {"id": "smooth", "label": "Smooth", "hint": "relax / soften"},
            {"id": "flatten", "label": "Bench", "hint": "flatten to the local level"},
            {"id": "terrace", "label": "Terrace", "hint": "cut bedding steps"},
            {"id": "talus", "label": "Talus", "hint": "impose the repose angle"},
            {"id": "sand", "label": "Sand", "hint": "dump loose sand"},
            {"id": "gully", "label": "Gully", "hint": "cut a rill fan"},
        ],
        "structure": [
            {"id": "mesa", "label": "Mesa", "hint": "flat-topped block (CSG)"},
            {"id": "hoodoo", "label": "Hoodoos", "hint": "scattered cones"},
            {"id": "arch", "label": "Arch", "hint": "punch a span through the rock"},
            {"id": "alcove", "label": "Alcove", "hint": "undercut cavity in a wall"},
            {"id": "slot", "label": "Slot canyon", "hint": "narrow deep trench"},
            {"id": "rocks", "label": "Rock field", "hint": "scatter boulders"},
        ],
        "paths": [
            {"id": "river", "label": "River", "hint": "carve a graded valley"},
            {"id": "canyon", "label": "Canyon", "hint": "carve a U canyon + SDF"},
            {"id": "ridge", "label": "Ridge", "hint": "raise a crest"},
            {"id": "fault", "label": "Fault", "hint": "raise a fault scarp"},
            {"id": "levee", "label": "Levee", "hint": "deposit banks"},
        ],
    })


@app.post("/api/preview")
def api_preview(req: BakeRequest):
    """Synchronous low-resolution bake: used by the interactive viewport."""
    doc = _doc_from_payload(req.doc)
    nx = int(req.nx or 160)
    ny = int(req.ny or nx)
    t0 = time.time()
    res = bake(doc, nx=nx, ny=ny, include_sdf=req.include_sdf,
               run_erosion=req.run_erosion)
    payload = _result_payload(res)
    payload["elapsed"] = round(time.time() - t0, 2)
    return JSONResponse(payload)


@app.post("/api/bake")
def api_bake(req: BakeRequest):
    doc = _doc_from_payload(req.doc)
    jid = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[jid] = dict(status="running", progress=0.0, message="queued",
                         created=time.time())
    payload = req.model_dump()
    payload["doc"] = json.loads(doc.to_json())
    th = threading.Thread(target=_run_bake, args=(jid, payload), daemon=True)
    th.start()
    return {"job": jid}


@app.get("/api/jobs/{jid}")
def api_job(jid: str):
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if job is None:
            raise HTTPException(404, "unknown job")
        return JSONResponse({k: v for k, v in job.items()
                             if not k.startswith("_")})


@app.post("/api/export")
def api_export(req: ExportRequest):
    doc = _doc_from_payload(req.doc)
    name = req.name or (doc.name or "terrain").replace(" ", "_").lower()
    t0 = time.time()
    res = None
    if req.job:
        with JOBS_LOCK:
            job = JOBS.get(req.job)
            if job and job.get("status") == "done":
                res = job.get("_result")          # avoid baking twice
    if res is None:
        res = bake(doc, nx=req.nx, ny=req.nx)
    outdir = os.path.join(OUT_ROOT, name)
    paths = export_all(outdir, res.terrain, res.sat or {}, res.attrs,
                       mesh=req.mesh, hillshade=req.hillshade, sdf=res.sdf)
    rel = {k: os.path.relpath(v, OUT_ROOT) for k, v in paths.items()}
    return {"outdir": outdir, "files": rel, "elapsed": round(time.time() - t0, 2),
            "stats": res.stats,
            "timings": {k: round(v, 2) for k, v in res.timings.items()}}


@app.get("/")
def index():
    p = os.path.join(HERE, "static", "index.html")
    if os.path.exists(p):
        return FileResponse(p)
    return JSONResponse({"service": "frontier", "docs": "/docs"})


_static = os.path.join(HERE, "static")
if os.path.isdir(_static):
    app.mount("/static", StaticFiles(directory=_static), name="static")
