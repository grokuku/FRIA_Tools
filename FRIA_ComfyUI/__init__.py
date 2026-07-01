from .nodes.elements_node import FRIAElementsNode
from .nodes.enhance_node import FRIAEnhanceNode
from .nodes.ideogram4_node import FRIAIdeogram4Node
from .nodes.ideogram_prep_node import FRIAIdeogramPrepNode
from .nodes.ideogram_parse_node import FRIAIdeogramParseNode
from .nodes.prep_node import FRIAPromptPrepNode

from .nodes.diagnostic_node import FRIADiagnosticNode

# Import des modules helper (fonctions only, pas de route registration)
import logging as _logging
try:
    from .nodes.custom_nodes_manager import (
        _get_installed_custom_nodes,
        _install_custom_node,
    )
except Exception as e:
    _logging.error(f"[FR.IA] custom_nodes_manager import failed: {e}", exc_info=True)
    _get_installed_custom_nodes = lambda: []
    _install_custom_node = lambda u, n: {"success": False, "message": str(e)}

try:
    from .nodes.model_manager import (
        list_local_models,
        upload_model_to_server,
        download_model_from_server,
    )
except Exception as e:
    _logging.error(f"[FR.IA] model_manager import failed: {e}", exc_info=True)
    list_local_models = lambda: {}
    upload_model_to_server = lambda p, t="model": {"success": False, "error": str(e)}
    download_model_from_server = lambda u, f, t="model": {"success": False, "error": str(e)}

NODE_CLASS_MAPPINGS = {
    "FRIAElementsNode": FRIAElementsNode,
    "FRIAEnhanceNode": FRIAEnhanceNode,
    "FRIAIdeogram4Node": FRIAIdeogram4Node,
    "FRIAIdeogramPrepNode": FRIAIdeogramPrepNode,
    "FRIAIdeogramParseNode": FRIAIdeogramParseNode,
    "FRIAPromptPrepNode": FRIAPromptPrepNode,
    "FRIADiagnosticNode": FRIADiagnosticNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FRIAElementsNode": "FR.IA Elements Picker",
    "FRIAEnhanceNode": "FR.IA Prompt Enhancer",
    "FRIAIdeogram4Node": "FR.IA Ideogram 4 Builder",
    "FRIAIdeogramPrepNode": "FR.IA Ideogram Prep",
    "FRIAIdeogramParseNode": "FR.IA Ideogram Parse",
    "FRIAPromptPrepNode": "FR.IA Prompt Prep",
    "FRIADiagnosticNode": "FR.IA Diagnostic",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

# ── Routes aiohttp (pattern standard ComfyUI) ──
# Enregistrées directement ici avec le décorateur @server.PromptServer.instance.routes
# C'est le pattern utilisé par toutes les extensions ComfyUI — fiable.

import os
import logging

try:
    import server
    from aiohttp import web

    @server.PromptServer.instance.routes.get("/fria/custom-nodes")
    async def _fria_list_custom_nodes(request):
        """Liste des custom nodes installés + URLs git."""
        try:
            nodes = _get_installed_custom_nodes()
            return web.json_response({"nodes": nodes})
        except Exception as e:
            logging.exception(f"[FR.IA] list_custom_nodes error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    @server.PromptServer.instance.routes.post("/fria/custom-nodes/install")
    async def _fria_install_node(request):
        """Clone un custom node via git."""
        try:
            body = await request.json()
            git_url = body.get("git_url", "").strip()
            name = body.get("name", "").strip()
            if not git_url:
                return web.json_response({"error": "git_url required"}, status=400)
            result = _install_custom_node(git_url, name)
            status = 200 if result["success"] else 400
            return web.json_response(result, status=status)
        except Exception as e:
            logging.exception(f"[FR.IA] install_node error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    @server.PromptServer.instance.routes.get("/fria/models/list")
    async def _fria_list_models(request):
        """Liste les models locaux (toutes catégories)."""
        try:
            models = list_local_models()
            return web.json_response(models)
        except Exception as e:
            logging.exception(f"[FR.IA] list_models error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    @server.PromptServer.instance.routes.post("/fria/models/upload")
    async def _fria_upload_model(request):
        """Upload un model local vers le serveur FR.IA."""
        try:
            body = await request.json()
            filepath = body.get("path", "")
            file_type = body.get("type", "model")
            if not filepath or not os.path.isfile(filepath):
                return web.json_response({"error": "path required and must exist"}, status=400)
            result = upload_model_to_server(filepath, file_type)
            status = 200 if result["success"] else 400
            return web.json_response(result, status=status)
        except Exception as e:
            logging.exception(f"[FR.IA] upload_model error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    @server.PromptServer.instance.routes.post("/fria/models/download")
    async def _fria_download_model(request):
        """Download un model depuis FR.IA → sauvegarde locale."""
        try:
            body = await request.json()
            upload_id = body.get("upload_id", "")
            filename = body.get("filename", "")
            file_type = body.get("type", "model")
            if not upload_id or not filename:
                return web.json_response({"error": "upload_id and filename required"}, status=400)
            result = download_model_from_server(upload_id, filename, file_type)
            status = 200 if result["success"] else 400
            return web.json_response(result, status=status)
        except Exception as e:
            logging.exception(f"[FR.IA] download_model error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    logging.info("[FR.IA] All routes registered (custom-nodes, models)")

except Exception as e:
    logging.error(f"[FR.IA] Failed to register routes: {e}", exc_info=True)