"""
Blobby Companion — Settings API for ComfyUI.

Ajoute deux endpoints au serveur ComfyUI pour stocker/lire
les parametres de Blobby dans le dossier utilisateur.

Routes :
  POST /fria/blobby/save   → sauvegarde {key, data}
  GET  /fria/blobby/load    → charge les donnees pour une key

Stockage : ComfyUI/user/default/fria_blobby.json
"""

import os
import json
import logging

try:
    import folder_paths
    USER_DIR = folder_paths.get_user_directory()
except Exception:
    USER_DIR = os.path.expanduser("~")

BLOBBY_FILE = os.path.join(USER_DIR, "default", "fria_blobby.json")

def _ensure_dir():
    d = os.path.dirname(BLOBBY_FILE)
    if not os.path.isdir(d):
        try:
            os.makedirs(d, exist_ok=True)
        except Exception as e:
            logging.warning(f"[Blobby] Cannot create dir {d}: {e}")

def _load_all():
    if not os.path.isfile(BLOBBY_FILE):
        return {}
    try:
        with open(BLOBBY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logging.warning(f"[Blobby] Failed to read {BLOBBY_FILE}: {e}")
        return {}

def _save_all(data):
    _ensure_dir()
    try:
        with open(BLOBBY_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logging.warning(f"[Blobby] Failed to write {BLOBBY_FILE}: {e}")


# ── Routes ────────────────────────────────────────────────────────

try:
    import server
    from aiohttp import web

    @server.PromptServer.instance.routes.post("/fria/blobby/save")
    async def blobby_save(request):
        try:
            body = await request.json()
            key = body.get("key")
            data = body.get("data")
            if not key:
                return web.json_response({"error": "key required"}, status=400)

            all_data = _load_all()
            all_data[key] = data
            _save_all(all_data)
            return web.json_response({"status": "ok"})
        except Exception as e:
            logging.error(f"[Blobby] save error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    @server.PromptServer.instance.routes.get("/fria/blobby/load")
    async def blobby_load(request):
        try:
            key = request.query.get("key")
            if not key:
                return web.json_response({"error": "key required"}, status=400)

            all_data = _load_all()
            result = all_data.get(key, None)
            return web.json_response({"data": result})
        except Exception as e:
            logging.error(f"[Blobby] load error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    logging.info("[Blobby] Settings API routes registered (/fria/blobby/save, /fria/blobby/load)")

except ImportError:
    logging.warning("[Blobby] Cannot import server module — settings API not available")
except Exception as e:
    logging.warning(f"[Blobby] Failed to register routes: {e}")
