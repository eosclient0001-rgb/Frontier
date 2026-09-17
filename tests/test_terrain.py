"""Smoke tests for the Frontier SDF terrain engine (fast, res <= 128)."""

import numpy as np

from terrain import (
    ErosionParams,
    MountainParams,
    SDFConfig,
    compute_satmaps,
    generate_mountain,
    render_albedo,
    run_hydraulic_erosion,
)
from terrain.exporters import render_map_preview, render_sdf_slice
from terrain.satmaps import SatmapParams
from terrain.sdf import gaussian_brush, voxel_match_report
from terrain.texture import TextureParams


def _small_mountain():
    return generate_mountain(MountainParams(res=96, seed=11, octaves=6))


def test_mountain_shape_and_peak():
    m = _small_mountain()
    assert m.height.shape == (96, 96)
    assert m.height.dtype == np.float32
    assert np.isfinite(m.height).all()
    assert 8.0 < m.peak_height_m < 40.0
    assert 1 <= m.effective_octaves <= 6
    assert 0.0 <= m.mask.min() and m.mask.max() <= 1.0


def test_brush_min_clamp():
    cfg = SDFConfig(extent=100, res=512)
    off, w, cells, clamped = gaussian_brush(0.01, cfg.cell)
    assert clamped and cells >= 1.5 and abs(w.sum() - 1.0) < 1e-9
    off, w, cells, clamped = gaussian_brush(0.6, cfg.cell)
    assert not clamped and 2.5 < cells < 4.0


def test_erosion_runs_and_conserves_reasonably():
    m = _small_mountain()
    cfg = SDFConfig(extent=100, res=96)
    e = run_hydraulic_erosion(
        m.height, cfg,
        ErosionParams(num_particles=8000, max_lifetime=24, thermal_iterations=3),
    )
    assert e.height.shape == (96, 96)
    assert np.isfinite(e.height).all()
    assert (e.height >= 0.0).all()
    s = e.stats
    assert s["max_cut_m"] > 0.05, "erosion should visibly incise"
    assert s["max_cut_m"] < 25.0, "erosion must not nuke the mountain"
    # Mass roughly conserved (boundary outflow + clamping aside).
    assert abs(s["net_volume_m3"]) < 0.6 * max(s["eroded_volume_m3"], 1.0)


def test_satmaps_and_texture():
    m = _small_mountain()
    cfg = SDFConfig(extent=100, res=96)
    e = run_hydraulic_erosion(
        m.height, cfg,
        ErosionParams(num_particles=8000, max_lifetime=24, thermal_iterations=3),
    )
    maps, meta = compute_satmaps(
        e.height, cfg, flow=e.flow, sediment=e.sediment,
        wear=e.wear, deposition=e.deposition, params=SatmapParams(ao_directions=4),
    )
    for k in ("height", "slope", "flow", "sediment", "wear", "deposition",
              "pointiness", "concavity", "peak", "wetness", "ao"):
        assert k in maps, k
        assert maps[k].shape == (96, 96)
        assert np.isfinite(maps[k]).all()
        assert maps[k].min() >= 0.0 and maps[k].max() <= 1.0, k
    assert maps["flow"].max() > 0.5, "flow should show channels"
    alb = render_albedo(e.height, maps, TextureParams())
    assert alb.shape == (96, 96, 3) and alb.dtype == np.uint8


def test_voxel_report_flags_subvoxel_brush():
    cfg = SDFConfig(extent=100, res=512)
    rep = voxel_match_report(cfg, brush_radius_world=0.05)
    assert rep["status"] == "bad"
    assert rep["brush_radius_voxels"] < 1.5
    rep2 = voxel_match_report(cfg, brush_radius_world=0.6, measured_cut_m=3.0)
    assert rep2["status"] in ("ok", "warn")


def test_previews_render():
    m = _small_mountain()
    cfg = SDFConfig(extent=100, res=96)
    png = render_map_preview(m.height, mode="height", size=128)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    sl = render_sdf_slice(m.height, cfg, size=256)
    assert sl[:8] == b"\x89PNG\r\n\x1a\n"
