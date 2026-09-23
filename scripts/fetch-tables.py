# Marching Cubes canonical table generator and verifier
import json

# Paul Bourke canonical base configurations:
# Corner offsets:
# 0: (0,0,0), 1: (1,0,0), 2: (1,1,0), 3: (0,1,0), 4: (0,0,1), 5: (1,0,1), 6: (1,1,1), 7: (0,1,1)
# Edge connections:
# 0: (0,1), 1: (1,2), 2: (2,3), 3: (3,0)  [z=0]
# 4: (4,5), 5: (5,6), 6: (6,7), 7: (7,4)  [z=1]
# 8: (0,4), 9: (1,5), 10: (2,6), 11: (3,7) [pillars]

CORNER_OFFSETS = [
    (0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
    (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)
]

EDGE_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 0),
    (4, 5), (5, 6), (6, 7), (7, 4),
    (0, 4), (1, 5), (2, 6), (3, 7)
]

# Fetch standard Paul Bourke table or define canonical rotations
# Let's verify by building canonical table from rotations of 15 base cases
# Or download Bourke's standard table
import urllib.request

url = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/jsm/objects/MarchingCubes.js"
try:
    req = urllib.request.urlopen(url, timeout=10)
    content = req.read().decode('utf-8')
    print("Successfully fetched Three.js MarchingCubes.js, length:", len(content))
    with open("three_mc.js", "w") as f:
        f.write(content)
except Exception as e:
    print("Could not fetch remote:", e)
