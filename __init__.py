"""
FR.IA — ComfyUI extension.
ComfyUI charge ce fichier quand le dossier est dans custom_nodes/.
On importe les nodes depuis FRIA_ComfyUI/.
"""
import importlib.util
import sys
import os

# Ajouter le sous-dossier FRIA_ComfyUI au path pour l'import
_subdir = os.path.join(os.path.dirname(__file__), "FRIA_ComfyUI")
if _subdir not in sys.path:
    sys.path.insert(0, _subdir)

from FRIA_ComfyUI import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
