import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "models" / "esplanade-concert-cutaway.glb"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()


def mat(name, color, metallic=0.0, roughness=0.65, alpha=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], alpha)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        material.blend_method = "BLEND"
        material.show_transparent_back = True
    return material


MAT_TRUSS = mat("matte black truss", (0.02, 0.025, 0.03), 0.0, 0.5)
MAT_METAL = mat("brushed light metal", (0.78, 0.82, 0.84), 0.25, 0.32)
MAT_BLUE = mat("blue performance light", (0.08, 0.55, 1.0), 0.0, 0.24)
MAT_MAGENTA = mat("magenta performance light", (1.0, 0.12, 0.55), 0.0, 0.24)
MAT_AMBER = mat("amber performance light", (1.0, 0.66, 0.1), 0.0, 0.28)
MAT_WHITE = mat("white follow spot", (1.0, 0.94, 0.78), 0.0, 0.22)
MAT_BLUE_BEAM = mat("transparent blue beam", (0.05, 0.52, 1.0), 0.0, 0.12, 0.52)
MAT_MAGENTA_BEAM = mat("transparent magenta beam", (1.0, 0.06, 0.58), 0.0, 0.12, 0.48)
MAT_AMBER_BEAM = mat("transparent amber beam", (1.0, 0.64, 0.08), 0.0, 0.12, 0.48)
MAT_WHITE_BEAM = mat("transparent warm spotlight", (1.0, 0.92, 0.62), 0.0, 0.12, 0.36)
MAT_GLOW = mat("soft venue glow", (1.0, 0.68, 0.18), 0.0, 0.42, 0.08)
MAT_CROWD = mat("crowd silhouettes", (0.03, 0.035, 0.045), 0.0, 0.62)
MAT_CROWD_ALT = mat("warm crowd accents", (0.95, 0.68, 0.2), 0.0, 0.55)


def cyl(name, loc, radius, depth, material, vertices=16, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def cube(name, loc, scale, material, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def cone(name, loc, radius1, radius2, depth, material, vertices=32, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def sphere(name, loc, radius, material, segments=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=8, radius=radius, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def add_light_tower(name, x, y, angle_degrees, lamp_material, beam_material, height=14.0):
    angle = math.radians(angle_degrees)
    cyl(f"{name} mast", (x, y, height / 2), 0.18, height, MAT_TRUSS, vertices=10)
    cube(f"{name} crossbar", (x, y, height), (4.6, 0.22, 0.22), MAT_METAL, rotation=(0, 0, angle))
    for idx, offset in enumerate([-0.95, 0.95]):
        lamp_x = x + math.cos(angle) * offset
        lamp_y = y + math.sin(angle) * offset
        cube(f"{name} lamp {idx}", (lamp_x, lamp_y, height - 0.45), (0.9, 0.62, 0.74), lamp_material, rotation=(0, 0, angle))

    # A tilted cone reads like a stadium/event beam at map scale.
    cone(
        f"{name} light wash",
        (x * 0.42, y * 0.42, height * 0.54),
        3.1,
        0.18,
        18.0,
        beam_material,
        vertices=36,
        rotation=(math.radians(62), 0, angle + math.pi),
    )


def add_crowd_cluster(name, center_x, center_y, radius, count):
    for idx in range(count):
        theta = (idx / count) * math.pi * 2 + (idx % 3) * 0.18
        ring = radius * (0.35 + 0.65 * ((idx % 5) / 4))
        x = center_x + math.cos(theta) * ring
        y = center_y + math.sin(theta) * ring * 0.72
        material = MAT_CROWD_ALT if idx % 6 == 0 else MAT_CROWD
        cyl(f"{name} body {idx}", (x, y, 0.65), 0.16, 1.1, material, vertices=8)
        sphere(f"{name} head {idx}", (x, y, 1.35), 0.18, material, segments=8)


# Tiny pools of warmth at each lighting cluster. Avoid a large disk that hides the real building.
for idx, (x, y, radius) in enumerate([(-11.5, -6.4, 4.0), (-8.0, 7.6, 3.4), (10.0, 5.8, 3.6), (11.0, -5.4, 3.2)]):
    cyl(f"event glow pool {idx}", (x, y, 0.03), radius, 0.04, MAT_GLOW, vertices=40)

# Four colored light towers arranged around the complex footprint.
add_light_tower("blue waterfront tower", -15.0, -7.2, 24, MAT_BLUE, MAT_BLUE_BEAM, height=15.5)
add_light_tower("magenta plaza tower", -10.0, 9.5, -18, MAT_MAGENTA, MAT_MAGENTA_BEAM, height=14.5)
add_light_tower("amber mall tower", 12.5, 7.8, -42, MAT_AMBER, MAT_AMBER_BEAM, height=14.0)
add_light_tower("warm bay tower", 14.5, -6.8, 36, MAT_WHITE, MAT_WHITE_BEAM, height=13.5)

# Small people clusters around the perimeter sell "performance" without adding a fake stage.
add_crowd_cluster("waterfront audience", -9.2, -7.3, 3.2, 10)
add_crowd_cluster("plaza audience", -3.0, 6.5, 2.7, 8)
add_crowd_cluster("theatre audience", 8.5, -2.8, 2.8, 8)

# Low perimeter markers imply event boundaries around the real building.
for idx, (x, y) in enumerate([(-14.0, -1.0), (-11.0, 5.2), (-4.0, 9.6), (4.8, 9.2), (12.2, 3.0), (13.7, -4.2), (5.2, -9.0), (-5.8, -9.5)]):
    cyl(f"event bollard {idx}", (x, y, 0.45), 0.11, 0.9, MAT_AMBER if idx % 2 else MAT_BLUE, vertices=10)

for obj in bpy.context.scene.objects:
    obj.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "public" / "models" / "esplanade-concert-cutaway.blend"))
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
)

print(f"Wrote {OUT}")
