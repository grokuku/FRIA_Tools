"""
FR.IA Custom Nodes Manager — Détection et installation de custom nodes.

Endpoints ajoutés au serveur ComfyUI (aiohttp) :
  GET  /fria/custom-nodes          → liste des nodes installés + URLs git
  POST /fria/custom-nodes/install  → git clone d'un node manquant

Usage côté JS (fria_workflow_share.js) :
  - Au partage : fetch('/fria/custom-nodes') pour enrichir required_nodes avec les URLs
  - À l'install : fetch('/fria/custom-nodes/install', {url, name}) pour cloner
"""

import os
import json
import logging
import subprocess
import configparser

try:
    import folder_paths
    _BASE_DIR = os.path.dirname(folder_paths.__file__)
    _CUSTOM_NODES_DIR = os.path.join(_BASE_DIR, "custom_nodes")
except Exception:
    _CUSTOM_NODES_DIR = None


def _read_git_url(node_dir):
    """Lit l'URL du remote origin depuis .git/config."""
    git_config = os.path.join(node_dir, ".git", "config")
    if not os.path.isfile(git_config):
        return ""
    try:
        config = configparser.ConfigParser()
        config.read(git_config)
        if 'remote "origin"' in config:
            return config['remote "origin"'].get('url', '')
    except Exception:
        pass
    return ""


def _get_installed_custom_nodes():
    """Scanne custom_nodes/ et retourne [{name, git_url, has_git}]."""
    if not _CUSTOM_NODES_DIR or not os.path.isdir(_CUSTOM_NODES_DIR):
        return []

    results = []
    for name in os.listdir(_CUSTOM_NODES_DIR):
        node_dir = os.path.join(_CUSTOM_NODES_DIR, name)
        if not os.path.isdir(node_dir) or name.startswith('.'):
            continue
        git_url = _read_git_url(node_dir)
        has_git = os.path.isdir(os.path.join(node_dir, ".git"))
        if has_git or git_url:
            results.append({
                "name": name,
                "git_url": git_url,
                "has_git": has_git,
            })
    return results


def _install_custom_node(git_url, name=""):
    """Clone un repo git dans custom_nodes/. Retourne {success, message}."""
    if not _CUSTOM_NODES_DIR:
        return {"success": False, "message": "custom_nodes directory not found"}
    if not git_url:
        return {"success": False, "message": "git_url required"}

    # Déduire le nom depuis l'URL si non fourni
    if not name:
        name = git_url.rstrip('/').split('/')[-1]
        if name.endswith('.git'):
            name = name[:-4]

    target = os.path.join(_CUSTOM_NODES_DIR, name)
    if os.path.isdir(target):
        return {"success": False, "message": f"Node '{name}' already installed"}

    try:
        result = subprocess.run(
            ['git', 'clone', git_url, target],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            return {"success": True, "message": f"Installed {name}", "path": target}
        else:
            return {"success": False, "message": f"git clone failed: {result.stderr[:200]}"}
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "git clone timed out (120s)"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ── Routes aiohttp (enregistrées sur le serveur ComfyUI) ──

try:
    from aiohttp import web

    def register_routes():
        import server
        srv = server.PromptServer.instance

        @srv.routes.get("/fria/custom-nodes")
        async def list_custom_nodes(request):
            """Retourne la liste des custom nodes installés avec leurs URLs git."""
            try:
                nodes = _get_installed_custom_nodes()
                return web.json_response({"nodes": nodes})
            except Exception as e:
                return web.json_response({"error": str(e)}, status=500)

        @srv.routes.post("/fria/custom-nodes/install")
        async def install_node(request):
            """Clone un custom node manquant via git."""
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
                return web.json_response({"error": str(e)}, status=500)

    # Auto-enregistrement
    register_routes()
    logging.info("[FR.IA] Custom nodes manager routes registered")

except ImportError:
    logging.warning("[FR.IA] aiohttp not available, custom nodes routes not registered")
except Exception as e:
    logging.warning(f"[FR.IA] Failed to register custom nodes routes: {e}")