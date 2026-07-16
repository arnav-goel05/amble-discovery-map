import bpy
import pathlib
import sys

ADDON_PATH = pathlib.Path(
    "/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/external-tools/blender-mcp/addon.py"
)

print(f"Blender MCP setup: installing addon from {ADDON_PATH}")

if not ADDON_PATH.exists():
    print(f"Blender MCP setup failed: addon not found at {ADDON_PATH}")
    sys.exit(1)

try:
    bpy.ops.preferences.addon_install(filepath=str(ADDON_PATH), overwrite=True)
except Exception as error:
    print(f"Blender MCP setup: addon install raised {error!r}; continuing to enable")

try:
    bpy.ops.preferences.addon_enable(module="addon")
except Exception as first_error:
    print(f"Blender MCP setup: enable as 'addon' raised {first_error!r}; trying 'blender_mcp'")
    try:
        bpy.ops.preferences.addon_enable(module="blender_mcp")
    except Exception as second_error:
        print(f"Blender MCP setup failed: could not enable addon: {second_error!r}")
        sys.exit(1)

scene = bpy.context.scene
scene.blendermcp_port = 9876
scene.blendermcp_auto_start_server = True

try:
    bpy.ops.wm.save_userpref()
except Exception as error:
    print(f"Blender MCP setup: could not save user preferences: {error!r}")

try:
    bpy.ops.blendermcp.start_server()
except Exception as error:
    print(f"Blender MCP setup failed: could not start server: {error!r}")
    sys.exit(1)

print("Blender MCP setup complete: addon enabled, server requested on localhost:9876")
