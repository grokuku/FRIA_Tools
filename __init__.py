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
    """Charge un fichier Python comme module par son chemin absolu.

    Important : on declare les packages parents `FRIA_ComfyUI` et
    `FRIA_ComfyUI.nodes` dans sys.modules AVANT d'executer le module,
    et on utilise un nom complet (`FRIA_ComfyUI.nodes.<name>`) avec
    `__package__` set. Cela permet aux `from . import X` dans les
    modules charges de fonctionner. Sinon : ImportError "attempted
    relative import with no known parent package".
    """
    # Declarer FRIA_ComfyUI (grand-parent) dans sys.modules
    grandparent_name = "FRIA_ComfyUI"
    if grandparent_name not in sys.modules:
        grandparent_dir = os.path.dirname(_nodes_dir)
        gp_spec = importlib.util.spec_from_file_location(
            grandparent_name,
            os.path.join(grandparent_dir, "__init__.py"),
            submodule_search_locations=[grandparent_dir],
        )
        if gp_spec is not None:
            gp_mod = importlib.util.module_from_spec(gp_spec)
            sys.modules[grandparent_name] = gp_mod

    # Declarer FRIA_ComfyUI.nodes (parent) dans sys.modules
    parent_name = f"{grandparent_name}.nodes"
    if parent_name not in sys.modules:
        p_spec = importlib.util.spec_from_file_location(
            parent_name,
            os.path.join(_nodes_dir, "__init__.py"),
            submodule_search_locations=[_nodes_dir],
        )
        if p_spec is not None:
            p_mod = importlib.util.module_from_spec(p_spec)
            sys.modules[parent_name] = p_mod

    # Charger le module avec son nom complet pour que les relative imports
    # (`from . import _credentials`) fonctionnent.
    full_name = f"{parent_name}.{name}"
    spec = importlib.util.spec_from_file_location(full_name, filepath)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = parent_name  # requis pour les relative imports
    sys.modules[full_name] = mod
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

# Charger le module Terminal (utilise par la route WebSocket ci-dessous)
# NB : ce module ne declare AUCUNE node ComfyUI — le terminal est un
# panel flottant JS, pas une node (voir web/js/fria_terminal_widget.js).
_terminal_mod = _load_module(
    os.path.join(_base, "FRIA_ComfyUI", "terminal.py"),
    "FRIATerminal"
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

    # ── Routes credentials (lecture / ecriture du fichier local) ───
    # Le menu FR.IA → Compte appelle ces routes pour lire/ecrire
    # ComfyUI/user/default/fria_credentials.json (api_key + server_url).
    # Les nodes Python lisent ce fichier via le helper _credentials.

    @_routes.get("/fr_ia/credentials")
    async def _fr_ia_get_credentials_route(request):
        import os as _os  # import local pour eviter les problemes de scope
        try:
            # Charger _credentials par chemin absolu (comme les nodes)
            # pour eviter les problemes de relative import dans le contexte
            # des routes ComfyUI.
            _load_module(
                _os.path.join(_nodes_dir, "_credentials.py"),
                "_credentials",
            )
            import FRIA_ComfyUI.nodes._credentials as _creds_mod
            creds = _creds_mod._load_fria_credentials(use_cache=False)
            return _aio_web.json_response({
                "status": "ok",
                "api_key": creds.get("api_key", ""),
                "server_url": creds.get("server_url", "https://kw.holaf.fr"),
                "path": _creds_mod.get_credentials_path(),
                "exists": _os.path.isfile(_creds_mod.get_credentials_path()),
            })
        except Exception as e:
            return _aio_web.json_response({
                "status": "error",
                "message": f"Exception: {e}",
            }, status=500)

    @_routes.post("/fr_ia/credentials")
    async def _fr_ia_save_credentials_route(request):
        import os as _os  # import local pour eviter les problemes de scope
        import json as _json
        from datetime import datetime as _dt
        try:
            # Charger _credentials par chemin absolu (cf. GET route)
            _load_module(
                _os.path.join(_nodes_dir, "_credentials.py"),
                "_credentials",
            )
            import FRIA_ComfyUI.nodes._credentials as _creds_mod
            data = await request.json()
            api_key = (data.get("api_key") or "").strip()
            server_url = (data.get("server_url") or "https://kw.holaf.fr").strip()

            creds_path = _creds_mod.get_credentials_path()
            _os.makedirs(_os.path.dirname(creds_path), exist_ok=True)

            # Permissions restrictives (Linux)
            if _os.name != 'nt':
                old_umask = _os.umask(0o077)
            try:
                with open(creds_path, "w", encoding="utf-8") as f:
                    _json.dump({
                        "api_key": api_key,
                        "server_url": server_url,
                        "updated_at": _dt.utcnow().isoformat() + "Z",
                    }, f, indent=2)
            finally:
                if _os.name != 'nt':
                    _os.umask(old_umask)

            # Invalider le cache pour que les nodes lisent la nouvelle valeur
            _creds_mod.invalidate_cache()

            return _aio_web.json_response({
                "status": "ok",
                "path": creds_path,
                "api_key_len": len(api_key),
            })
        except Exception as e:
            import traceback
            return _aio_web.json_response({
                "status": "error",
                "message": f"Exception: {e}",
                "log": traceback.format_exc(),
            }, status=500)

    print("[FR.IA] Update routes registered: POST /fr_ia/update, /fr_ia/restart")
    print("[FR.IA] Credentials routes registered: GET/POST /fr_ia/credentials")

    # ── Route Blobby Exec (commandes git locales) ─────────────
    @_routes.post("/fr_ia/blobby/exec")
    async def _fr_ia_blobby_exec_route(request):
        """Execute une commande git locale sur la machine ComfyUI."""
        import os as _os
        import subprocess as _sp
        try:
            data = await request.json()
            action = (data.get("action") or "").strip()
            target = (data.get("target") or "").strip()

            # Dossier de base (custom_nodes/ ou FRIA_Tools/)
            _base_dir = _os.path.dirname(_os.path.abspath(__file__))
            _custom_nodes_dir = _os.path.dirname(_base_dir) if _base_dir else ""

            def _run_git(cwd, *args):
                r = _sp.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True, timeout=30)
                out = r.stdout.strip()
                if r.stderr: out += "\n" + r.stderr.strip()
                if r.returncode != 0: out += f"\n❌ Code: {r.returncode}"
                return out

            def _find_git_repo(name):
                """Cherche un dossier avec .git dans custom_nodes/."""
                if not name: return None
                for d in (_custom_nodes_dir, _base_dir):
                    p = _os.path.join(d, name) if d != _base_dir else d
                    if _os.path.isdir(_os.path.join(p, ".git")):
                        return p
                    # Chercher aussi dans custom_nodes/<name>/
                    if _custom_nodes_dir:
                        p2 = _os.path.join(_custom_nodes_dir, name)
                        if _os.path.isdir(_os.path.join(p2, ".git")):
                            return p2
                return None

            if action == "git_status":
                path = _find_git_repo(target)
                if not path: return _aio_web.json_response({"ok": False, "output": f"⚠️ Dossier '{target}' introuvable"})
                branch = _run_git(path, "rev-parse", "--abbrev-ref", "HEAD")
                status = _run_git(path, "status", "--short")
                behind = "?"
                try:
                    b = _run_git(path, "rev-list", "--count", f"{branch}..origin/{branch}", "--")
                    behind = int(b) if b.isdigit() else "?"
                except: pass
                ahead = "?"
                try:
                    a = _run_git(path, "rev-list", "--count", f"origin/{branch}..{branch}", "--")
                    ahead = int(a) if a.isdigit() else "?"
                except: pass
                lines = [f"📁 **{target or _os.path.basename(path)}** (branche: {branch})"]
                if behind not in (0, "?", 0): lines.append(f"  🔽 {behind} commit(s) derrière")
                if ahead not in (0, "?", 0): lines.append(f"  🔼 {ahead} commit(s) devant")
                if status: lines.append(f"  📝 Modifications locales:\n{status}")
                if behind in (0, "?") and ahead in (0, "?") and not status: lines.append("  ✅ À jour, propre")
                return _aio_web.json_response({"ok": True, "output": "\n".join(lines)})

            elif action == "git_pull":
                path = _find_git_repo(target)
                if not path: return _aio_web.json_response({"ok": False, "output": f"⚠️ Dossier '{target}' introuvable"})
                out = _run_git(path, "pull")
                return _aio_web.json_response({"ok": True, "output": f"📥 **{target}**:\n{out}"})

            elif action == "list_nodes":
                if not _custom_nodes_dir or not _os.path.isdir(_custom_nodes_dir):
                    return _aio_web.json_response({"ok": True, "output": "Aucun custom_nodes trouvé"})
                results = []
                for item in sorted(_os.listdir(_custom_nodes_dir)):
                    d = _os.path.join(_custom_nodes_dir, item)
                    if _os.path.isdir(_os.path.join(d, ".git")):
                        try:
                            b = _run_git(d, "rev-parse", "--abbrev-ref", "HEAD")
                        except: b = "?"
                        try:
                            behind = _run_git(d, "rev-list", "--count", f"{b}..origin/{b}", "--").strip()
                        except: behind = "?"
                        icon = "🔴" if behind not in ("0", "?", "") else "🟢"
                        results.append(f"  {icon} {item} ({b})")
                txt = "📂 **Dépôts git:**\n" + "\n".join(results) if results else "Aucun node git trouvé"
                return _aio_web.json_response({"ok": True, "output": txt})

            elif action == "fria_version":
                path = _find_git_repo("")
                if not path: return _aio_web.json_response({"ok": False, "output": "⚠️ FRIA_Tools pas un dépôt git"})
                branch = _run_git(path, "rev-parse", "--abbrev-ref", "HEAD")
                log = _run_git(path, "log", "--oneline", "-5")
                behind = "?"
                try:
                    b = _run_git(path, "rev-list", "--count", f"{branch}..origin/{branch}", "--").strip()
                    behind = int(b) if b.isdigit() else "?"
                except: pass
                status = _run_git(path, "status", "--short")
                lines = [f"🟢 **FR.IA** ({branch})"]
                if behind not in (0, "?", 0): lines.append(f"  🔽 {behind} mise(s) à jour dispo")
                if status: lines.append("  📝 Modifications locales")
                lines.append(f"\nDerniers commits:\n{log}")
                return _aio_web.json_response({"ok": True, "output": "\n".join(lines)})

            elif action == "update_fria":
                path = _find_git_repo("")
                if not path: return _aio_web.json_response({"ok": False, "output": "⚠️ FRIA_Tools pas un dépôt git"})
                out = _run_git(path, "pull")
                return _aio_web.json_response({"ok": True, "output": f"📥 Mise à jour FR.IA:\n{out}"})

            elif action == "shell":
                """Execute n'importe quelle commande shell (Windows + Linux)."""
                cmd = (data.get("command") or "").strip()
                if not cmd:
                    return _aio_web.json_response({"ok": False, "output": "⚠️ Commande vide"}, status=400)
                # Limiter la durée des commandes shell
                try:
                    r = _sp.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
                    out = r.stdout.strip()
                    if r.stderr: out += "\n" + r.stderr.strip()
                    if r.returncode != 0:
                        out += f"\n❌ Code: {r.returncode}"
                    if not out:
                        out = "✅ Commande exécutée (pas de sortie)"
                    return _aio_web.json_response({"ok": True, "output": out})
                except _sp.TimeoutExpired:
                    return _aio_web.json_response({"ok": False, "output": "⏱️ Commande trop longue (>15s)"})
                except Exception as e:
                    return _aio_web.json_response({"ok": False, "output": f"❌ Erreur: {e}"})

            else:
                return _aio_web.json_response({"ok": False, "output": f"Action '{action}' inconnue"}, status=400)

        except Exception as e:
            import traceback
            return _aio_web.json_response({"ok": False, "output": f"❌ Erreur: {e}", "log": traceback.format_exc()}, status=500)

    print("[FR.IA] Blobby exec route registered: POST /fr_ia/blobby/exec")

    # ── Route WebSocket Terminal (PAS DE MOT DE PASSE) ──────────────
    # Le widget FR.IA Terminal (fria_terminal_widget.js) ouvre un
    # WebSocket sur /fr_ia/terminal pour piloter un PTY distant.
    # Cette route est sans authentification : elle donne un shell à
    # quiconque peut atteindre le serveur ComfyUI. À n'utiliser que
    # sur localhost ou derrière un reverse proxy authentifié.
    # NB : on utilise @_routes.get() (et non add_get) car aiohttp
    # detecte le WebSocket via l'upgrade request — cf. comment
    # CUI-Holaf-Utils declare sa route /holaf/terminal.
    if _terminal_mod and hasattr(_terminal_mod, "websocket_handler"):

        @_routes.get("/fr_ia/terminal")  # WebSocket
        async def _fr_ia_terminal_ws_route(request):
            return await _terminal_mod.websocket_handler(request)

        print("[FR.IA] Terminal WebSocket route registered: GET /fr_ia/terminal (NO PASSWORD)")
else:
    # Si les routes ne sont pas enregistrees, on ne fait rien de plus
    # (l'item "Update" du menu ne fonctionnera pas, mais l'extension
    # reste chargee pour les nodes)
    pass

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
