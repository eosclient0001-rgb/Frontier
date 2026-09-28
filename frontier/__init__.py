"""
Frontier — Geologically-driven SDF → Mesh Rock / Spire / Cliff generator
No textures. All detail is carried in tessellated geometry via hardness-stratified
differential erosion, joint / columnar fracture networks, and environment-driven
weathering (tafoni, frost-wedging, basal sapping, aeolian fluting).

References implemented:
 - Differential erosion & cliff-and-bench topography [WorldAtlas, NPS, Mesa Wiki]
 - Hoodoo caprock protection model — Bryce Claron Fm. (limestone/mudstone cap)
 - Centroidal Voronoi columnar jointing with CV control [Di et al. 2018 Baihetan]
 - VSRD pentagon/hexagon control for columnar basalt [ScienceDirect 2025]
 - Tafoni case-hardening vs salt crystallization model [Mol & Viles 2010; Goudie]
"""
__version__ = "0.1.0"
