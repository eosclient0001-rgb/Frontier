# Complete 256 Marching Cubes Table Generator using 3D cube rotation group
# Corner numbering:
# 0: (0,0,0), 1: (1,0,0), 2: (1,1,0), 3: (0,1,0), 4: (0,0,1), 5: (1,0,1), 6: (1,1,1), 7: (0,1,1)

# Edges:
# 0: 0-1, 1: 1-2, 2: 2-3, 3: 3-0
# 4: 4-5, 5: 5-6, 6: 6-7, 7: 7-4
# 8: 0-4, 9: 1-5, 10: 2-6, 11: 3-7

import json

# Define the 8 corner coordinate tuples
corners = [
    (0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
    (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)
]

# Map from pair of corner indices to edge index
edge_map = {}
edge_corners = [
    (0, 1), (1, 2), (2, 3), (3, 0),
    (4, 5), (5, 6), (6, 7), (7, 4),
    (0, 4), (1, 5), (2, 6), (3, 7)
]
for idx, (c1, c2) in enumerate(edge_corners):
    edge_map[(c1, c2)] = idx
    edge_map[(c2, c1)] = idx

# 24 rotations of the cube in 3D
def get_cube_rotations():
    rotations = []
    # All 24 orthogonal 3x3 matrices with det = 1
    import itertools
    for p in itertools.permutations([0, 1, 2]):
        for s0 in [-1, 1]:
            for s1 in [-1, 1]:
                for s2 in [-1, 1]:
                    # check det
                    det = (s0 * s1 * s2) * (1 if p in [(0,1,2), (1,2,0), (2,0,1)] else -1)
                    if det == 1:
                        rotations.append((p, (s0, s1, s2)))
    
    cube_maps = []
    for (px, py, pz), (sx, sy, sz) in rotations:
        # Transform corners centered at (0.5, 0.5, 0.5)
        c_map = []
        for c in corners:
            # Center to [-0.5, 0.5]
            cx, cy, cz = c[0] - 0.5, c[1] - 0.5, c[2] - 0.5
            coords = [cx, cy, cz]
            rx = coords[px] * sx
            ry = coords[py] * sy
            rz = coords[pz] * sz
            # Uncenter
            new_c = (round(rx + 0.5), round(ry + 0.5), round(rz + 0.5))
            c_map.append(corners.index(new_c))
        cube_maps.append(c_map)
    return cube_maps

rot_maps = get_cube_rotations()
print("Generated", len(rot_maps), "rotation maps")

# The 15 base canonical cases in Marching Cubes:
# (Active corners bitmask, list of triangle edge tuples)
BASE_CASES = [
    # Case 0: 0 inside
    (0, []),
    # Case 1: 1 inside (corner 0)
    (1, [(0, 8, 3)]),
    # Case 2: 2 adjacent inside (corners 0, 1)
    (3, [(1, 8, 3), (9, 8, 1)]),
    # Case 3: 2 diagonal inside on same face (corners 0, 2)
    (5, [(0, 8, 3), (1, 2, 10)]),
    # Case 4: 2 diagonal inside through body (corners 0, 6)
    (65, [(0, 8, 3), (5, 6, 10)]),
    # Case 5: 3 corners on face (corners 0, 1, 2)
    (7, [(2, 8, 3), (10, 8, 2), (9, 8, 10)]),
    # Case 6: 3 corners forming right angle (corners 0, 1, 5)
    (35, [(0, 8, 3), (4, 9, 1), (8, 4, 1)]),
    # Case 7: 3 corners, two diagonal (corners 0, 2, 5)
    (37, [(0, 8, 3), (1, 2, 10), (4, 5, 9)]),
    # Case 8: 4 corners on one face (corners 0, 1, 2, 3)
    (15, [(8, 9, 11), (9, 10, 11)]),
    # Case 9: 4 corners forming U-shape (corners 0, 1, 2, 5)
    (39, [(2, 8, 3), (10, 8, 2), (4, 8, 10), (4, 10, 5)]),
    # Case 10: 4 corners alternating (corners 0, 2, 5, 7)
    (165, [(0, 8, 3), (1, 2, 10), (4, 5, 9), (6, 7, 11)]),
    # Case 11: 4 corners, 3 on face + 1 opposite (corners 0, 1, 2, 6)
    (71, [(2, 8, 3), (10, 8, 2), (9, 8, 10), (5, 6, 10)]),
    # Case 12: 4 corners forming diagonal band (corners 0, 1, 5, 6)
    (99, [(0, 8, 3), (8, 4, 3), (4, 7, 3), (1, 10, 2), (1, 6, 10), (1, 5, 6)]), # will verify inversion
    # Case 13: 4 corners, saddle (corners 0, 1, 6, 7)
    (203, [(1, 8, 3), (9, 8, 1), (6, 7, 10), (7, 11, 10)]),
    # Case 14: 7 corners (inversion of case 1)
    (254, [(0, 3, 8)]),
]

# Build complete 256-case table
tri_table = [None] * 256
edge_table = [0] * 256

def apply_rotation(case_mask, tris, r_map):
    # New bitmask
    new_mask = 0
    for old_c in range(8):
        if case_mask & (1 << old_c):
            new_c = r_map[old_c]
            new_mask |= (1 << new_c)
    
    # Map edges
    new_tris = []
    for tri in tris:
        new_tri = []
        for old_e in tri:
            c1, c2 = edge_corners[old_e]
            nc1, nc2 = r_map[c1], r_map[c2]
            new_e = edge_map[(nc1, nc2)]
            new_tri.append(new_e)
        new_tris.append(tuple(new_tri))
    return new_mask, new_tris

def invert_case(case_mask, tris):
    new_mask = (~case_mask) & 0xFF
    # Flip triangle winding
    new_tris = [(t[0], t[2], t[1]) for t in tris]
    return new_mask, new_tris

# Seed from standard cases + rotations + inversions
for mask, tris in BASE_CASES:
    for r in rot_maps:
        rmask, rtris = apply_rotation(mask, tris, r)
        if tri_table[rmask] is None:
            tri_table[rmask] = rtris
        
        # Invert
        imask, itris = invert_case(rmask, rtris)
        if tri_table[imask] is None:
            tri_table[imask] = itris

unfilled = [i for i in range(256) if tri_table[i] is None]
print("Unfilled cases count:", len(unfilled), unfilled)
