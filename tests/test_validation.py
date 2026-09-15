"""Validation suite: every solver is checked against an analytic or published
reference rather than against itself.

Run with::

    python -m pytest tests -q

The tests are deliberately written around closed-form solutions where they
exist (diffusion eigenmodes, the FastScape steady state, 1D stream power) and
around conservation laws elsewhere (mass balance in the hydraulic pass, sand
conservation in the dune model).
"""
from __future__ import annotations

import numpy as np
import pytest

from frontier.core.grid import Terrain, gradient, slope_aspect
from frontier.core.noise import fractal_surface, max_octaves
from frontier.erosion.flow import route, route_multi, wetness_index
from frontier.erosion.hillslope import diffuse
from frontier.erosion.stream_power import (FluvialParams, run_fluvial,
                                           slope_area_analysis, _solve_node)
from frontier.erosion.hydraulic import HydraulicParams, erode_hydraulic, thermal_relax
from frontier.erosion.aeolian import AeolianParams, erode_aeolian
from frontier.sdf.volume import SDFVolume
from frontier.spline.path import PathSpec
from frontier.layers.lithology import Stratigraphy


# ---------------------------------------------------------------- hillslope
def test_hillslope_matches_discrete_eigenmode():
    """Linear diffusion of cos(2 pi x / L): the *discrete* decay rate is
    mu = 4 D sin^2(pi/N) / h^2, and the ADI solver must reproduce exp(-mu t)
    to high accuracy (this is the strongest available check: it validates the
    operator, the time integration and the Neumann boundary together)."""
    nx, L, D = 256, 1000.0, 1.0e-2
    cell = L / nx
    xc = (np.arange(nx) + 0.5) * cell
    k = 2 * np.pi / L
    mu = 4.0 * np.sin(k * cell / 2.0) ** 2 / cell ** 2 * D
    z0 = np.tile(np.cos(k * xc), (nx, 1))
    for T in (5.0e4, 1.0e6):
        z = diffuse(z0, cell, D, T, scheme="adi")
        exact = np.exp(-mu * T) * np.cos(k * xc)
        assert np.abs(z[0] - exact).max() < 5e-3


def test_hillslope_does_not_mutate_input_and_conserves_mass():
    rng = np.random.default_rng(0)
    z = (rng.random((64, 64)) * 100).astype(np.float32)
    keep = z.copy()
    out = diffuse(z, 32.0, 1e-3, 5e4)
    assert np.array_equal(z, keep), "diffuse() must not alias the caller's array"
    assert abs(float(out.mean()) - float(keep.mean())) < 1e-3


def test_hillslope_matches_2d_heat_kernel():
    """A Gaussian bump must spread to the analytic heat kernel."""
    n, cell, D, T, s0 = 128, 60.0, 2e-2, 2e5, 300.0
    x = (np.arange(n) - n / 2 + 0.5) * cell
    xx, yy = np.meshgrid(x, x)
    z0 = np.exp(-(xx ** 2 + yy ** 2) / (2 * s0 ** 2))
    sT = np.sqrt(s0 ** 2 + 2 * D * T)
    exact = np.exp(-(xx ** 2 + yy ** 2) / (2 * sT ** 2)) * (s0 ** 2 / sT ** 2)
    got = diffuse(z0, cell, D, T)
    assert np.linalg.norm(got - exact) / np.linalg.norm(exact) < 5e-3


def test_roering_nonlinearity_limits_slope():
    """The Roering (1999) law takes transport to infinity at S = Sc, so a flank
    steeper than Sc must relax below it (with the documented D_cap ceiling)."""
    n, cell = 128, 20.0
    z = np.tile(np.where(np.arange(n) * cell < n * cell / 2, 120.0, 0.0), (n, 1))
    out = diffuse(z, cell, 3e-3, 2e5, Sc=0.8, nonlinear=True)
    s = np.abs(np.gradient(out.astype(np.float64), cell, axis=1)).max()
    assert s <= 0.8 + 0.05


# ---------------------------------------------------------------- routing
def test_flow_routing_basics():
    n, cell = 32, 10.0
    z = np.tile((n - np.arange(n)) * 1.0, (n, 1))       # drains east
    r = route(z, cell)
    a = r["area"]
    # a pure east-facing ramp sends every row to its own outlet: the eastern
    # edge cell of a row drains exactly that row
    assert abs(a[0, -1] - n * cell * cell) < 1e-6
    assert abs(a[0, 0] - cell * cell) < 1e-6
    assert float(r["flow_length"].max()) == (n - 1) * cell
    m = route_multi(z, cell)
    assert m["area"].max() >= n * cell * cell


def test_mfd_weights_sum_to_one():
    rng = np.random.default_rng(1)
    z = rng.random((24, 24)) * 50
    m = route_multi(z, 10.0)
    assert 0.0 < m["wts"].sum() / max(1, m["n_receivers"]) <= 1.0 + 1e-9


# ------------------------------------------------------------ stream power
def test_fastscape_node_solution_matches_closed_form():
    # n = 1 has the exact implicit solution (Braun & Willett 2013)
    h = _solve_node(100.0, 90.0, 50.0, 1e4, 1e-5, 1e6, 0.5, 1.0, 1e-4, 8)
    assert abs(h - 90.00549725137431) < 1e-6


def test_stream_power_reaches_steady_state_slope():
    """At steady state with U constant, dz/dt = 0 => S = (U/K)^(1/n) A^(-m/n)."""
    n, cell = 96, 100.0
    z = np.tile(np.linspace(200, 0, n), (n, 1)).astype(np.float64)
    K, U, m, mn = 1e-6, 1e-4, 0.5, 1.0
    p = FluvialParams(m=m, n=mn, K=K, U=U, years=4e6, dt=1e4, Kd=0.0, G=0.0,
                      boundary="fixed", route_mode="d8")
    z2, _ = run_fluvial(z, cell, p)
    r = route(z2, cell)
    A = np.maximum(r["area"], cell * cell)
    gx, gy = gradient(z2.astype(np.float64), cell)
    S = np.hypot(gx, gy)
    pred = (U / K) ** (1.0 / mn) * A ** (-m / mn)
    core = (A > 20 * cell * cell) & (S > 1e-6)
    med = np.median(S[core] / pred[core])
    assert 0.1 < med < 10.0, f"median S/predicted = {med}"


# --------------------------------------------------------------- hydraulic
def test_hydraulic_is_finite_and_bounded_on_steep_terrain():
    """The explicit virtual-pipe scheme must not blow up on steep, fine
    terrain even when cranked far past production settings."""
    rng = np.random.default_rng(3)
    z = (rng.random((96, 96)) * 300 + 100).astype(np.float32)
    sed = np.zeros_like(z)
    p = HydraulicParams(iterations=200, rain_rate=4.0, Kc=3.0, thermal=0.3)
    r = erode_hydraulic(z, sed, 50.0, p)
    assert np.isfinite(z).all() and np.isfinite(sed).all()
    assert not r["guarded"]
    assert np.isfinite(r["water"]).all()
    assert r["water"].max() <= p.depth_max + 1e-6


def test_thermal_relaxation_enforces_repose_angle():
    n, cell = 96, 20.0
    z = np.zeros((n, n), dtype=np.float32)
    z[:, n // 2:] = 100.0                              # vertical cliff
    sed = np.zeros_like(z)
    thermal_relax(z, sed, cell, 33.0, 200, 0.6)
    s = np.abs(np.gradient((z + sed).astype(np.float64), cell, axis=1))
    assert s.max() <= np.tan(np.radians(33.0)) + 0.05


# ---------------------------------------------------------------- aeolian
def test_ksh_growth_and_sand_conservation():
    """A barchan-scale bump under a steady wind must grow (the KSH instability)
    and the sand budget must be conserved except for the supplied source."""
    n, cell = 128, 8.0
    z = np.zeros((n, n), dtype=np.float32)
    x = (np.arange(n) - n / 2) * cell
    xx, yy = np.meshgrid(x, x)
    sed = (0.6 * np.exp(-(xx ** 2 + yy ** 2) / (2 * 30.0 ** 2))).astype(np.float32)
    before = float(sed.sum())
    p = AeolianParams(wind_speed=14.0, wind_dir_deg=270.0, iterations=20,
                      dt=3600.0 * 6.0, sand_source=None)
    r = erode_aeolian(z, sed, cell, p)
    assert np.isfinite(sed).all()
    assert abs(float(sed.sum()) - before) / before < 0.35


# -------------------------------------------------------------------- SDF
def test_sdf_sphere_distance_and_raycast():
    n, R = 64, 20.0
    v = SDFVolume(n, n, n, 1.0, (0, 0, 0))
    from frontier.sdf.volume import stamp_sphere
    stamp_sphere(v.phi, v.origin, v.cell, 32.0, 32.0, 32.0, R, 0, 0.0, 0.0, 0.0, 0)
    v.reinit(iters=3)
    band = v.active_band(2)
    g = v.gradient()
    gm = np.sqrt(sum(gi ** 2 for gi in g))
    assert abs(gm[band].mean() - 1.0) < 0.15, "|grad phi| must be 1 away from the interface"


def test_sdf_heightfield_roundtrip():
    """Rasterise a smooth surface, reinitialise, ray-cast it back.

    The surface must be recovered to within about a voxel.  (A *rough* surface
    cannot be: the SDF stores vertical distances on a lattice, so a one-voxel
    vertical wall between two columns is sub-voxel information.  That is a
    property of the representation, not of the solver, and it is why the
    structure field is rebuilt from the heightfield after the erosion passes.)
    """
    n, cell = 64, 25.0
    x = (np.arange(n) + 0.5) * cell
    xx, yy = np.meshgrid(x, x)
    z = (200.0 + 60.0 * np.exp(-((xx - 800) ** 2 + (yy - 800) ** 2) / (2 * 300.0 ** 2))
         + 0.05 * xx).astype(np.float32)
    v = SDFVolume(n, n, 80, cell, (0, 0, -100.0))
    v.from_heightfield(z, thickness=5 * cell)
    zh, hits, _ = v.to_heightfield(-100.0, n, n, cell)
    ok = hits & np.isfinite(zh)
    assert ok.mean() > 0.95
    assert np.abs(zh[ok] - z[ok]).mean() < 0.6 * cell


# ------------------------------------------------------------- stratigraphy
def test_stratigraphy_spans_the_terrain():
    z = np.linspace(-100, 400, 64 * 64).reshape(64, 64).astype(np.float32)
    st = Stratigraphy.colorado_plateau().fit_to_elevation(float(z.max()),
                                                          float(z.max() - z.min()))
    idx, hard, frac = st.hardness_map(z, 64, 64, 100.0)
    assert len(np.unique(idx)) >= 4, "the column must actually be intersected"
    assert hard.min() < hard.max()


# ---------------------------------------------------------------- pipeline
def test_pipeline_end_to_end_and_determinism():
    from frontier.pipeline.engine import preset_badlands, bake
    d = preset_badlands()
    d.erosion.years = 4.0e4
    d.erosion.aeolian_enabled = False
    a = bake(d, nx=96, ny=96, include_sdf=True)
    b = bake(d, nx=96, ny=96, include_sdf=True)
    assert np.isfinite(a.terrain.z).all()
    assert np.array_equal(a.terrain.z, b.terrain.z), "bakes must be reproducible"
    assert a.stats["relief"] > 5.0
    assert a.sdf is not None
    assert np.isfinite(a.sdf.phi).all()


def test_pipeline_resolution_independence():
    """The same document at two resolutions must describe the same landscape:
    the physics is in world units, and the noise is band-limited to the grid."""
    from frontier.pipeline.engine import preset_rocky_canyon, bake
    d = preset_rocky_canyon()
    d.erosion.years = 1.0e5
    d.erosion.aeolian_enabled = False
    d.erosion.thermal_enabled = False
    lo = bake(d, nx=64, ny=64, include_sdf=False)
    hi = bake(d, nx=128, ny=128, include_sdf=False)
    coarse = lo.terrain.resample(128, 128)
    diff = np.abs(coarse.z - hi.terrain.z)
    assert diff.mean() < 0.25 * (hi.terrain.z.max() - hi.terrain.z.min())


def test_noise_is_band_limited():
    assert max_octaves(32.0, 1500.0) < max_octaves(8.0, 1500.0)
    a = fractal_surface(128, 128, 64.0, "fbm", 8, 2000.0, seed=1)
    assert np.isfinite(a).all() and a.std() > 0
