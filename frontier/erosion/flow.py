"""Flow routing primitives for the geomorphic solvers.

Everything here follows the published algorithms rather than hand-waved
approximations:

* Priority-Flood depression filling with an epsilon gradient
  (Barnes, Lehman & Mulla 2014, *Computers & Geosciences* 62, 117-127).
* D8 single-flow-direction routing (O'Callaghan & Mark 1984, *CVGIP* 30, 323-342).
* Flow accumulation and topological ("stack") ordering as used by the
  FastScape solver (Braun & Willett 2013, *Geomorphology* 180-181, 170-179).
* D-infinity multiple-flow routing (Tarboton 1997, *Water Resources Research*,
  33, 309-319).
* Multiple-flow-direction routing after Freeman (1991, *Computers & Geosciences*
  17, 413-432) with the Quinn et al. (1991) exponent.
* Topographic wetness index TWI = ln(a / tan beta) (Beven & Kirkby 1979).
"""
from __future__ import annotations

import numpy as np
from numba import njit

# neighbour order: E, NE, N, NW, W, SW, S, SE  (clockwise, dx/dy pairs)
NDX = np.array([1, 1, 0, -1, -1, -1, 0, 1], dtype=np.int64)
NDY = np.array([0, 1, 1, 1, 0, -1, -1, -1], dtype=np.int64)
NDIST = np.array([1.0, 1.41421356237, 1.0, 1.41421356237,
                  1.0, 1.41421356237, 1.0, 1.41421356237], dtype=np.float64)


# --------------------------------------------------------------------------
# binary min-heap over (float64 key, int64 index), flat arrays for speed
# --------------------------------------------------------------------------
@njit(cache=True)
def _heap_push(keys, vals, n, k, v):
    i = n[0]
    keys[i] = k
    vals[i] = v
    n[0] = i + 1
    while i > 0:
        p = (i - 1) >> 1
        if keys[p] > keys[i]:
            keys[p], keys[i] = keys[i], keys[p]
            vals[p], vals[i] = vals[i], vals[p]
            i = p
        else:
            break


@njit(cache=True)
def _heap_pop(keys, vals, n):
    top_k = keys[0]
    top_v = vals[0]
    n[0] -= 1
    last = n[0]
    if last > 0:
        keys[0] = keys[last]
        vals[0] = vals[last]
        i = 0
        while True:
            l = 2 * i + 1
            r = l + 1
            m = i
            if l < last and keys[l] < keys[m]:
                m = l
            if r < last and keys[r] < keys[m]:
                m = r
            if m == i:
                break
            keys[m], keys[i] = keys[i], keys[m]
            vals[m], vals[i] = vals[i], vals[m]
            i = m
    return top_k, top_v


@njit(cache=True)
def priority_flood(z, cell, eps_rel, closed, label, mask):
    """Fill depressions in-place keeping the original surface where possible.

    Parameters
    ----------
    z : (ny, nx) float64, modified in place
    eps_rel : epsilon increment per cell, in metres (Barnes et al. 2014)
    closed : (ny, nx) bool output, closed[i]=True if reached
    label : (ny, nx) int32 output, depression/outlet label
    mask : (ny, nx) bool, cells excluded from the domain (treated as walls)

    Returns
    -------
    n_outlets : int
    """
    ny, nx = z.shape
    cap = ny * nx * 2 + 16
    keys = np.empty(cap, dtype=np.float64)
    vals = np.empty(cap, dtype=np.int64)
    n = np.zeros(1, dtype=np.int64)

    for j in range(ny):
        for i in range(nx):
            closed[j, i] = False
            label[j, i] = 0

    nlabel = 0
    # seed: all domain-border cells (or cells adjacent to a mask hole) that are
    # not masked -> each seed is its own drainage label (Barnes et al. 2014)
    for j in range(ny):
        for i in range(nx):
            if mask[j, i]:
                closed[j, i] = True
                continue
            border = (i == 0 or j == 0 or i == nx - 1 or j == ny - 1)
            if not border:
                for k in range(8):
                    ii = i + NDX[k]
                    jj = j + NDY[k]
                    if ii >= 0 and ii < nx and jj >= 0 and jj < ny and mask[jj, ii]:
                        border = True
                        break
            if border:
                nlabel += 1
                label[j, i] = nlabel
                closed[j, i] = True
                _heap_push(keys, vals, n, z[j, i], j * nx + i)

    while n[0] > 0:
        zk, idx = _heap_pop(keys, vals, n)
        j = idx // nx
        i = idx - j * nx
        for k in range(8):
            ii = i + NDX[k]
            jj = j + NDY[k]
            if ii < 0 or ii >= nx or jj < 0 or jj >= ny:
                continue
            if closed[jj, ii]:
                continue
            closed[jj, ii] = True
            label[jj, ii] = label[j, i]
            if z[jj, ii] <= zk:
                z[jj, ii] = zk + eps_rel
            _heap_push(keys, vals, n, z[jj, ii], jj * nx + ii)

    return nlabel


# --------------------------------------------------------------------------
# D8
# --------------------------------------------------------------------------
@njit(cache=True)
def d8_receivers(z, cell, rec, rd, mask):
    """Steepest-descent D8 receiver (O'Callaghan & Mark 1984).

    ``rec[i] == i`` marks a base-level/outlet cell.  Cells whose steepest
    descent is uphill (possible when the surface was not epsilon-filled) are
    routed to their lowest neighbour to keep the graph acyclic (Braun &
    Willett 2013 make the same choice).
    """
    ny, nx = z.shape
    for j in range(ny):
        for i in range(nx):
            n = j * nx + i
            rec[n] = n
            rd[n] = 0.0
            if mask[j, i]:
                continue
            best = 0.0
            bestn = n
            kbest_dist = cell
            lowz = z[j, i]
            lown = n
            lown_d = cell
            for k in range(8):
                ii = i + NDX[k]
                jj = j + NDY[k]
                if ii < 0 or ii >= nx or jj < 0 or jj >= ny or mask[jj, ii]:
                    continue
                d = NDIST[k] * cell
                s = (z[j, i] - z[jj, ii]) / d
                if s > best:
                    best = s
                    bestn = jj * nx + ii
                    kbest_dist = d
                if z[jj, ii] < lowz:
                    lowz = z[jj, ii]
                    lown = jj * nx + ii
                    lown_d = d
            if best > 0.0:
                rec[n] = bestn
                rd[n] = kbest_dist
            elif lown != n:
                # flat/filled cell: no strict descent, follow the lowest
                # neighbour (guaranteed down-going after priority-flood)
                rec[n] = lown
                rd[n] = lown_d


@njit(cache=True)
def stack_order(rec, order, ndon):
    """Topological order, sources first (Kahn).  O(n)."""
    n_nodes = rec.shape[0]
    for i in range(n_nodes):
        ndon[i] = 0
    for i in range(n_nodes):
        r = rec[i]
        if r != i:
            ndon[r] += 1
    head = 0
    tail = 0
    nq = np.empty(n_nodes, dtype=np.int64)
    for i in range(n_nodes):
        if ndon[i] == 0:
            nq[tail] = i
            tail += 1
    cnt = 0
    while head < tail:
        i = nq[head]
        head += 1
        order[cnt] = i
        cnt += 1
        r = rec[i]
        if r != i:
            ndon[r] -= 1
            if ndon[r] == 0:
                nq[tail] = r
                tail += 1
    # guard: any leftovers (should not happen) appended so every node is visited
    if cnt < n_nodes:
        seen = np.zeros(n_nodes, dtype=np.bool_)
        for i in range(cnt):
            seen[order[i]] = True
        for i in range(n_nodes):
            if not seen[i]:
                order[cnt] = i
                cnt += 1
    return cnt


@njit(cache=True)
def accumulate(rec, order, weights, area, cell_area):
    """Route a conserved quantity downstream along D8.

    ``area[n]`` = cell_area * (local weight + sum of upstream weights).
    """
    n_nodes = rec.shape[0]
    for i in range(n_nodes):
        area[i] = 0.0
    for k in range(n_nodes):
        n = order[k]
        a = area[n] + weights[n]
        area[n] = a
        r = rec[n]
        if r != n:
            area[r] += a
    for i in range(n_nodes):
        area[i] *= cell_area


@njit(cache=True)
def flow_length(rec, rd, order, cell, flen):
    """Distance to the outlet measured along the flow network (m)."""
    n_nodes = rec.shape[0]
    for i in range(n_nodes):
        flen[i] = 0.0
    # order is sources-first, so walk it backwards (outlets first)
    for k in range(n_nodes - 1, -1, -1):
        n = order[k]
        r = rec[n]
        if r != n:
            flen[n] = flen[r] + rd[n]


@njit(cache=True)
def watershed_label(rec, order, cell, wl):
    """Label every cell with the index of the base-level cell it drains to."""
    n_nodes = rec.shape[0]
    for k in range(n_nodes - 1, -1, -1):
        n = order[k]
        r = rec[n]
        if r != n:
            wl[n] = wl[r]
        else:
            wl[n] = n
    return wl


# --------------------------------------------------------------------------
# D-infinity (Tarboton 1997)
# --------------------------------------------------------------------------
@njit(cache=True)
def dinf_weights(z, cell, w, mask):
    """D-infinity proportions to two downslope neighbours (Tarboton 1997).

    For each of the 8 facets (pairs of adjacent neighbour directions) the
    steepest-descent direction inside the triangular facet plane is found;

        s1 = (d2*(z0-z1) - d12*(z0-z2)) / (d1*d2 - d12^2)
        s2 = (d1*(z0-z2) - d12*(z0-z1)) / (d1*d2 - d12^2)

    with unit direction vectors e1, e2 (45 degrees apart).  The facet with the
    largest descent rate r = hypot(s1, s2) wins and flow is split between the
    two bounding neighbour directions in proportion to the angle (Tarboton
    eqs. 3-6).
    """
    ny, nx = z.shape
    for n in range(ny * nx):
        for k in range(8):
            w[n, k] = 0.0
    for j in range(ny):
        for i in range(nx):
            n = j * nx + i
            if mask[j, i]:
                continue
            rmax = 0.0
            alpha = 0.0
            kbest = -1
            for k in range(8):
                k2 = (k + 1) % 8
                i1 = i + NDX[k]
                j1 = j + NDY[k]
                i2 = i + NDX[k2]
                j2 = j + NDY[k2]
                if i1 < 0 or i1 >= nx or j1 < 0 or j1 >= ny or mask[j1, i1]:
                    continue
                if i2 < 0 or i2 >= nx or j2 < 0 or j2 >= ny or mask[j2, i2]:
                    continue
                z0 = z[j, i]
                z1 = z[j1, i1]
                z2 = z[j2, i2]
                d1 = 1.0
                d2 = 1.0
                d12 = 0.7071067811865476
                det = d1 * d2 - d12 * d12
                s1 = (d2 * (z0 - z1) - d12 * (z0 - z2)) / det
                s2 = (d1 * (z0 - z2) - d12 * (z0 - z1)) / det
                if s1 < 0.0 and s2 < 0.0:
                    continue
                if s1 < 0.0:
                    s1 = 0.0
                if s2 < 0.0:
                    s2 = 0.0
                r = np.sqrt(s1 * s1 + s2 * s2)
                if r > rmax:
                    rmax = r
                    alpha = np.arctan2(s2, s1)      # 0..pi/2 within the facet
                    if alpha < 0.0:
                        alpha = 0.0
                    if alpha > np.pi / 4.0:
                        alpha = np.pi / 4.0
                    kbest = k
            if kbest < 0 or rmax <= 0.0:
                continue
            k2 = (kbest + 1) % 8
            w[n, kbest] += 1.0 - (alpha / (np.pi / 4.0))
            w[n, k2] += alpha / (np.pi / 4.0)


@njit(cache=True)
def mfd_weights(z, cell, p, w, mask, dist=True):
    """Multiple-flow-direction weights (Freeman 1991; Quinn et al. 1991).

    w_k  ~  (max(0, S_k))^p , normalised per cell.
    """
    ny, nx = z.shape
    for n in range(ny * nx):
        for k in range(8):
            w[n, k] = 0.0
    for j in range(ny):
        for i in range(nx):
            n = j * nx + i
            if mask[j, i]:
                continue
            tot = 0.0
            for k in range(8):
                ii = i + NDX[k]
                jj = j + NDY[k]
                if ii < 0 or ii >= nx or jj < 0 or jj >= ny or mask[jj, ii]:
                    continue
                s = (z[j, i] - z[jj, ii]) / (NDIST[k] * cell if dist else 1.0)
                if s > 0.0:
                    v = s ** p
                    w[n, k] = v
                    tot += v
            if tot > 0.0:
                for k in range(8):
                    w[n, k] /= tot


# --------------------------------------------------------------------------
# high level driver
# --------------------------------------------------------------------------
def route(z, cell, fill=True, eps_m=None, mask=None, weights=None):
    """Compute flow routing products for a heightfield.

    Returns a dict with receivers, stack order, drained area, flow length,
    watershed labels, filled surface and the depression catalogue.
    """
    z = np.ascontiguousarray(z, dtype=np.float64)
    ny, nx = z.shape
    if mask is None:
        mask = np.zeros((ny, nx), dtype=np.bool_)
    if eps_m is None:
        eps_m = 1e-5

    zf = z.copy()
    closed = np.zeros_like(mask)
    label = np.zeros((ny, nx), dtype=np.int32)
    n_out = 0
    if fill:
        n_out = priority_flood(zf, cell, eps_m, closed, label, mask)

    n = ny * nx
    rec = np.empty(n, dtype=np.int64)
    rd = np.empty(n, dtype=np.float64)
    d8_receivers(zf, cell, rec, rd, mask)

    order = np.empty(n, dtype=np.int64)
    ndon = np.empty(n, dtype=np.int64)
    stack_order(rec, order, ndon)

    if weights is None:
        weights = np.ones(n, dtype=np.float64)
    area = np.empty(n, dtype=np.float64)
    accumulate(rec, order, np.ascontiguousarray(weights, dtype=np.float64), area, cell * cell)

    flen = np.empty(n, dtype=np.float64)
    flow_length(rec, rd, order, cell, flen)

    wl = np.empty(n, dtype=np.int64)
    watershed_label(rec, order, cell, wl)

    return dict(
        z_filled=zf.reshape(ny, nx),
        filled=(zf != z).any(),
        receiver=rec.reshape(ny, nx),
        receiver_dist=rd.reshape(ny, nx),
        order=order,
        ndonors=ndon.reshape(ny, nx),
        area=area.reshape(ny, nx),
        flow_length=flen.reshape(ny, nx),
        watershed=wl.reshape(ny, nx),
        pit_label=label,
        n_outlets=n_out,
        eps=eps_m,
    )


@njit(cache=True)
def _mfd_accumulate_cells(w, ptr, idx, order, area):
    """Accumulate cell counts with multiple-flow weights, in the given order.

    The order must be non-increasing in elevation (direct-driver order), which is
    the exact condition for every cell's inflow to be complete before it pushes
    its own water downstream -- D8 stack orders do not satisfy this when flow is
    split, because a cell can receive from a neighbour that is not its dominant
    donor.
    """
    n = area.shape[0]
    for k in range(n):
        node = order[k]
        a = area[node] + 1.0
        area[node] = a
        for t in range(ptr[node], ptr[node + 1]):
            area[idx[t]] += a * w[t]
    return area


def route_multi(z: np.ndarray, cell: float, p: float = 1.1, fill: bool = True,
                eps_m: float = 1e-5, mask: np.ndarray | None = None):
    """Multi-directional (D-infinity-like) routing products for the erosion solvers.

    Returns a dict with

    ``receiver``      dominant (steepest) receiver per cell -- used for the
                      downstream ordering and diagnostics only
    ``ptr, idx, wts`` CSR description of *all* positive-weight receivers, so the
                      implicit erosion solve can use the weighted-mean receiver
                      elevation instead of the single D8 neighbour
    ``order``         cells sorted by *descending* filled elevation.  The implicit
                      sweep iterates this backwards (ascending elevation), which
                      guarantees every receiver is updated before its donor; the
                      accumulation runs it forwards.
    ``area``          drained area, m^2

    Why this exists: D8 assigns every cell to exactly one of eight directions, so
    a network locks onto the grid axes and carves 45-degree zigzag trenches -- a
    well-documented artefact of single-direction routing.  Spreading the flow
    over all downslope neighbours (Freeman 1991; Quinn et al. 1991; Tarboton 1997)
    removes the directional quantisation and produces the smooth, branching,
    real-looking networks this generator is for.
    """
    z = np.ascontiguousarray(z, dtype=np.float64)
    ny, nx = z.shape
    if mask is None:
        mask = np.zeros((ny, nx), dtype=np.bool_)
    zf = z.copy()
    if fill:
        closed = np.zeros_like(mask)
        label = np.zeros((ny, nx), dtype=np.int32)
        priority_flood(zf, cell, eps_m, closed, label, mask)

    n = ny * nx
    w8 = np.zeros((n, 8), dtype=np.float64)
    mfd_weights(zf, cell, p, w8, mask)

    # ---- dominant receiver
    rec = np.empty(n, dtype=np.int64)
    rd = np.empty(n, dtype=np.float64)
    d8_receivers(zf, cell, rec, rd, mask)
    kbest = w8.argmax(axis=1)
    has = w8.max(axis=1) > 0.0
    jj = (np.arange(n) // nx)[has] + NDY[kbest[has]]
    ii = (np.arange(n) % nx)[has] + NDX[kbest[has]]
    dom = np.arange(n, dtype=np.int64)
    dom[has] = jj * nx + ii
    ddist = np.full(n, cell, dtype=np.float64)
    ddist[has] = NDIST[kbest[has]] * cell
    rec = dom
    rd = ddist

    # ---- CSR of all positive-weight receivers
    cnt = (w8 > 0.0).sum(axis=1).astype(np.int64)
    ptr = np.zeros(n + 1, dtype=np.int64)
    np.cumsum(cnt, out=ptr[1:])
    m = int(ptr[-1])
    idx = np.empty(m, dtype=np.int64)
    wts = np.empty(m, dtype=np.float64)
    if m > 0:
        rows, cols = np.nonzero(w8 > 0.0)
        jj2 = (rows // nx) + NDY[cols]
        ii2 = (rows % nx) + NDX[cols]
        idx[:] = jj2 * nx + ii2
        wts[:] = w8[rows, cols]

    # ---- ordering.  The erosion sweep walks this array *backwards* and needs
    # every receiver solved before the node itself, i.e. ascending elevation;
    # accumulation needs the opposite.  A single descending array serves both.
    order = np.argsort(-zf.reshape(-1), kind="stable").astype(np.int64)
    area = np.zeros(n, dtype=np.float64)
    _mfd_accumulate_cells(wts, ptr, idx, order, area)

    return dict(z_filled=zf, receiver=rec.reshape(ny, nx),
                receiver_dist=rd.reshape(ny, nx), order=order,
                area=(area * (cell * cell)).reshape(ny, nx),
                ptr=ptr, idx=idx, wts=wts, n_receivers=int(m))


def flow_accumulation_mfd(z, cell, p=1.1, fill=True, eps_m=None, mask=None, weights=None):
    """Multiple-flow accumulation, returns specific catchment area (m)."""
    z = np.ascontiguousarray(z, dtype=np.float64)
    ny, nx = z.shape
    if mask is None:
        mask = np.zeros((ny, nx), dtype=np.bool_)
    zf = z.copy()
    if fill:
        closed = np.zeros_like(mask)
        label = np.zeros((ny, nx), dtype=np.int32)
        priority_flood(zf, cell, 1e-5 if eps_m is None else eps_m, closed, label, mask)

    n = ny * nx
    w = np.zeros((n, 8), dtype=np.float64)
    mfd_weights(zf, cell, p, w, mask)
    rec = np.empty(n, dtype=np.int64)
    rd = np.empty(n, dtype=np.float64)
    d8_receivers(zf, cell, rec, rd, mask)
    order = np.empty(n, dtype=np.int64)
    ndon = np.empty(n, dtype=np.int64)
    stack_order(rec, order, ndon)

    if weights is None:
        weights = np.ones(n, dtype=np.float64)
    wsum = weights.astype(np.float64).copy()
    # accumulate in topological order and push fractions downstream
    acc = np.zeros(n, dtype=np.float64)
    for k in range(n):
        node = order[k]
        a = acc[node] + wsum[node]
        acc[node] = a
        for d in range(8):
            ww = w[node, d]
            if ww <= 0.0:
                continue
            j = node // nx + NDY[d]
            i = node % nx + NDX[d]
            if i < 0 or i >= nx or j < 0 or j >= ny:
                continue
            wsum[j * nx + i] += a * ww
    # acc counts cells; specific catchment area a = N * cell^2 / cell = N * cell
    return acc.reshape(ny, nx) * cell


def wetness_index(z, cell, p=1.1, slope_floor_deg=0.1):
    """Topographic wetness index TWI = ln(a / tan beta), Beven & Kirkby (1979)."""
    a = flow_accumulation_mfd(z, cell, p=p)
    gx = np.gradient(z.astype(np.float64), cell, axis=1)
    gy = np.gradient(z.astype(np.float64), cell, axis=0)
    tanb = np.hypot(gx, gy)
    tanb = np.maximum(tanb, np.tan(np.radians(slope_floor_deg)))
    return np.log(np.maximum(a, 1e-6) / tanb).astype(np.float32)


def height_above_nearest_drainage(z, cell, area_threshold_cells=200, fill=True):
    """HAND: elevation above the nearest channel cell (Nobre et al. 2011)."""
    r = route(z, cell, fill=fill)
    area = r["area"]
    thr = area_threshold_cells * cell * cell
    chan = area >= thr
    if not chan.any():
        return np.zeros_like(z, dtype=np.float32)
    zf = r["z_filled"]
    order = r["order"]
    rec = r["receiver"].ravel()
    ny, nx = zf.shape
    ref = np.full(ny * nx, np.nan, dtype=np.float64)
    for k in range(ny * nx):
        nn = order[k]
        if chan.ravel()[nn]:
            ref[nn] = zf.ravel()[nn]
    for k in range(ny * nx - 1, -1, -1):
        nn = order[k]
        rn = rec[nn]
        if rn != nn and np.isnan(ref[nn]):
            ref[nn] = ref[rn]
    hand = zf.ravel() - ref
    hand = np.where(np.isnan(hand), 0.0, hand)
    return hand.reshape(ny, nx).astype(np.float32)


def chi_coordinate(z, cell, m_over_n=0.45, a0=None, fill=True):
    """Chi, the integral transform of drainage area (Willett et al. 2014, Science
    343, 1248765): chi = integral (A0/A)^(m/n) dl along the flow path.

    Used here for quantitative validation of the stream-power solver: in
    topographic steady state z is linear in chi.
    """
    r = route(z, cell, fill=fill)
    area = r["area"].ravel()
    rec = r["receiver"].ravel()
    order = r["order"]
    flen = r["flow_length"].ravel()
    n = area.shape[0]
    if a0 is None:
        a0 = float(np.median(area[area > 0])) if np.any(area > 0) else cell * cell
    chi = np.zeros(n, dtype=np.float64)
    # order is sources-first, so traverse in reverse (outlets first)
    for k in range(n - 1, -1, -1):
        nn = order[k]
        rn = rec[nn]
        if rn == nn:
            chi[nn] = 0.0
        else:
            dl = flen[nn] - flen[rn]
            am = 0.5 * (area[nn] + area[rn])
            am = max(am, cell * cell)
            chi[nn] = chi[rn] + dl * (a0 / am) ** m_over_n
    return chi.reshape(z.shape)
