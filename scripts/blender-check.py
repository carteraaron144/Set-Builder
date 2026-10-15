"""Headless Blender import check for a Set Builder .glb export.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender-check.py -- <file.glb> [scene size in m]

Prints the object count, the scene's horizontal extent (metres), sample names, the number of -col objects, whether
any mesh has custom normals, and whether the terrain material uses its vertex colours. Exits 1 on a mismatch.
"""
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if not args:
    print("usage: blender -b --python scripts/blender-check.py -- <file.glb> [size]")
    sys.exit(2)
path = args[0]
size = float(args[1]) if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

objects = list(bpy.context.scene.objects)
meshes = [o for o in objects if o.type == "MESH"]
cols = [o for o in objects if o.name.endswith("-col")]
# Measure the terrain where it is its own object; merged exports include trees that may overhang the edge slightly.
terrain_objs = [o for o in meshes if o.name.startswith("terrain_c") and not o.name.endswith("-col")]
measured = terrain_objs or [o for o in meshes if not o.name.endswith("-col")]
tolerance = 1.0 if terrain_objs else 6.0
xs, ys, zs = [], [], []
for o in measured:
    for corner in o.bound_box:
        w = o.matrix_world @ __import__("mathutils").Vector(corner)
        xs.append(w.x)
        ys.append(w.y)
        zs.append(w.z)
extent_x = max(xs) - min(xs)
extent_y = max(ys) - min(ys)
custom_normals = sum(1 for o in meshes if o.data.has_custom_normals)
terrain = next((o for o in meshes if (o.name.startswith(("terrain_c", "chunk_")) or o.name == "scene") and not o.name.endswith("-col")), None)
colour_attr = bool(terrain and terrain.data.color_attributes)
material_uses_colour = False
if terrain and terrain.active_material and terrain.active_material.node_tree:
    material_uses_colour = any(n.type in ("VERTEX_COLOR", "ATTRIBUTE") for n in terrain.active_material.node_tree.nodes)

print(f"CHECK objects={len(objects)} meshes={len(meshes)} col={len(cols)}")
print(f"CHECK extent_m={extent_x:.2f} x {extent_y:.2f} (height {max(zs) - min(zs):.2f})")
print(f"CHECK sample_names={[o.name for o in objects[:3]]}")
print(f"CHECK custom_normals={custom_normals}")
print(f"CHECK terrain_colour_attribute={colour_attr} material_uses_colour={material_uses_colour}")

ok = True
if size is not None and not (size - 1 <= extent_x <= size + tolerance and size - 1 <= extent_y <= size + tolerance):
    print(f"CHECK FAIL: extent is not {size} m")
    ok = False
if not cols:
    print("CHECK FAIL: no -col objects")
    ok = False
sys.exit(0 if ok else 1)
