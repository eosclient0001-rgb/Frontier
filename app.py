"""Frontier SDF Terrain Studio — FastAPI backend serving the engine + UI.

Run:
    python3 app.py [--port 8000]
then open http://localhost:8000
"""

from __future__ import annotations

import base64
import io
import json
import threading
import time
import traceback
import uuid
from dataclasses import asdict
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

from terrain.erosion import ErosionParams
from terrain.exporters import (
    export_height_png16,
    export_obj,
    render_map_preview,
    render_normals,
    render_sdf_slice,
    render_shaded_preview,
)
from terrain.mountain import MountainParams, generate_mountain
from terrain.pipeline import PRESETS, preset_to_dict, run_pipeline
from terrain.satmaps import SatmapParams, compute_satmaps
from terrain.sdf import SDFConfig, surface_normals, voxel_match_report
from terrain.texture import TextureParams, hillshade, render_albedo

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
EXPORT_DIR = ROOT / "exports"
EXPORT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Frontier SDF Terrain Studio")


# ---------------------------------------------------------------- state

class Store:
    """Latest pipeline result (single-project session)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.result: dict | None = None
        self.params: dict = {
            "mountain": asdict(PRESETS["alpine_peak"]["mountain"]),
            "erosion": asdict(PRESETS["alpine_peak"]["erosion"]),
            "texture": asdict(PRESETS["alpine_peak"]["texture"]),
            "satmaps": asdict(SatmapParams()),
            "preset": "alpine_peak",
        }

    def set_result(self, result: dict) -> None:
        with self.lock:
            self.result = result

    def get_result(self) -> dict | None:
        with self.lock:
            return self.result


STORE = Store()
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


def _new_job(kind: str) -> str:
    jid = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[jid] = {
            "id": jid, "kind": kind, "status": "running",
            "progress": 0.0, "stage": "starting", "log": [],
            "t0": time.time(), "result_summary": None, "error": None,
        }
    return jid


def _job_update(jid: str, progress: float, stage: str) -> None:
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if job is None:
            return
        job["progress"] = float(np.clip(progress, 0, 1))
        job["stage"] = stage
        job["log"].append(f"[{time.strftime('%H:%M:%S')}] {stage}")
        job["log"] = job["log"][-60:]


def _job_done(jid: str, summary: dict) -> None:
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if job is None:
            return
        job["status"] = "done"
        job["progress"] = 1.0
        job["stage"] = "done"
        job["result_summary"] = summary
        job["elapsed_s"] = time.time() - job["t0"]


def _job_error(jid: str, err: str) -> None:
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if job is None:
            return
        job["status"] = "error"
        job["stage"] = "error"
        job["error"] = err
        job["log"].append(f"ERROR: {err}")


# ---------------------------------------------------------------- models

class MountainModel(BaseModel):
    seed: int = 1337
    extent: float = 100.0
    res: int = 512
    peak_height: float = 30.0
    base_height: float = 2.0
    mountain_radius: float = 38.0
    peak_sharpness: float = 1.45
    peak_offset_x: float = 4.0
    peak_offset_z: float = -3.0
    octaves: int = 8
    lacunarity: float = 2.15
    gain: float = 0.55
    ridge_offset: float = 0.92
    base_freq: float = 3.0
    warp_strength: float = 0.55
    warp_octaves: int = 3
    ridge_weight: float = 0.72
    crevice: float = 0.30
    hills_amp: float = 0.85
    valley_carve: float = 0.18


class ErosionModel(BaseModel):
    seed: int = 777
    num_particles: int = 350_000
    max_lifetime: int = 48
    inertia: float = 0.08
    gravity: float = 5.0
    evaporation: float = 0.015
    capacity_factor: float = 4.0
    min_slope: float = 0.025
    erode_speed: float = 0.30
    deposit_speed: float = 0.30
    brush_radius_world: float = 0.6
    cfl_voxels: float = 0.75
    initial_speed: float = 1.0
    initial_water: float = 1.0
    thermal_iterations: int = 14
    talus_angle_deg: float = 34.0
    talus_rate: float = 0.65
    sdf_relax_passes: int = 2
    sdf_relax_strength: float = 0.35
    clamp_min_height: float = 0.0


class TextureModel(BaseModel):
    seed: int = 4242
    palette: str = "alpine"
    snowline: float = 0.62
    snow_slope_limit: float = 0.55
    grassline: float = 0.45
    rock_saturation: float = 1.0
    snow_amount: float = 1.0
    wet_darkening: float = 0.45
    ao_strength: float = 0.55
    strata_strength: float = 0.35
    variation: float = 0.16


class SatmapModel(BaseModel):
    ao_distance_m: float = 7.0
    ao_directions: int = 8
    peak_window_m: float = 3.0
    peak_blur_m: float = 1.2
    flow_gamma: float = 0.55
    wetness_flat_boost: float = 1.6


class PipelineRequest(BaseModel):
    mountain: MountainModel = Field(default_factory=MountainModel)
    erosion: ErosionModel = Field(default_factory=ErosionModel)
    texture: TextureModel = Field(default_factory=TextureModel)
    satmaps: SatmapModel = Field(default_factory=SatmapModel)
    skip_erosion: bool = False


def _clamp_res(res: int) -> int:
    return int(np.clip(res, 64, 1024))


def _summarize(result: dict) -> dict:
    mtn = result["mountain_stats"]
    ero = result["erosion_stats"]
    return {
        "config": result["config"],
        "mountain_stats": mtn,
        "erosion_stats": ero,
        "satmap_meta": result["satmap_meta"],
        "voxel_precheck": result["voxel_precheck"],
        "voxel_postcheck": result["voxel_postcheck"],
        "has_erosion": ero is not None,
    }


# ---------------------------------------------------------------- API

@app.get("/api/presets")
def api_presets():
    return {"presets": [preset_to_dict(k) for k in PRESETS.keys()]}


@app.get("/api/state")
def api_state():
    res = STORE.get_result()
    return {
        "params": STORE.params,
        "has_result": res is not None,
        "summary": _summarize(res) if res else None,
    }


@app.post("/api/pipeline")
def api_pipeline(req: PipelineRequest):
    md = req.mountain.model_dump()
    md["res"] = _clamp_res(md["res"])
    mountain = MountainParams(**md)
    erosion = ErosionParams(**req.erosion.model_dump())
    texture = TextureParams(**req.texture.model_dump())
    satmaps = SatmapModel(**req.satmaps.model_dump())
    STORE.params = {
        "mountain": asdict(mountain), "erosion": asdict(erosion),
        "texture": asdict(texture), "satmaps": asdict(SatmapParams(**req.satmaps.model_dump())),
        "preset": "custom",
    }
    jid = _new_job("pipeline")

    def work():
        try:
            result = run_pipeline(
                mountain, erosion, texture, SatmapParams(**req.satmaps.model_dump()),
                skip_erosion=req.skip_erosion,
                progress_cb=lambda f, m: _job_update(jid, f, m),
            )
            STORE.set_result(result)
            _job_done(jid, _summarize(result))
        except Exception as e:  # noqa: BLE001
            _job_error(jid, f"{e}\n{traceback.format_exc(limit=5)}")

    threading.Thread(target=work, daemon=True).start()
    return {"job_id": jid}


@app.get("/api/jobs/{jid}")
def api_job(jid: str):
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if job is None:
            raise HTTPException(404, "unknown job")
        return JSONResponse({k: v for k, v in job.items() if k != "t0"})


@app.post("/api/retexture")
def api_retexture(req: TextureModel):
    """Re-render albedo from the current SATMAPs (fast, synchronous)."""
    res = STORE.get_result()
    if res is None:
        raise HTTPException(400, "no terrain yet — run the pipeline first")
    texture = TextureParams(**req.model_dump())
    STORE.params["texture"] = asdict(texture)
    albedo = render_albedo(res["height"], res["maps"], texture)
    with STORE.lock:
        res["albedo"] = albedo
        res["texture"] = texture
    return {"ok": True}


@app.post("/api/voxel-check")
def api_voxel_check(req: PipelineRequest):
    md = req.mountain.model_dump()
    md["res"] = _clamp_res(md["res"])
    cfg = SDFConfig(extent=md["extent"], res=md["res"])
    rep = voxel_match_report(
        cfg, req.erosion.brush_radius_world, req.erosion.cfl_voxels
    )
    # Octave/Nyquist advisory.
    from terrain.noise import max_effective_octaves

    eff, finest = max_effective_octaves(
        md["extent"] / max(md["base_freq"], 0.5), cfg.cell,
        md["lacunarity"], md["octaves"],
    )
    rep["requested_octaves"] = md["octaves"]
    rep["effective_octaves"] = eff
    rep["finest_wavelength_m"] = finest
    if eff != md["octaves"]:
        rep["issues"].append(
            f"Ridged octaves {md['octaves']} exceed the grid Nyquist "
            f"({cfg.nyquist_m:.3f} m): {md['octaves'] - eff} finest octave(s) "
            f"carry no representable detail and will be auto-clamped to {eff}."
        )
    return rep


def _need_result() -> dict:
    res = STORE.get_result()
    if res is None:
        raise HTTPException(400, "no terrain yet — run the pipeline first")
    return res


@app.get("/api/preview/{name}")
def api_preview(name: str, size: int = 512):
    res = _need_result()
    size = int(np.clip(size, 64, 1024))
    h = res["height"]
    maps = res["maps"]
    cfg = SDFConfig(extent=res["config"]["extent"], res=res["config"]["res"])
    if name == "albedo":
        png = render_map_preview(res["albedo"], size=size)
    elif name == "shaded":
        png = render_shaded_preview(res["albedo"], hillshade(h, cfg.cell), size=size)
    elif name == "height":
        png = render_map_preview(h, mode="height", size=size)
    elif name == "normals":
        png = render_normals(surface_normals(h, cfg.cell), size=size)
    elif name == "sdf-slice":
        png = render_sdf_slice(h, cfg, size=size)
    elif name in maps:
        png = render_map_preview(maps[name], size=size)
    elif res.get("erosion_maps") and name in res["erosion_maps"]:
        png = render_map_preview(res["erosion_maps"][name], size=size)
    else:
        raise HTTPException(404, f"unknown preview '{name}'")
    return Response(content=png, media_type="image/png")


@app.get("/api/mesh")
def api_mesh(res: int = 256):
    """Downsampled height grid + extent for the Three.js viewport."""
    data = _need_result()
    h = data["height"]
    n = h.shape[0]
    res = int(np.clip(res, 32, 512))
    idx = (np.linspace(0, n - 1, res)).astype(int)
    small = np.ascontiguousarray(h[idx[:, None], idx], dtype=np.float32)
    return {
        "res": res,
        "extent": data["config"]["extent"],
        "min": float(small.min()),
        "max": float(small.max()),
        "data_b64": base64.b64encode(small.tobytes()).decode("ascii"),
    }


@app.get("/api/export/{kind}")
def api_export(kind: str):
    res = _need_result()
    cfg = SDFConfig(extent=res["config"]["extent"], res=res["config"]["res"])
    stamp = time.strftime("%Y%m%d_%H%M%S")
    if kind == "obj":
        path = str(EXPORT_DIR / f"frontier_terrain_{stamp}.obj")
        info = export_obj(res["height"], cfg, path, albedo=res["albedo"])
        return {"ok": True, "files": info}
    if kind == "heightmap":
        path = str(EXPORT_DIR / f"frontier_height_{stamp}.png")
        return {"ok": True, "files": export_height_png16(res["height"], path)}
    if kind == "albedo":
        path = str(EXPORT_DIR / f"frontier_albedo_{stamp}.png")
        Image.fromarray(res["albedo"]).save(path)
        return {"ok": True, "files": {"path": path}}
    if kind == "satmaps":
        paths = []
        for k, v in res["maps"].items():
            p = str(EXPORT_DIR / f"frontier_satmap_{k}_{stamp}.png")
            Image.fromarray((np.clip(v, 0, 1) * 255 + 0.5).astype(np.uint8)).save(p)
            paths.append(p)
        return {"ok": True, "files": {"paths": paths}}
    if kind == "sdf-volume":
        from terrain.sdf import sample_sdf_volume

        vol = sample_sdf_volume(res["height"], cfg, n=128)
        path = str(EXPORT_DIR / f"frontier_sdf128_{stamp}.npy")
        np.save(path, vol)
        return {"ok": True, "files": {"path": path, "shape": list(vol.shape)}}
    if kind == "meta":
        path = str(EXPORT_DIR / f"frontier_meta_{stamp}.json")
        summary = _summarize(res)
        summary["params"] = STORE.params
        with open(path, "w") as f:
            json.dump(summary, f, indent=2, default=str)
        return {"ok": True, "files": {"path": path}}
    raise HTTPException(404, f"unknown export '{kind}'")


# ---------------------------------------------------------------- frontend

if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    idx = FRONTEND / "index.html"
    if not idx.exists():
        return HTMLResponse("<h1>Frontier</h1><p>frontend not built yet.</p>")
    return HTMLResponse(idx.read_text())


if __name__ == "__main__":
    import argparse
    import uvicorn

    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)
