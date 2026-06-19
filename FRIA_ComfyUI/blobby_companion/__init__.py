"""
Blobby Companion — A friendly blob character for the ComfyUI canvas.
100% Canvas 2D, zero external assets.
"""

# Blobby is a pure frontend extension (no Python nodes).
# The JS file registers itself as a ComfyUI extension and hooks into the canvas.
# Activation is controlled via the FR.IA menu toggle in fria_menu.js.

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Note : les settings Blobby sont stockes en localStorage (plus fiable que le serveur ComfyUI)
# La persistence serveur via settings_api.py est desactivee car elle ralentit le rendu
# (trop de requetes fetch par mouvement de slider)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
