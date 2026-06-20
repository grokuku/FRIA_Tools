"""Routes Blobby — exécution de commandes locales (git, updates)."""

from context import *
import subprocess
import os


# Chemins possibles pour les custom_nodes et l'extension FR.IA
CUSTOM_NODES_DIRS = [
    "/workspace/custom_nodes",       # dev local
    "/path/to/ComfyUI/custom_nodes",  # prod
]

# Détection auto du dossier FRIA_Tools
def _get_fria_root():
    """Retourne le chemin racine du projet FRIA_Tools."""
    # Le backend tourne depuis FRIA_Tools/backend/
    guess = BASE_DIR.parent  # FRIA_Tools/
    if (guess / "FRIA_ComfyUI").is_dir():
        return guess
    return None


def _resolve_path(target):
    """Résout un chemin relatif (nom de dossier) en chemin absolu sécurisé."""
    if not target:
        return None
    # Chercher dans custom_nodes
    if CUSTOM_NODES_DIRS:
        for base in CUSTOM_NODES_DIRS:
            p = os.path.join(base, target)
            if os.path.isdir(p) and os.path.isdir(os.path.join(p, ".git")):
                return p
    # Chercher dans FRIA_Tools parent
    fria = _get_fria_root()
    if fria and os.path.isdir(os.path.join(str(fria), target)) and os.path.isdir(os.path.join(str(fria), target, ".git")):
        return os.path.join(str(fria), target)
    return None


@app.route('/api/blobby/exec', methods=['POST'])
def blobby_exec():
    """
    Execute une commande sécurisée pour Blobby.
    Corps : { action: "git_status" | "git_pull" | "list_nodes" | "fria_version", target: "nom_dossier" }
    """
    guard = _login_required()
    if guard:
        return guard

    data = request.get_json() or {}
    action = data.get('action', '').strip()
    target = data.get('target', '').strip()

    safe_actions = {
        'git_status': _blobby_git_status,
        'git_pull': _blobby_git_pull,
        'list_nodes': _blobby_list_nodes,
        'fria_version': _blobby_fria_version,
        'update_fria': _blobby_update_fria,
    }

    handler = safe_actions.get(action)
    if not handler:
        return jsonify({'error': f"Action '{action}' non reconnue"}), 400

    try:
        result = handler(target)
        return jsonify({'ok': True, 'output': result})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'output': f"❌ Erreur: {e}"}), 500


def _run_git_command(path, *args):
    """Helper: exécute une commande git dans un dossier et retourne la sortie."""
    if not path or not os.path.isdir(path):
        raise ValueError(f"Dossier introuvable: {path}")
    try:
        r = subprocess.run(
            ['git', *args],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        output = r.stdout.strip()
        if r.stderr:
            output += '\n' + r.stderr.strip()
        return output
    except subprocess.TimeoutExpired:
        raise TimeoutError("Commande git trop longue (>30s)")
    except FileNotFoundError:
        raise RuntimeError("Git n'est pas installé sur le serveur")


def _blobby_git_status(target):
    """Vérifie le statut git d'un dossier (branche, commits ahead/behind, modifs locales)."""
    path = _resolve_path(target)
    if not path:
        return f"⚠️ Dossier '{target}' introuvable ou pas un dépôt git"

    branch = _run_git_command(path, 'rev-parse', '--abbrev-ref', 'HEAD')
    status = _run_git_command(path, 'status', '--short')
    # Fetch pour voir les mises à jour distantes
    try:
        _run_git_command(path, 'fetch', '--dry-run')
    except Exception:
        pass
    ahead_behind = _run_git_command(path, 'rev-list', '--count', '--left-right', f'{branch}...origin/{branch}', '--').strip()
    # Détection de l'état
    behind_count = 0
    ahead_count = 0
    if ahead_behind and '\t' in ahead_behind:
        parts = ahead_behind.split('\t')[0]
        counts = parts.split()
        if len(counts) >= 2:
            behind_count = int(counts[0])  # left = behind
            ahead_count = int(counts[1])   # right = ahead
        elif len(counts) == 1:
            if parts.startswith('\t'):
                behind_count = int(counts[0])

    lines = [f"📁 **{target}** (branche: {branch})"]
    if behind_count > 0:
        lines.append(f"  🔽 {behind_count} commit(s) derrière origin/{branch}")
    if ahead_count > 0:
        lines.append(f"  🔼 {ahead_count} commit(s) devant")
    if status:
        lines.append(f"  📝 Modifications locales:\n{status}")
    if behind_count == 0 and ahead_count == 0 and not status:
        lines.append("  ✅ À jour, propre")

    return '\n'.join(lines)


def _blobby_git_pull(target):
    """Git pull sur un dossier."""
    path = _resolve_path(target)
    if not path:
        return f"⚠️ Dossier '{target}' introuvable ou pas un dépôt git"
    output = _run_git_command(path, 'pull')
    return f"📥 **{target}** :\n{output}"


def _blobby_list_nodes(target=None):
    """Liste les dossiers custom_nodes qui sont des dépôts git."""
    results = []
    for base in CUSTOM_NODES_DIRS:
        if not os.path.isdir(base):
            continue
        for item in sorted(os.listdir(base)):
            d = os.path.join(base, item)
            if os.path.isdir(os.path.join(d, '.git')):
                try:
                    branch = _run_git_command(d, 'rev-parse', '--abbrev-ref', 'HEAD')
                except Exception:
                    branch = '?'
                try:
                    behind = _run_git_command(d, 'rev-list', '--count', f'{branch}..origin/{branch}', '--').strip()
                except Exception:
                    behind = '?'
                results.append(f"  {'🔴' if behind and behind not in ('0', '?') else '🟢'} {item} ({branch})")
    if not results:
        return "Aucun custom node git trouvé"
    return "📂 **Dépôts git dans custom_nodes:**\n" + '\n'.join(results)


def _blobby_fria_version(target=None):
    """Vérifie la version de l'extension FR.IA."""
    fria = _get_fria_root()
    if not fria:
        return "⚠️ Impossible de trouver le dossier FRIA_Tools"
    try:
        log = _run_git_command(str(fria), 'log', '--oneline', '-5')
        branch = _run_git_command(str(fria), 'rev-parse', '--abbrev-ref', 'HEAD')
        behind = _run_git_command(str(fria), 'rev-list', '--count', f'{branch}..origin/{branch}', '--').strip()
        status = _run_git_command(str(fria), 'status', '--short')
        lines = [f"🟢 **FR.IA** ({branch})"]
        if behind and behind != '0':
            lines.append(f"  🔽 {behind} mise(s) à jour disponible(s)")
        if status:
            lines.append(f"  📝 Modifications locales")
        lines.append(f"\nDerniers commits:\n{log}")
        return '\n'.join(lines)
    except Exception as e:
        return f"⚠️ Erreur: {e}"


def _blobby_update_fria(target=None):
    """Met à jour l'extension FR.IA (git pull)."""
    fria = _get_fria_root()
    if not fria:
        return "⚠️ Impossible de trouver le dossier FRIA_Tools"
    try:
        pull_out = _run_git_command(str(fria), 'pull')
        return f"📥 Mise à jour FR.IA terminée :\n{pull_out}"
    except Exception as e:
        return f"❌ Erreur de mise à jour: {e}"
