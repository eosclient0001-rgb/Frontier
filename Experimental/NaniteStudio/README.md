# Frontier Nanite & Cluster LOD Virtual Geometry Studio

An interactive WebGL2 Virtual Geometry studio inspired by **Epic Games' Unreal Engine 5 Nanite** and **bdwhst's Vulcanite** (`https://github.com/bdwhst/Vulcanite`), built in the **Project Zero Editor** design language (`arena/429d7dc7-frontier`).

---

## 🌟 Overview & Architecture

Nanite Virtual Geometry breaks traditional discrete LOD barriers by decomposing high-polygon 3D meshes into small, tightly-bounded geometric clusters (~64 triangles each). Clusters are organized into a Directed Acyclic Graph (DAG) hierarchy with monotonically increasing geometric error metrics. At runtime, screen-space error projection and frustum/cone culling continuously select a seamless surface cut across varying camera distances.

### Key Innovations Implemented:

1. **Spatial K-Means Cluster Partitioning (`NaniteMesh.js`)**:
   - Precomputes triangle centroids and iteratively partitions the mesh into uniform, sliver-free clusters targeting 64 triangles.
   - Computes local bounding spheres, oriented AABBs, and normal bounding cones ($\vec{a}, \cos\theta$) for every cluster.

2. **Hierarchical DAG Construction & Boundary Locking**:
   - Groups adjacent clusters (clusters per group $\approx 4$).
   - Welds group vertices by spatial hashing and extracts external boundary edges (incident to exactly 1 triangle in the group).
   - **Locks boundary vertices** during Quadric Error Metric (QEM) edge collapse decimation to guarantee **zero T-junctions or cracks** between clusters across different LOD levels.
   - Simplifies interior geometry by ~50% and re-partitions into parent clusters.

3. **Monotonic Error Propagation & Vulcanite Continuous LOD Cut**:
   - Ensures strict DAG monotonicity: $\text{parentError} > \text{clusterError}$.
   - Evaluates screen-projected pixel error:
     $$\epsilon = \delta \cdot \frac{H}{2 \cdot d \cdot \tan(\text{fov} / 2)}$$
   - Evaluates the dual cut condition:
     $$(\text{projectedParentError} > \tau) \quad \land \quad (\text{projectedClusterError} \le \tau)$$
   - Seamlessly selects fine clusters near the camera and coarse parent clusters in the distance without pops or popping artifacts.

4. **Hierarchical Visibility Culling**:
   - **View Frustum Culling**: Cluster bounding sphere vs. 6 camera frustum half-spaces ($Ax + By + Cz + D \ge -R$).
   - **Backface Normal Cone Culling**: Dot product of cone axis and view direction against cone opening cutoff angle ($\vec{n}_{\text{cone}} \cdot \vec{v}_{\text{cam}} < -\sin\theta$).
   - **Freeze Culling Camera Mode**: Decouples the LOD selection camera from the inspection camera to visualize culled clusters and view frustum boundaries from a bird's-eye perspective.

5. **Multi-Instance Grid Acceleration**:
   - Supports single assets up to massive instanced scenes ($1 \times 1$, $3 \times 3$, $5 \times 5$, $10 \times 10$, and $20 \times 20$ instance grids) with per-instance world matrices and LOD evaluation.

6. **Rich Visual Diagnostics & View Modes**:
   - **Standard Lit / PBR**: Diffuse shading with directional key and fill lighting.
   - **Cluster IDs**: Unique deterministic RGB coloring for each distinct cluster.
   - **LOD Level Ramp**: Distinct color ramp indicating DAG depth (LOD 0 = Emerald Green, LOD 1 = Cyan, LOD 2 = Warm Yellow, LOD 3 = Vivid Orange, LOD 4+ = Hot Coral).
   - **Barycentric Wireframe**: Sub-pixel single-pass wireframe computed via hardware derivatives (`fwidth`).
   - **Cluster Seams**: Thick golden highlight along cluster boundaries.
   - **Normals**: World-space surface normal visualization.
   - **Error Heatmap**: Pixel error gradient from dark green (zero error) to bright red (maximum error).

7. **Project Zero Editor Design System**:
   - Native DM Sans typography, trapezoidal active tab strips, collapsible Control Notch with quick actions, three-column responsive layout (Outliner, GPU Viewport, Nanite Depot Inspector), live telemetry cards, and slide-up Content Browser drawer.

---

## 🚀 Running the Studio

### 1. Launch Server

Start the standalone HTTP server on port 8096:

```bash
python3 Experimental/NaniteStudio/Serve.py 8096
```

Or run via repository-wide Experimental server on port 8080:

```bash
python3 Experimental/Serve.py 8080
```

Open your browser to:
- Standalone Studio: `http://localhost:8096/`
- Frontier Experimental Hub: `http://localhost:8080/Experimental/NaniteStudio/`

### 2. Run Test Suite

To run all 11 automated test suites:

```bash
node Experimental/NaniteStudio/NaniteStudioValidation.mjs
```

---

## 📂 Project Structure

```
Experimental/NaniteStudio/
├── Assets/
│   └── Suzanne.obj                     # High-detail monkey reference model
├── Engine/
│   ├── NaniteMesh.js                  # Virtual geometry DAG, K-means, QEM simplification, LOD cut
│   ├── NaniteGeometryGenerators.js    # Procedural geometry (Bunny, Dragon, Mountain, Sphere, Column) & OBJ parser
│   ├── NaniteWebGLRenderer.js         # WebGL2 rendering pipeline, barycentrics, cluster seams, grid
│   └── NaniteStudioController.js      # Studio state, camera orbit, cluster picking, UI telemetry
├── Fonts/
│   ├── dm-sans-latin-300-normal.woff2
│   ├── dm-sans-latin-400-normal.woff2
│   └── dm-sans-latin-500-normal.woff2
├── index.html                         # Project Zero Editor shell with Notch, Outliner, Depot & Drawer
├── ProjectZero.css                    # Project Zero design system foundation
├── Serve.py                           # Standalone multi-threaded HTTP server with MIME types
├── NaniteStudioValidation.mjs         # 11-suite automated unit & integration test runner
└── README.md                          # Documentation
```

---

## 🎮 Viewport Navigation & Controls

- **Left Mouse Click + Drag**: Orbit camera around target.
- **Right Mouse Click + Drag / Two-finger Pan**: Pan camera laterally and vertically.
- **Mouse Wheel**: Smooth dolly zoom in / out.
- **Left Click on Mesh**: Raycast pick cluster to inspect bounding sphere, triangle count, and DAG level.
- **`[F]` Key**: Frame active mesh in viewport.
- **`[Space]` Key**: Toggle Freeze Culling camera state.
- **`[1]` - `[6]` Keys**: Cycle diagnostic view modes (Lit, Cluster IDs, LOD Ramp, Wireframe, Seams, Normals).
