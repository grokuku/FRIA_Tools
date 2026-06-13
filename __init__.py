"""
FR.IA — ComfyUI extension.
ComfyUI charge ce fichier quand le dossier est dans custom_nodes/.
On importe les nodes depuis le sous-dossier FRIA_ComfyUI/.
"""
import importlib.util
import os
import sys

# Acces au serveur HTTP de ComfyUI pour enregistrer des routes
try:
    import server
    _routes = server.PromptServer.instance.routes
except Exception:
    _routes = None

_base = os.path.dirname(os.path.abspath(__file__))

# Ajouter _base au sys.path pour permettre `from FRIA_ComfyUI import X`
# (le repo est installe dans custom_nodes/<repo>/ donc _base est
# custom_nodes/FRIA_Tools/ et FRIA_ComfyUI/ est a cote).
if _base not in sys.path:
    sys.path.insert(0, _base)

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
_ideogram4_mod = _load_module(
    os.path.join(_nodes_dir, "ideogram4_node.py"),
    "FRIAIdeogram4Node"
)
_ideogram_prep_mod = _load_module(
    os.path.join(_nodes_dir, "ideogram_prep_node.py"),
    "FRIAIdeogramPrepNode"
)
_ideogram_parse_mod = _load_module(
    os.path.join(_nodes_dir, "ideogram_parse_node.py"),
    "FRIAIdeogramParseNode"
)
_prep_mod = _load_module(
    os.path.join(_nodes_dir, "prep_node.py"),
    "FRIAPromptPrepNode"
)
_diag_mod = _load_module(
    os.path.join(_nodes_dir, "diagnostic_node.py"),
    "FRIADiagnosticNode"
)

# Charger le module update_manager (utilise par les routes HTTP ci-dessous)
_update_manager_mod = _load_module(
    os.path.join(_base, "FRIA_ComfyUI", "update_manager.py"),
    "FRIAUpdateManager"
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

if _ideogram4_mod and hasattr(_ideogram4_mod, "FRIAIdeogram4Node"):
    cls = _ideogram4_mod.FRIAIdeogram4Node
    NODE_CLASS_MAPPINGS["FRIAIdeogram4Node"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIAIdeogram4Node"] = "FR.IA Ideogram 4 Builder"

if _ideogram_prep_mod and hasattr(_ideogram_prep_mod, "FRIAIdeogramPrepNode"):
    cls = _ideogram_prep_mod.FRIAIdeogramPrepNode
    NODE_CLASS_MAPPINGS["FRIAIdeogramPrepNode"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIAIdeogramPrepNode"] = "FR.IA Ideogram Prep"

if _ideogram_parse_mod and hasattr(_ideogram_parse_mod, "FRIAIdeogramParseNode"):
    cls = _ideogram_parse_mod.FRIAIdeogramParseNode
    NODE_CLASS_MAPPINGS["FRIAIdeogramParseNode"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIAIdeogramParseNode"] = "FR.IA Ideogram Parse"

if _prep_mod and hasattr(_prep_mod, "FRIAPromptPrepNode"):
    cls = _prep_mod.FRIAPromptPrepNode
    NODE_CLASS_MAPPINGS["FRIAPromptPrepNode"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIAPromptPrepNode"] = "FR.IA Prompt Prep"

if _diag_mod and hasattr(_diag_mod, "FRIADiagnosticNode"):
    cls = _diag_mod.FRIADiagnosticNode
    NODE_CLASS_MAPPINGS["FRIADiagnosticNode"] = cls
    NODE_DISPLAY_NAME_MAPPINGS["FRIADiagnosticNode"] = "FR.IA Diagnostic"

# ── Routes HTTP (update + restart) ──────────────────────────────────
# Ces routes sont appelees par le menu ComfyUI (fria_menu.js) pour
# mettre a jour le repo Git local. Elles n'interagissent PAS avec le
# backend distant — tout reste sur la machine ComfyUI.

if _routes is not None and _update_manager_mod is not None:
    from aiohttp import web as _aio_web

    @_routes.post("/fr_ia/update")
    async def _fr_ia_update_route(request):
        try:
            result = _update_manager_mod.update_repo()
            return _aio_web.json_response(result)
        except Exception as e:
            import traceback
            return _aio_web.json_response({
                "status": "error",
                "message": f"Exception: {e}",
                "log": traceback.format_exc(),
                "updated": False,
            }, status=500)

    @_routes.post("/fr_ia/restart")
    async def _fr_ia_restart_route(request):
        try:
            result = _update_manager_mod.restart_server()
            return _aio_web.json_response(result)
        except Exception as e:
            import traceback
            return _aio_web.json_response({
                "status": "error",
                "message": f"Exception: {e}",
                "log": traceback.format_exc(),
            }, status=500)

    print("[FR.IA] Update routes registered: POST /fr_ia/update, /fr_ia/restart")
else:
    # Si les routes ne sont pas enregistrees, on ne fait rien de plus
    # (l'item "Update" du menu ne fonctionnera pas, mais l'extension
    # reste chargee pour les nodes)
    pass

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
