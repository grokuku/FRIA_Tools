"""
FR.IA — ComfyUI extension.
ComfyUI charge ce fichier quand le dossier est dans custom_nodes/.
On importe les nodes depuis le sous-dossier FRIA_ComfyUI/.
"""
import importlib.util
import os

_base = os.path.dirname(os.path.abspath(__file__))

def _load_module(filepath, name):
    """Charge un fichier Python comme module par son chemin absolu."""
    spec = importlib.util.spec_from_file_location(name, filepath)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

# Charger les nodes depuis FRIA_ComfyUI/nodes/
_nodes_dir = os.path.join(_base, "FRIA_ComfyUI", "nodes")

_elements_mod = _load_module(
    os.path.join(_nodes_dir, "elements_node.py"),
    "FRIAElementsNode"
)
_enhance_mod = _load_module(
    os.path.join(_nodes_dir, "enhance_node.py"),
    "FRIAEnhanceNode"
)
_diag_mod = _load_module(
    os.path.join(_nodes_dir, "diagnostic_node.py"),
    "FRIADiagnosticNode"
)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "web"

if _elements_mod and hasattr(_elements_mod, "FRIAElementsNode"):
    cls = _elements_mod.FRIAElementsNode
    NODE_CLASS_MAPPINGS["FRIAElementsNode"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIAElementsNode"] = "FR.IA Elements Picker"

if _enhance_mod and hasattr(_enhance_mod, "FRIAEnhanceNode"):
    cls = _enhance_mod.FRIAEnhanceNode
    NODE_CLASS_MAPPINGS["FRIAEnhanceNode"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIAEnhanceNode"] = "FR.IA Prompt Enhancer"

if _diag_mod and hasattr(_diag_mod, "FRIADiagnosticNode"):
    cls = _diag_mod.FRIADiagnosticNode
    NODE_CLASS_MAPPINGS["FRIADiagnosticNode"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIADiagnosticNode"] = "FR.IA Diagnostic"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
