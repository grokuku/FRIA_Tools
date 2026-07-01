"""
FR.IA Model Manager — List, upload et download de models/loras.

Utilise folder_paths (ComfyUI) pour connaître les chemins des models.
Upload les fichiers directement depuis le filesystem Python (pas de file picker navigateur).

Endpoints ajoutés au serveur ComfyUI (aiohttp) :
  GET  /fria/models/list           → liste des models/loras locaux + tailles
  POST /fria/models/upload         → upload un model vers le serveur FR.IA (chunked)
  POST /fria/models/download       → download un model depuis FR.IA → sauvegarde locale

L'upload se fait en streaming : le Python lit le fichier par chunks et les envoie
au backend FR.IA via /api/files/init + /api/files/chunk + /api/files/complete.
Le fingerprint (hash partiel) est calculé côté Python pour la déduplication.
"""

import os
import json
import logging
import hashlib
import subprocess

try:
    import folder_paths
    _HAS_FOLDER_PATHS = True
except Exception:
    _HAS_FOLDER_PATHS = False

# Chunk size pour l'upload (doit correspondre au backend)
CHUNK_SIZE = 5 * 1024 * 1024  # 5 MB


# Toutes les categories de models connues par ComfyUI
_ALL_MODEL_CATEGORIES = [
    'checkpoints', 'loras', 'vae', 'clip', 'clip_vision', 'controlnet',
    'unet', 'unet_gguf', 'upscale_models', 'gligen', 'hypernetworks',
    'text_encoders', 'style_models', 'diffusion_models', 'configs',
    'embeddings', 'bbxe/models',
]

def _get_model_dirs():
    """Retourne {type: [paths]} pour toutes les categories de models ComfyUI.
    Fallback : scanne les dossiers courants si folder_paths est vide ou indisponible."""
    result = {}
    if _HAS_FOLDER_PATHS:
        for cat in _ALL_MODEL_CATEGORIES:
            try:
                paths = folder_paths.get_folder_paths(cat)
                if paths:
                    result[cat] = paths
            except Exception:
                pass

    # Fallback : si rien trouve via folder_paths, on scanne les dossiers courants
    if not result:
        # Chercher ComfyUI/models/ et ses sous-dossiers
        for base_dir in [
            "ComfyUI/models",
            os.path.expanduser("~/ComfyUI/models"),
            "../ComfyUI/models",
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "models"),
        ]:
            if os.path.isdir(base_dir):
                for name in os.listdir(base_dir):
                    sub = os.path.join(base_dir, name)
                    if os.path.isdir(sub):
                        result[name] = [sub]
                break
    return result


def _list_models_in_dirs(dirs, extensions=None):
    """Liste les fichiers dans une liste de dossiers (scan recursif 1 niveau)."""
    if extensions is None:
        extensions = ['.safetensors', '.ckpt', '.pt', '.pth', '.gguf', '.bin', '.t5', '.fp16', '.fp8', '.bf16']
    results = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            full = os.path.join(d, name)
            if os.path.isfile(full):
                ext = os.path.splitext(name)[1].lower()
                if ext in extensions:
                    results.append({
                        'name': name,
                        'path': full,
                        'size': os.path.getsize(full),
                    })
            elif os.path.isdir(full):
                # Scan 1 niveau de sous-dossier (ex: gguf/, lora/, etc.)
                for sub_name in os.listdir(full):
                    sub_full = os.path.join(full, sub_name)
                    if os.path.isfile(sub_full):
                        ext = os.path.splitext(sub_name)[1].lower()
                        if ext in extensions:
                            results.append({
                                'name': sub_name,
                                'path': sub_full,
                                'size': os.path.getsize(sub_full),
                            })
    return results


def list_local_models():
    """Liste tous les models locaux dans toutes les categories ComfyUI."""
    dirs = _get_model_dirs()
    result = {}
    for cat, cat_dirs in dirs.items():
        result[cat] = _list_models_in_dirs(cat_dirs)
    return result


def _compute_fingerprint(filepath):
    """Calcule le fingerprint (hash premier/dernier Mo + taille)."""
    try:
        size = os.path.getsize(filepath)
        head_size = min(1024 * 1024, size)
        with open(filepath, 'rb') as f:
            head = f.read(head_size)
            f.seek(max(0, size - head_size))
            tail = f.read(head_size)
        head_hash = hashlib.sha256(head).hexdigest()
        tail_hash = hashlib.sha256(tail).hexdigest()
        return {'size': size, 'head': head_hash, 'tail': tail_hash}
    except Exception as e:
        logging.warning(f"[FR.IA] Fingerprint failed: {e}")
        return None


def _get_fria_credentials():
    """Lit les credentials FR.IA pour connaître l'URL du serveur + API key."""
    try:
        from . import _credentials
        return _credentials.get_api_url(), _credentials.get_api_key()
    except Exception:
        try:
            import folder_paths
            user_dir = folder_paths.get_user_directory()
            cred_file = os.path.join(user_dir, "default", "fria_credentials.json")
            with open(cred_file, 'r') as f:
                data = json.load(f)
            base = (data.get("server_url") or "https://kw.holaf.fr").rstrip("/")
            return base + "/api", data.get("api_key", "")
        except Exception:
            return "https://kw.holaf.fr/api", ""


def upload_model_to_server(filepath, file_type="model", on_progress=None):
    """
    Upload un fichier model vers le serveur FR.IA via chunked upload.
    Retourne {success, upload_id, file_path} ou {success: False, error}.
    """
    import requests

    api_url, api_key = _get_fria_credentials()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    filename = os.path.basename(filepath)
    size = os.path.getsize(filepath)

    # 1. Fingerprint pour déduplication
    fp = _compute_fingerprint(filepath)
    if fp:
        try:
            resp = requests.post(f"{api_url}/files/check", json={
                'size': fp['size'], 'head': fp['head'], 'tail': fp['tail']
            }, headers=headers, timeout=10)
            if resp.ok:
                data = resp.json()
                if data.get('exists'):
                    logging.info(f"[FR.IA] Model {filename} already on server, skipping upload")
                    return {'success': True, 'upload_id': data['upload_id'],
                            'file_path': data['file_path'], 'deduplicated': True}
        except Exception as e:
            logging.warning(f"[FR.IA] Fingerprint check failed: {e}")

    # 2. Init upload
    try:
        resp = requests.post(f"{api_url}/files/init", json={
            'filename': filename, 'size': size, 'type': file_type
        }, headers=headers, timeout=10)
        if not resp.ok:
            err = resp.json().get('error', resp.text)
            return {'success': False, 'error': f'Init failed: {err}'}
        init_data = resp.json()
    except Exception as e:
        return {'success': False, 'error': f'Init failed: {e}'}

    upload_id = init_data['upload_id']
    chunk_size = init_data['chunk_size']
    total_chunks = init_data['total_chunks']

    # 3. Upload chunks
    try:
        with open(filepath, 'rb') as f:
            for i in range(total_chunks):
                chunk = f.read(chunk_size)
                resp = requests.post(f"{api_url}/files/chunk", data={
                    'upload_id': upload_id,
                    'chunk_index': str(i),
                }, files={'data': (filename, chunk)}, timeout=300)
                if not resp.ok:
                    return {'success': False, 'error': f'Chunk {i} failed: {resp.text}'}
                if on_progress:
                    on_progress(i + 1, total_chunks)
    except Exception as e:
        return {'success': False, 'error': f'Chunk upload failed: {e}'}

    # 4. Complete
    try:
        complete_data = {'upload_id': upload_id}
        if fp:
            complete_data['fingerprint_head'] = fp['head']
            complete_data['fingerprint_tail'] = fp['tail']
        resp = requests.post(f"{api_url}/files/complete", json=complete_data,
                             headers=headers, timeout=60)
        if not resp.ok:
            err = resp.json().get('error', resp.text)
            return {'success': False, 'error': f'Complete failed: {err}'}
        result = resp.json()
        return {'success': True, 'upload_id': upload_id,
                'file_path': result.get('file_path', '')}
    except Exception as e:
        return {'success': False, 'error': f'Complete failed: {e}'}


def download_model_from_server(upload_id, filename, file_type="model"):
    """
    Download un model depuis le serveur FR.IA et le sauvegarde dans le dossier local.
    Retourne {success, path} ou {success: False, error}.
    """
    import requests

    api_url, api_key = _get_fria_credentials()
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Déterminer le dossier de destination selon le type
    dirs = _get_model_dirs()

    # Mapper les categories de detection vers les dossiers ComfyUI
    type_to_cat = {
        'checkpoint': 'checkpoints',
        'lora': 'loras',
        'vae': 'vae',
        'clip': 'clip',
        'clip_vision': 'clip_vision',
        'controlnet': 'controlnet',
        'unet': 'unet',
        'unet_gguf': 'unet_gguf',
        'upscale': 'upscale_models',
        'gligen': 'gligen',
        'hypernetwork': 'hypernetworks',
        'text_encoder': 'text_encoders',
        'style_model': 'style_models',
        'model': 'checkpoints',  # fallback
    }

    cat = type_to_cat.get(file_type, 'checkpoints')
    dest_dirs = dirs.get(cat, dirs.get('checkpoints', []))

    if not dest_dirs:
        return {'success': False, 'error': f'No model directory for type {file_type}'}

    dest_dir = dest_dirs[0]
    dest_path = os.path.join(dest_dir, filename)

    try:
        resp = requests.get(f"{api_url}/files/{upload_id}/download",
                           headers=headers, stream=True, timeout=600)
        if not resp.ok:
            return {'success': False, 'error': f'HTTP {resp.status_code}'}

        with open(dest_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                f.write(chunk)

        logging.info(f"[FR.IA] Downloaded {filename} → {dest_path}")
        return {'success': True, 'path': dest_path}
    except Exception as e:
        return {'success': False, 'error': str(e)}


# ── Routes aiohttp ──

try:
    from aiohttp import web
    import threading

    def _register_model_routes():
        """Enregistre les routes sur le serveur ComfyUI.
        Utilise un timer pour attendre que PromptServer.instance soit disponible."""
        try:
            import server
            srv = server.PromptServer.instance
            if srv is None:
                # Serveur pas encore pret → reessayer dans 1 seconde
                threading.Timer(1.0, _register_model_routes).start()
                return
        except Exception:
            threading.Timer(1.0, _register_model_routes).start()
            return

        @srv.routes.get("/fria/models/list")
        async def list_models(request):
            """Liste les models et loras locaux (avec chemins + tailles)."""
            try:
                models = list_local_models()
                return web.json_response(models)
            except Exception as e:
                return web.json_response({"error": str(e)}, status=500)

        @srv.routes.post("/fria/models/upload")
        async def upload_model(request):
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
                return web.json_response({"error": str(e)}, status=500)

        @srv.routes.post("/fria/models/download")
        async def download_model(request):
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
                return web.json_response({"error": str(e)}, status=500)

        logging.info("[FR.IA] Model manager routes registered")

    # Demarrer l'enregistrement (lazy : reessaye si instance pas dispo)
    threading.Timer(0.1, _register_model_routes).start()

except ImportError:
    logging.warning("[FR.IA] aiohttp not available, model manager routes not registered")
except Exception as e:
    logging.warning(f"[FR.IA] Failed to init model manager routes: {e}")