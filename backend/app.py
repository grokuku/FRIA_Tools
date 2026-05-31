import os
import sqlite3
import io
import json
import random
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify, send_file, send_from_directory, session, redirect, render_template_string
from flask_cors import CORS

from parser import parse_markdown
from exporter import export_to_markdown
from embeddings import generate_embedding, cosine_similarity, is_available, set_config
from auth import init_oauth, make_discord_session, check_guild_access, get_guild_member, get_user_info, avatar_url, get_logged_user

BASE_DIR = Path(__file__).resolve().parent.parent
from cryptography.fernet import Fernet

DB_PATH = BASE_DIR / 'keywords.db'
MD_PATH = BASE_DIR / 'Keywords-Complete.md'

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24).hex())
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

oauth = init_oauth(app)

# Chargement de la config Ollama stockée en BDD (si présent)
def _load_ollama_config_at_startup():
    try:
        from embeddings import set_config
        conn = sqlite3.connect(str(DB_PATH))
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM app_settings WHERE key IN ('ollama_url', 'ollama_model')")
        rows = cur.fetchall()
        conn.close()
        cfg = {r[0]: r[1] for r in rows}
        if cfg:
            set_config(url=cfg.get('ollama_url'), model=cfg.get('ollama_model'))
    except Exception:
        pass

_load_ollama_config_at_startup()

# ── helpers ──────────────────────────────────────────────────────────

# ── encryption ───────────────────────────────────────────────────────

def _row_get(row, key, default=None):
    """Safe .get() for sqlite3.Row objects (they don't support .get())."""
    try:
        val = row[key]
        return val if val is not None else default
    except (KeyError, IndexError):
        return default


def _get_encryption_key():
    """Recupere ou genere la cle de chiffrement."""
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.execute("SELECT value FROM app_settings WHERE key = 'encryption_key'")
    row = cur.fetchone()
    conn.close()
    key = row[0] if row else None
    if not key:
        key = Fernet.generate_key().decode()
        conn = sqlite3.connect(str(DB_PATH))
        conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ('encryption_key', key))
        conn.commit()
        conn.close()
    return Fernet(key.encode())

def encrypt_api_key(plain):
    if not plain: return ''
    return _get_encryption_key().encrypt(plain.encode()).decode()

def decrypt_api_key(encrypted):
    if not encrypted: return ''
    return _get_encryption_key().decrypt(encrypted.encode()).decode()

# ──────────────────────────────────────────────────────────────────────

def get_db():
    _init_db()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _init_db():
    """Crée la base et les tables si elles n'existent pas."""
    new = not DB_PATH.exists()
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT NOT NULL,
            description TEXT NOT NULL,
            section_id TEXT,
            section_title TEXT,
            subsection_id TEXT,
            subsection_title TEXT,
            nsfw INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS keyword_embeddings (
            keyword_id INTEGER PRIMARY KEY,
            embedding TEXT NOT NULL,
            FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT,
            avatar TEXT,
            role TEXT DEFAULT 'user',
            settings TEXT DEFAULT '{}',
            guild_nickname TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS saved_filters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT DEFAULT '',
            nsfw INTEGER DEFAULT 0,
            is_public INTEGER DEFAULT 0,
            config TEXT NOT NULL DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS filter_cache (
            filter_id INTEGER NOT NULL,
            keyword_id INTEGER NOT NULL,
            PRIMARY KEY (filter_id, keyword_id),
            FOREIGN KEY (filter_id) REFERENCES saved_filters(id) ON DELETE CASCADE,
            FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
        )
    """)

    # === Nouvelles tables (Phase 1 — Prompt Generator/Enhancer) ===
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ai_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            name TEXT NOT NULL,
            engine TEXT DEFAULT 'openai',
            base_url TEXT NOT NULL DEFAULT '',
            api_key_encrypted TEXT DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            is_global INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS styles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            style_text TEXT NOT NULL DEFAULT '',
            negative_prompt TEXT DEFAULT '',
            is_public INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prompt_examples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL DEFAULT 'sdxl',
            prompt_text TEXT NOT NULL,
            author_id TEXT NOT NULL,
            rating INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (author_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prompt_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_example_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            vote INTEGER NOT NULL CHECK(vote IN (-1, 1)),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (prompt_example_id) REFERENCES prompt_examples(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS generated_prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            preset_id INTEGER,
            prompt_type TEXT DEFAULT 'sdxl',
            input_text TEXT NOT NULL DEFAULT '',
            output_text TEXT NOT NULL DEFAULT '',
            negative_prompt TEXT DEFAULT '',
            style_id INTEGER,
            model_used TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (preset_id) REFERENCES ai_presets(id),
            FOREIGN KEY (style_id) REFERENCES styles(id)
        )
    """)

    # Migrations : ajout de colonnes si absentes
    cols_kw = [r[1] for r in conn.execute("PRAGMA table_info(keywords)").fetchall()]
    if "user_id" not in cols_kw:
        conn.execute("ALTER TABLE keywords ADD COLUMN user_id TEXT REFERENCES users(id)")

    cols_users = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    for col, default in [("role", "'user'"), ("settings", "'{}'"), ("guild_nickname", "NULL"), ("api_token", "NULL")]:
        if col not in cols_users:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT DEFAULT {default}")

    cols_presets = [r[1] for r in conn.execute("PRAGMA table_info(ai_presets)").fetchall()]
    if "is_client_side" not in cols_presets:
        conn.execute("ALTER TABLE ai_presets ADD COLUMN is_client_side INTEGER DEFAULT 0")

    cols_styles = [r[1] for r in conn.execute("PRAGMA table_info(styles)").fetchall()]
    if "negative_prompt" not in cols_styles:
        conn.execute("ALTER TABLE styles ADD COLUMN negative_prompt TEXT DEFAULT ''")

    conn.commit()
    conn.close()


def _get_current_user_id() -> str | None:
    """Retourne l'ID Discord de l'utilisateur connecté, ou None."""
    user = session.get("user")
    return user["id"] if user else None


def _authenticate_via_token() -> str | None:
    """Vérifie si la requête contient un Bearer token valide.
    Retourne l'user_id ou None."""
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth[7:]
    try:
        conn = get_db()
        row = conn.execute("SELECT id FROM users WHERE api_token = ?", (token,)).fetchone()
        conn.close()
        return row['id'] if row else None
    except Exception:
        return None


def _login_required():
    """Retourne une erreur 401 si non connecté (session OU token API)."""
    user_id = _get_current_user_id()
    if not user_id:
        user_id = _authenticate_via_token()
    if not user_id:
        return jsonify({"error": "Connexion requise. Utilisez le bouton 'Connexion Discord' ou un token API."}), 401
    _sync_session_user(user_id)
    return None


def _sync_session_user(user_id: str):
    """Crée ou met à jour l'utilisateur en BDD à partir de la session."""
    user = session.get("user")
    if not user:
        return
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE id = ?", (user_id,))
        if not cur.fetchone():
            cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
            admin_count = cur.fetchone()[0]
            role = "admin" if admin_count == 0 else "user"
            cur.execute(
                "INSERT INTO users (id, username, display_name, avatar, role) VALUES (?, ?, ?, ?, ?)",
                (user_id, user.get("username", ""), user.get("display_name", ""), user.get("avatar", ""), role)
            )
            conn.commit()
        conn.close()
    except Exception:
        pass


def _admin_required():
    """Retourne une erreur 403 si l'utilisateur n'est pas admin."""
    try:
        guard = _login_required()
        if guard:
            return guard
        if not is_admin(_get_current_user_id()):
            return jsonify({"error": "Accès réservé aux administrateurs."}), 403
        return None
    except Exception as e:
        return jsonify({"error": f"Erreur vérification admin: {e}"}), 500


def is_admin(user_id: str) -> bool:
    """
    Retourne True si l'utilisateur est admin.
    Si aucun admin déclaré → tout le monde est admin.
    """
    try:
        conn = get_db()
        cur = conn.cursor()
        # Vérifier que la colonne role existe
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "role" not in cols:
            conn.close()
            return True
        cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        admin_count = cur.fetchone()[0]
        if admin_count == 0:
            conn.close()
            return True
        cur.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        row = cur.fetchone()
        conn.close()
        return row is not None and row["role"] == "admin"
    except Exception as e:
        print(f"[is_admin] Erreur: {e}")
        return True  # Fail safe : accès admin par défaut


def _get_ollama_config() -> dict:
    """Lit la config Ollama depuis la BDD (app_settings) ou les vars d'env."""
    config = {
        "url": os.environ.get("OLLAMA_URL", "http://localhost:11434"),
        "model": os.environ.get("OLLAMA_MODEL", "nomic-embed-text"),
    }
    try:
        conn = get_db()
        cur = conn.cursor()
        for key in ("ollama_url", "ollama_model"):
            cur.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
            row = cur.fetchone()
            if row:
                config_key = key.replace("ollama_", "")
                config[config_key] = row["value"]
        conn.close()
    except Exception as e:
        print(f"[_get_ollama_config] Erreur: {e}")
    return config


def _generate_all_embeddings(conn):
    """Génère et stocke les embeddings Ollama pour tous les mots-clés."""
    cur = conn.cursor()
    cur.execute("SELECT id, keyword, description FROM keywords")
    rows = cur.fetchall()
    if not rows:
        return

    cur.execute("DELETE FROM keyword_embeddings")
    data = []
    for row in rows:
        text = f"{row['keyword']}: {row['description']}"
        vec = generate_embedding(text)
        data.append((row['id'], json.dumps(vec)))

    cur.executemany(
        "INSERT INTO keyword_embeddings (keyword_id, embedding) VALUES (?, ?)",
        data
    )
    conn.commit()


# ── Routes d'authentification ────────────────────────────────────────

@app.route('/api/auth/discord/login')
def discord_login():
    """Redirige l'utilisateur vers Discord OAuth2."""
    redirect_uri = os.environ.get(
        "DISCORD_REDIRECT_URI",
        request.url_root.rstrip("/") + "/api/auth/discord/callback",
    )
    return oauth.discord.authorize_redirect(redirect_uri)


@app.route('/api/auth/discord/callback')
def discord_callback():
    """Callback OAuth2 — vérifie le serveur, crée la session."""
    try:
        token = oauth.discord.authorize_access_token()
    except Exception as e:
        return f"Erreur d'autorisation Discord : {e}", 400

    ses = make_discord_session(token)

    # Vérification du serveur (si GUILD_ID configuré)
    ok, err = check_guild_access(ses)
    if not ok:
        return f"Accès refusé : {err}", 403

    # Infos utilisateur
    discord_user = get_user_info(ses)
    user_id = discord_user["id"]
    display_name = discord_user.get("global_name") or discord_user["username"]

    # Pseudo sur le serveur Discord (si configuré)
    guild_id = os.environ.get("DISCORD_GUILD_ID")
    guild_nickname = None
    if guild_id:
        member = get_guild_member(ses, guild_id)
        if member:
            guild_nickname = member.get("nick") or member.get("user", {}).get("global_name")

    # Détermination du rôle + sauvegarde
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
    admin_count = cur.fetchone()[0]
    cur.execute("SELECT role FROM users WHERE id = ?", (user_id,))
    existing = cur.fetchone()
    if existing:
        role = existing["role"]  # garde le rôle existant
    elif admin_count == 0:
        role = "admin"  # premier utilisateur ou aucun admin → admin
    else:
        role = "user"

    # Sauvegarde / mise à jour dans la BDD
    conn.execute("""
        INSERT INTO users (id, username, display_name, avatar, role, guild_nickname, last_login)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            username=excluded.username,
            display_name=excluded.display_name,
            avatar=excluded.avatar,
            role=CASE WHEN excluded.role = 'admin' THEN 'admin' ELSE users.role END,
            guild_nickname=excluded.guild_nickname,
            last_login=CURRENT_TIMESTAMP
    """, (
        user_id,
        discord_user["username"],
        display_name,
        discord_user.get("avatar"),
        role,
        guild_nickname,
    ))

    # Chargement des settings utilisateur
    cur.execute("SELECT settings FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    user_settings = json.loads(row["settings"]) if row and row["settings"] else {}
    conn.close()

    # Chargement de la config Ollama stockée en BDD
    ollama_cfg = _get_ollama_config()
    if ollama_cfg.get("url") or ollama_cfg.get("model"):
        from embeddings import set_config
        set_config(url=ollama_cfg.get("url"), model=ollama_cfg.get("model"))

    # Création de la session Flask
    session["user"] = {
        "id": user_id,
        "username": discord_user["username"],
        "display_name": guild_nickname or display_name,
        "avatar": discord_user.get("avatar"),
        "avatar_url": avatar_url(discord_user),
        "role": role,
        "settings": user_settings,
        "guild_nickname": guild_nickname,
    }
    session.permanent = True

    # Page HTML : se ferme toute seule si popup, redirige sinon
    from flask import Response
    return Response(
        '<!DOCTYPE html><html><body><script>'
        'if(window.opener){'
        'window.opener.postMessage({type:"auth_success"},"*");'
        'window.close();'
        '}else{window.location.href="/";}'
        '</script></body></html>',
        mimetype='text/html'
    )


@app.route('/api/auth/me')
def auth_me():
    """Retourne l'utilisateur connecté ou 401."""
    user = get_logged_user()
    if not user:
        return jsonify({"error": "Non connecté"}), 401
    return jsonify(user)


@app.route('/api/auth/logout')
def discord_logout():
    """Déconnecte l'utilisateur."""
    session.clear()
    return jsonify({"status": "ok"})


@app.route('/api/auth/token', methods=['GET', 'POST'])
def api_token():
    """Gérer la clé API de l'utilisateur connecté."""
    guard = _login_required()
    if guard:
        return guard
    user_id = _get_current_user_id()
    conn = get_db()

    if request.method == 'POST':
        # Régénérer le token
        import secrets
        new_token = 'fr_ia_' + secrets.token_hex(24)
        conn.execute("UPDATE users SET api_token = ? WHERE id = ?", (new_token, user_id))
        conn.commit()
        conn.close()
        return jsonify({'token': new_token})

    # GET : retourner le token existant (ou en créer un)
    cur = conn.execute("SELECT api_token FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    if row and row['api_token']:
        conn.close()
        return jsonify({'token': row['api_token']})

    # Pas de token → en créer un
    import secrets
    new_token = 'fr_ia_' + secrets.token_hex(24)
    conn.execute("UPDATE users SET api_token = ? WHERE id = ?", (new_token, user_id))
    conn.commit()
    conn.close()
    return jsonify({'token': new_token})


# ── API keywords ─────────────────────────────────────────────────────

@app.route('/api/settings', methods=['GET', 'POST'])
def user_settings():
    guard = _login_required()
    if guard:
        return guard
    user_id = _get_current_user_id()
    conn = get_db()
    if request.method == 'POST':
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid JSON'}), 400
        conn.execute('UPDATE users SET settings = ? WHERE id = ?', (json.dumps(data), user_id))
        conn.commit()
        conn.close()
        session['user']['settings'] = data
        return jsonify({'status': 'ok'})
    cur = conn.execute('SELECT settings FROM users WHERE id = ?', (user_id,))
    row = cur.fetchone()
    conn.close()
    settings = json.loads(row['settings']) if row and row['settings'] else {}
    return jsonify(settings)


@app.route('/api/admin/users', methods=['GET'])
def admin_users():
    """Liste tous les utilisateurs (admin seulement)."""
    try:
        guard = _admin_required()
        if guard:
            return guard
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT id, username, display_name, avatar, role, guild_nickname, created_at, last_login FROM users ORDER BY role, username')
        users = [dict(r) for r in cur.fetchall()]
        conn.close()
        return jsonify(users)
    except Exception as e:
        return jsonify({'error': f'Erreur serveur: {e}'}), 500


@app.route('/api/members', methods=['GET'])
def list_members():
    """Liste tous les utilisateurs (accessible à tous les membres connectés)."""
    try:
        guard = _login_required()
        if guard:
            return guard
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT id, username, display_name, avatar, role FROM users ORDER BY role, username')
        users = [dict(r) for r in cur.fetchall()]
        conn.close()
        return jsonify(users)
    except Exception as e:
        return jsonify({'error': f'Erreur serveur: {e}'}), 500


@app.route('/api/admin/users/<user_id>/role', methods=['POST'])
def admin_set_role(user_id):
    guard = _admin_required()
    if guard:
        return guard
    data = request.get_json()
    new_role = data.get('role')
    if new_role not in ('admin', 'user'):
        return jsonify({'error': 'Role invalide'}), 400
    conn = get_db()
    conn.execute('UPDATE users SET role = ? WHERE id = ?', (new_role, user_id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/api/admin/users/<user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    guard = _admin_required()
    if guard:
        return guard
    current_id = _get_current_user_id()
    if user_id == current_id:
        return jsonify({'error': 'Tu ne peux pas te supprimer.'}), 400
    conn = get_db()
    conn.execute('DELETE FROM keyword_embeddings WHERE keyword_id IN (SELECT id FROM keywords WHERE user_id = ?)', (user_id,))
    conn.execute('DELETE FROM keywords WHERE user_id = ?', (user_id,))
    conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/api/admin/settings/ollama', methods=['GET', 'POST'])
def admin_ollama_settings():
    """Lire / définir la config Ollama (admin seulement)."""
    try:
        guard = _admin_required()
        if guard:
            return guard
        if request.method == 'POST':
            data = request.get_json()
            url = data.get('url', '').strip()
            model = data.get('model', '').strip()
            if not url or not model:
                return jsonify({'error': 'URL et modèle requis'}), 400
            conn = get_db()
            conn.execute("INSERT INTO app_settings (key, value) VALUES ('ollama_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (url,))
            conn.execute("INSERT INTO app_settings (key, value) VALUES ('ollama_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (model,))
            conn.commit()
            conn.close()
            from embeddings import set_config
            set_config(url=url, model=model)
            return jsonify({'status': 'ok'})
        cfg = _get_ollama_config()
        return jsonify(cfg)
    except Exception as e:
        return jsonify({'error': f'Erreur serveur: {e}'}), 500


@app.route('/api/admin/db/clear', methods=['POST'])
def admin_db_clear():
    guard = _admin_required()
    if guard:
        return guard
    conn = get_db()
    conn.execute('DELETE FROM keyword_embeddings')
    conn.execute('DELETE FROM keywords')
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})

@app.route('/api/search/semantic', methods=['GET'])
def semantic_search():
    """
    Recherche sémantique via Ollama.
    """
    guard = _login_required()
    if guard:
        return guard

    q = request.args.get('q', '').strip()
    limit = int(request.args.get('limit', 50))
    nsfw = request.args.get('nsfw', '')
    section = request.args.get('section', '').strip()
    min_confidence = float(request.args.get('confidence', 0))

    if not q:
        return jsonify([])

    if not is_available():
        return jsonify({'error': 'Serveur Ollama inaccessible. Vérifie la config dans Admin > Ollama.'}), 400

    try:
        query_vec = generate_embedding(q)
    except Exception as e:
        return jsonify({'error': f'Erreur Ollama: {e}'}), 500

    conn = get_db()
    cur = conn.cursor()

    conditions = []
    params = []
    if nsfw == '0':
        conditions.append("k.nsfw = 0")
    elif nsfw == '1':
        conditions.append("k.nsfw = 1")
    if section:
        conditions.append("k.section_id = ?")
        params.append(section)

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    cur.execute(f"""
        SELECT k.id, k.keyword, k.description, k.section_id, k.section_title,
               k.subsection_id, k.subsection_title, k.nsfw, ke.embedding
        FROM keywords k
        JOIN keyword_embeddings ke ON ke.keyword_id = k.id
        WHERE {where_clause}
    """, params)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return jsonify([])

    results = []
    for row in rows:
        vec = json.loads(row['embedding'])
        similarity = cosine_similarity(query_vec, vec)
        if similarity < min_confidence:
            continue
        results.append({
            'id': row['id'],
            'keyword': row['keyword'],
            'description': row['description'],
            'section_id': row['section_id'],
            'section_title': row['section_title'],
            'subsection_id': row['subsection_id'],
            'subsection_title': row['subsection_title'],
            'nsfw': row['nsfw'],
            'score': round(similarity, 4)
        })

    results.sort(key=lambda x: x['score'], reverse=True)
    return jsonify(results[:limit])


@app.route('/api/keywords', methods=['GET'])
def list_keywords():
    guard = _login_required()
    if guard:
        return guard

    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()

    q = request.args.get('q', '').strip().lower()
    q_neg = request.args.get('q_neg', '').strip().lower()
    section = request.args.get('section', '').strip()
    nsfw_raw = request.args.get('nsfw', '').strip()

    conditions = ["1=1"]
    params = []

    if q:
        like = f"%{q}%"
        conditions.append("(LOWER(k.keyword) LIKE ? OR LOWER(k.description) LIKE ? OR LOWER(k.section_title) LIKE ? OR LOWER(k.subsection_title) LIKE ?)")
        params.extend([like, like, like, like])

    if q_neg:
        like_neg = f"%{q_neg}%"
        conditions.append("(LOWER(k.keyword) NOT LIKE ? AND LOWER(k.description) NOT LIKE ? AND LOWER(k.section_title) NOT LIKE ? AND LOWER(k.subsection_title) NOT LIKE ?)")
        params.extend([like_neg, like_neg, like_neg, like_neg])

    if section:
        conditions.append("k.section_id = ?")
        params.append(section)

    if nsfw_raw in ('0', '1'):
        conditions.append("k.nsfw = ?")
        params.append(int(nsfw_raw))

    sql = f"""
        SELECT k.id, k.keyword, k.description, k.section_id, k.section_title,
               k.subsection_id, k.subsection_title, k.nsfw
        FROM keywords k
        WHERE {' AND '.join(conditions)}
        ORDER BY k.section_id, k.subsection_id, k.keyword
    """
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.route('/api/sections', methods=['GET'])
def list_sections():
    guard = _login_required()
    if guard:
        return guard

    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT k.section_id, k.section_title,
               COUNT(*) as total,
               SUM(k.nsfw) as nsfw_count
        FROM keywords k
        GROUP BY k.section_id
        ORDER BY k.section_id
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.route('/api/stats', methods=['GET'])
def stats():
    guard = _login_required()
    if guard:
        return guard

    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*) as total,
               SUM(k.nsfw) as nsfw_total,
               COUNT(DISTINCT k.section_id) as section_count,
               COUNT(DISTINCT k.subsection_id) as subsection_count
        FROM keywords k
    """)
    row = dict(cur.fetchone())
    row = {k: (v if v is not None else 0) for k, v in row.items()}
    cur.execute("SELECT COUNT(*) as total FROM generated_prompts")
    gen = cur.fetchone()
    row['generated_total'] = gen['total'] if gen else 0
    conn.close()
    return jsonify(row)


@app.route('/api/import', methods=['POST'])
def import_md():
    try:
        guard = _login_required()
        if guard:
            return guard

        user_id = _get_current_user_id()

        if not is_available():
            return jsonify({'error': 'Serveur Ollama inaccessible. Vérifie la configuration dans Admin > Ollama.'}), 400

        if 'file' in request.files:
            f = request.files['file']
            tmp = BASE_DIR / '__tmp_import.md'
            f.save(tmp)
            filepath = tmp
            delete_after = True
        else:
            filepath = MD_PATH
            delete_after = False

        if not filepath.exists():
            return jsonify({'error': 'Fichier markdown non trouvé'}), 400

        entries = parse_markdown(str(filepath))

        conn = get_db()
        cur = conn.cursor()

        # Charger les mots-clés existants
        cur.execute("SELECT LOWER(keyword) FROM keywords")
        existing = {row[0] for row in cur.fetchall()}

        # Déduplication du fichier (dernière occurrence écrase)
        unique_map = {}
        for e in entries:
            key = e['keyword'].lower().strip()
            unique_map[key] = e

        imported = 0
        updated = 0
        skipped = 0
        for key, e in unique_map.items():
            if key in existing:
                # Déjà présent → mettre à jour
                cur.execute("""
                    UPDATE keywords SET
                        description = ?,
                        section_id = ?,
                        section_title = ?,
                        subsection_id = ?,
                        subsection_title = ?,
                        nsfw = ?
                    WHERE LOWER(keyword) = ?
                """, (
                    e['description'], e['section_id'], e['section_title'],
                    e['subsection_id'], e['subsection_title'], int(e['nsfw']),
                    key
                ))
                updated += 1
            else:
                # Nouveau → insérer
                cur.execute("""
                    INSERT INTO keywords
                    (keyword, description, section_id, section_title, subsection_id, subsection_title, nsfw)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    e['keyword'], e['description'], e['section_id'], e['section_title'],
                    e['subsection_id'], e['subsection_title'], int(e['nsfw'])
                ))
                imported += 1
                existing.add(key)

        conn.commit()

        _generate_all_embeddings(conn)
        conn.close()

        dups_file = len(entries) - len(unique_map)
        parts = [f"{imported} importes"]
        if updated:
            parts.append(f"{updated} mis a jour")
        if dups_file:
            parts.append(f"{dups_file} doublons ignores dans le fichier")
        return jsonify({'imported': imported, 'updated': updated, 'duplicates_skipped': dups_file, 'message': ', '.join(parts)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        try:
            if delete_after and tmp.exists():
                tmp.unlink()
        except Exception:
            pass


@app.route('/api/embeddings/build', methods=['POST'])
def build_embeddings():
    guard = _login_required()
    if guard:
        return guard

    if not is_available():
        return jsonify({'error': 'Serveur Ollama inaccessible. Vérifie la config dans Admin > Ollama.'}), 400
    try:
        conn = get_db()
        _generate_all_embeddings(conn)
        conn.close()
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/filters', methods=['GET', 'POST'])
def filters():
    guard = _login_required()
    if guard:
        return guard
    user_id = _get_current_user_id()

    if request.method == 'POST':
        data = request.get_json()
        if not data or not data.get('name'):
            return jsonify({'error': 'Nom requis'}), 400

        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO saved_filters (user_id, name, category, nsfw, is_public, config) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, data['name'].strip(), data.get('category', '').strip(), int(data.get('nsfw', 0)), int(data.get('is_public', 0)), json.dumps(data.get('config', {})))
        )
        filter_id = cur.lastrowid
        conn.commit()
        config = data.get('config', {})
        if isinstance(config, dict):
            _rebuild_filter_cache(cur, filter_id, config)
        conn.commit()
        conn.close()
        return jsonify({'id': filter_id, 'count': _count_filter_cache(filter_id)}), 201

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, user_id, name, category, nsfw, is_public, config FROM saved_filters WHERE user_id = ? OR is_public = 1 ORDER BY name", (user_id,))
    rows = cur.fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d['config'] = json.loads(d['config']) if isinstance(d['config'], str) else d['config']
        result.append(d)
    return jsonify(result)


@app.route('/api/filters/<int:filter_id>', methods=['PUT', 'DELETE'])
def single_filter(filter_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM saved_filters WHERE id = ?", (filter_id,))
    row = cur.fetchone()
    if not row or row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    if request.method == 'DELETE':
        cur.execute("DELETE FROM saved_filters WHERE id = ?", (filter_id,))
        conn.commit(); conn.close()
        return jsonify({'status': 'ok'})
    data = request.get_json() or {}
    vals = (
        data.get('name', row['name']),
        data.get('category', row['category'] or ''),
        int(data.get('nsfw', row['nsfw'])),
        int(data.get('is_public', row['is_public'])),
        filter_id
    )
    cur.execute("UPDATE saved_filters SET name=?, category=?, nsfw=?, is_public=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", vals)
    config = data.get('config')
    if config and isinstance(config, dict):
        cur.execute("UPDATE saved_filters SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(config), filter_id))
        cur.execute("DELETE FROM filter_cache WHERE filter_id = ?", (filter_id,))
        _rebuild_filter_cache(cur, filter_id, config)
    conn.commit(); conn.close()
    return jsonify({'status': 'ok'})


@app.route('/api/filters/<int:filter_id>/refresh', methods=['POST'])
def refresh_filter_cache(filter_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT user_id, config FROM saved_filters WHERE id = ?", (filter_id,))
    row = cur.fetchone()
    if not row or row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    config = json.loads(row['config']) if isinstance(row['config'], str) else row['config']
    cur.execute("DELETE FROM filter_cache WHERE filter_id = ?", (filter_id,))
    _rebuild_filter_cache(cur, filter_id, config)
    conn.commit(); conn.close()
    return jsonify({'status': 'ok', 'count': _count_filter_cache(filter_id)})


def _rebuild_filter_cache(cur, filter_id, config):
    conditions = ["1=1"]
    params = []
    section = config.get('section', '').strip()
    search_text = config.get('search_text', '').strip()
    search_neg = config.get('search_neg', '').strip()
    semantic_text = config.get('semantic_text', '').strip()
    min_confidence = float(config.get('min_confidence', 0))
    nsfw = str(config.get('nsfw_filter', ''))
    hidden_ids = config.get('hidden_kw_ids', [])

    if section:
        conditions.append("k.section_id = ?")
        params.append(section)
    if nsfw == '0':
        conditions.append("k.nsfw = 0")
    elif nsfw == '1':
        conditions.append("k.nsfw = 1")
    if search_text and not semantic_text:
        like = f"%{search_text.lower()}%"
        conditions.append("(LOWER(k.keyword) LIKE ? OR LOWER(k.description) LIKE ? OR LOWER(k.section_title) LIKE ? OR LOWER(k.subsection_title) LIKE ?)")
        params.extend([like, like, like, like])
    if search_neg:
        like_neg = f"%{search_neg.lower()}%"
        conditions.append("(LOWER(k.keyword) NOT LIKE ? AND LOWER(k.description) NOT LIKE ? AND LOWER(k.section_title) NOT LIKE ? AND LOWER(k.subsection_title) NOT LIKE ?)")
        params.extend([like_neg, like_neg, like_neg, like_neg])
    if hidden_ids and isinstance(hidden_ids, list) and len(hidden_ids) > 0:
        ph = ','.join('?' for _ in hidden_ids)
        conditions.append(f"k.id NOT IN ({ph})")
        params.extend(hidden_ids)

    if semantic_text:
        try:
            from embeddings import generate_embedding, cosine_similarity
            qe = generate_embedding(semantic_text)
            # Pré-filtrer section/nsfw dans la requête SQL (hidden_ids appliqué APRES la limite)
            sem_conds = ["1=1"]
            sem_params = []
            if section:
                sem_conds.append("k.section_id = ?")
                sem_params.append(section)
            if nsfw == '0':
                sem_conds.append("k.nsfw = 0")
            elif nsfw == '1':
                sem_conds.append("k.nsfw = 1")
            sem_where = " AND ".join(sem_conds)
            cur.execute(f"SELECT k.id, ke.embedding, k.keyword, k.description, k.section_title, k.subsection_title FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id WHERE {sem_where}", sem_params)
            # Calculer scores, filtrer, trier, limiter
            scored = []
            q_lower = search_text.lower() if search_text else ''
            neg_lower = search_neg.lower() if search_neg else ''
            for r in cur.fetchall():
                emb = json.loads(r['embedding'])
                sim = cosine_similarity(qe, emb)
                if sim < min_confidence:
                    continue
                # Appliquer texte (+) et exclusion (-) sur 4 champs (identique à loadKeywords)
                if q_lower or neg_lower:
                    fields = [
                        (r['keyword'] or '').lower(),
                        (r['description'] or '').lower(),
                        (r['section_title'] or '').lower(),
                        (r['subsection_title'] or '').lower()
                    ]
                    if q_lower and not any(q_lower in f for f in fields):
                        continue
                    if neg_lower and any(neg_lower in f for f in fields):
                        continue
                scored.append((r['id'], sim))
            scored.sort(key=lambda x: x[1], reverse=True)
            # Prendre le top 500 (même ensemble que l'API), puis filtrer les masqués (comme renderTable)
            top = scored[:500]
            hidden_set = set(hidden_ids) if hidden_ids and isinstance(hidden_ids, list) else set()
            for kid, _ in top:
                if kid not in hidden_set:
                    cur.execute("INSERT OR IGNORE INTO filter_cache (filter_id, keyword_id) VALUES (?, ?)", (filter_id, kid))
        except Exception as e:
            print(f"[_rebuild_filter_cache] Erreur branche semantique filtre {filter_id}: {e}")
        return

    where = " AND ".join(conditions)
    cur.execute(f"INSERT OR IGNORE INTO filter_cache (filter_id, keyword_id) SELECT ?, k.id FROM keywords k WHERE {where}", [filter_id] + params)


def _count_filter_cache(filter_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM filter_cache WHERE filter_id = ?", (filter_id,))
    c = cur.fetchone()[0]
    conn.close()
    return c



@app.route('/api/filters/<int:filter_id>/preview', methods=['GET'])
def preview_filter(filter_id):
    guard = _login_required()
    if guard: return guard
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT k.keyword FROM filter_cache fc JOIN keywords k ON k.id = fc.keyword_id WHERE fc.filter_id = ? LIMIT 20", (filter_id,))
    keywords = [r['keyword'] for r in cur.fetchall()]
    cur.execute("SELECT COUNT(*) FROM filter_cache WHERE filter_id = ?", (filter_id,))
    total = cur.fetchone()[0]
    cur.execute("SELECT name, config FROM saved_filters WHERE id = ?", (filter_id,))
    info = cur.fetchone()
    conn.close()
    return jsonify({
        'name': info['name'] if info else '',
        'total': total,
        'keywords': keywords,
        'config': json.loads(info['config']) if info and isinstance(info['config'], str) else (info['config'] if info else {})
    })


# ═══════════════════════════════════════════════════════════════════
# Phase 1 : Presets IA + Styles + Enhance
# ═══════════════════════════════════════════════════════════════════

# ── Presets ─────────────────────────────────────────────────────────

@app.route('/api/presets', methods=['GET', 'POST'])
def presets():
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()

    if request.method == 'GET':
        try:
            rows = cur.execute("""
                SELECT p.*, u.username, u.display_name
                FROM ai_presets p
                LEFT JOIN users u ON u.id = p.user_id
                WHERE p.is_global = 1 OR p.user_id = ?
                ORDER BY p.is_global DESC, p.name
            """, (user_id,)).fetchall()
        except Exception as e:
            conn.close()
            return jsonify({'error': f'DB error: {e}'}), 500
        conn.close()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'user_id': r['user_id'],
                'name': r['name'],
                'engine': r['engine'],
                'base_url': r['base_url'],
                'model': r['model'],
                'is_global': bool(r['is_global']),
                'is_client_side': bool(_row_get(r, 'is_client_side', 0)),
                'owner_name': r['display_name'] or r['username'] or '',
                'created_at': r['created_at']
            })
        return jsonify(result)

    # POST : creation (admin pour global, tout le monde pour perso)
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    base_url = data.get('base_url', '').strip()
    api_key = data.get('api_key', '').strip()
    model = data.get('model', '').strip()
    is_global = int(data.get('is_global', 0))
    is_client_side = int(data.get('is_client_side', 0))

    if not name or not base_url:
        conn.close()
        return jsonify({'error': 'Nom et URL requis'}), 400

    if is_global:
        admin_guard = _admin_required()
        if admin_guard:
            conn.close()
            return admin_guard

    enc = encrypt_api_key(api_key)
    cur.execute(
        "INSERT INTO ai_presets (user_id, name, engine, base_url, api_key_encrypted, model, is_global, is_client_side) VALUES (?, ?, 'openai', ?, ?, ?, ?, ?)",
        (user_id if not is_global else None, name, base_url, enc, model, is_global, is_client_side)
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return jsonify({'id': pid, 'name': name}), 201


@app.route('/api/presets/<int:preset_id>', methods=['PUT', 'DELETE'])
def single_preset(preset_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    # Verifier propriete : global = admin only, perso = owner or admin
    if row['is_global']:
        admin_guard = _admin_required()
        if admin_guard:
            conn.close()
            return admin_guard
    elif row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    if request.method == 'DELETE':
        cur.execute("UPDATE generated_prompts SET preset_id = NULL WHERE preset_id = ?", (preset_id,))
        cur.execute("DELETE FROM ai_presets WHERE id = ?", (preset_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok'})

    # PUT
    data = request.get_json() or {}
    api_key_val = data.get('api_key', None)
    if api_key_val is not None:
        enc = encrypt_api_key(api_key_val.strip()) if api_key_val.strip() else ''
    else:
        enc = row['api_key_encrypted']  # garder l'ancienne

    cur.execute("""
        UPDATE ai_presets
        SET name = ?, base_url = ?, api_key_encrypted = ?, model = ?, is_client_side = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (
        data.get('name', row['name']),
        data.get('base_url', row['base_url']),
        enc,
        data.get('model', row['model']),
        int(data.get('is_client_side', _row_get(row, 'is_client_side', 0))),
        preset_id
    ))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/api/presets/<int:preset_id>/duplicate', methods=['POST'])
def duplicate_preset(preset_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    row = conn.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    # Seulement les globaux ou ses propres presets peuvent être dupliques
    if not row['is_global'] and row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO ai_presets (user_id, name, engine, base_url, api_key_encrypted, model, is_global)
        VALUES (?, ? || ' (copie)', ?, ?, ?, ?, 0)
    """, (user_id, row['name'], row['engine'], row['base_url'], row['api_key_encrypted'], row['model']))
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return jsonify({'id': pid, 'name': row['name'] + ' (copie)'}), 201


@app.route('/api/presets/<int:preset_id>/models', methods=['GET'])
def list_preset_models(preset_id):
    guard = _login_required()
    if guard: return guard
    conn = get_db()
    row = conn.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    base_url = row['base_url'].rstrip('/')
    api_key = decrypt_api_key(row['api_key_encrypted'])
    conn.close()

    import requests
    try:
        headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
        r = requests.get(f'{base_url}/models', headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()
        models = []
        for m in data.get('data', data.get('models', [])):
            if isinstance(m, dict):
                models.append({'id': m.get('id', ''), 'name': m.get('name', m.get('id', '')), 'owned_by': m.get('owned_by', '')})
            elif isinstance(m, str):
                models.append({'id': m, 'name': m, 'owned_by': ''})
        return jsonify(models)
    except Exception as e:
        return jsonify({'error': f'Impossible de lister les modeles : {e}'}), 502


@app.route('/api/presets/list-models', methods=['POST'])
def list_models_temp():
    """Endpoint temporaire pour lister les modeles sans preset enregistre."""
    guard = _login_required()
    if guard: return guard
    data = request.get_json() or {}
    base_url = (data.get('base_url') or '').rstrip('/')
    api_key = (data.get('api_key') or '').strip()
    if not base_url:
        return jsonify({'error': 'URL requise'}), 400
    import requests
    try:
        headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
        r = requests.get(f'{base_url}/models', headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()
        models = []
        raw = data.get('data', data.get('models', []))
        for m in raw:
            if isinstance(m, dict):
                models.append({'id': m.get('id', ''), 'name': m.get('name', m.get('id', '')), 'owned_by': m.get('owned_by', '')})
            elif isinstance(m, str):
                models.append({'id': m, 'name': m, 'owned_by': ''})
        return jsonify(models)
    except Exception as e:
        return jsonify({'error': f'Impossible de lister les modeles : {e}'}), 502


# ── Styles ──────────────────────────────────────────────────────────

@app.route('/api/styles', methods=['GET', 'POST'])
def styles():
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()

    if request.method == 'GET':
        try:
            rows = cur.execute("""
                SELECT s.*, u.username, u.display_name
                FROM styles s
                LEFT JOIN users u ON u.id = s.user_id
                WHERE s.is_public = 1 OR s.user_id = ?
                ORDER BY s.is_public DESC, s.name
            """, (user_id,)).fetchall()
        except Exception as e:
            conn.close()
            return jsonify({'error': f'DB error: {e}'}), 500
        conn.close()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'name': r['name'],
                'style_text': r['style_text'],
                'negative_prompt': _row_get(r, 'negative_prompt', ''),
                'is_public': bool(r['is_public']),
                'user_id': r['user_id'],
                'owner_name': r['display_name'] or r['username'] or ''
            })
        return jsonify(result)

    data = request.get_json() or {}
    name = data.get('name', '').strip()
    style_text = data.get('style_text', '').strip()
    negative_prompt = data.get('negative_prompt', '').strip()
    is_public = int(data.get('is_public', 0))
    if not name or not style_text:
        conn.close()
        return jsonify({'error': 'Nom et texte requis'}), 400

    cur.execute(
        "INSERT INTO styles (user_id, name, style_text, negative_prompt, is_public) VALUES (?, ?, ?, ?, ?)",
        (user_id, name, style_text, negative_prompt, is_public)
    )
    conn.commit()
    sid = cur.lastrowid
    conn.close()
    return jsonify({'id': sid, 'name': name}), 201


@app.route('/api/styles/<int:style_id>', methods=['PUT', 'DELETE'])
def single_style(style_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    row = conn.execute("SELECT * FROM styles WHERE id = ?", (style_id,)).fetchone()
    if not row or row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    if request.method == 'DELETE':
        # Détacher les prompts générés qui référencent ce style (FK constraint)
        conn.execute("UPDATE generated_prompts SET style_id = NULL WHERE style_id = ?", (style_id,))
        conn.execute("DELETE FROM styles WHERE id = ?", (style_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok'})

    data = request.get_json() or {}
    conn.execute("""
        UPDATE styles SET name = ?, style_text = ?, negative_prompt = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (
        data.get('name', row['name']),
        data.get('style_text', row['style_text']),
        data.get('negative_prompt', _row_get(row, 'negative_prompt', '')),
        int(data.get('is_public', row['is_public'])),
        style_id
    ))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


# ── Enhance ─────────────────────────────────────────────────────────

@app.route('/api/enhance', methods=['POST'])
def enhance_prompt():
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    data = request.get_json() or {}

    preset_id = data.get('preset_id')
    text = data.get('text', '').strip()
    prompt_type = data.get('prompt_type', 'sdxl').strip()
    output_format = data.get('output_format', 'text').strip()
    style_text = data.get('style_text', '').strip()
    special_instructions = data.get('special_instructions', '').strip()
    ep_elements = data.get('ep_elements', [])
    random_count = int(data.get('random_count', 0))

    # Resoudre les elements EP
    ep_keywords = []
    if ep_elements:
        conn = get_db()
        cur = conn.cursor()
        for elem in ep_elements:
            if elem.get('type') == 'filter' and elem.get('id'):
                cur.execute("SELECT keyword_id FROM filter_cache WHERE filter_id = ?", (elem['id'],))
                kids = [r[0] for r in cur.fetchall()]
                if kids:
                    cur.execute("SELECT keyword FROM keywords WHERE id IN (" + ','.join('?' for _ in kids) + ")", kids)
                    kws = [r[0] for r in cur.fetchall()]
                    if kws:
                        ep_keywords.append(random.choice(kws))
            elif elem.get('type') == 'text' and elem.get('text'):
                try:
                    qv = generate_embedding(elem['text'])
                    cur.execute("SELECT k.keyword FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id")
                    rows = cur.fetchall()
                    scored = []
                    for r in rows:
                        vec = json.loads(r[1] if len(r) > 1 else '')
                        if vec:
                            s = cosine_similarity(qv, vec)
                            if s >= 0.45:
                                scored.append((r[0], s))
                    scored.sort(key=lambda x: x[1], reverse=True)
                    top5 = [k for k, _ in scored[:5]]
                    if top5:
                        ep_keywords.append(random.choice(top5))
                except Exception:
                    pass
        conn.close()

    ep_text = ', '.join(ep_keywords) if ep_keywords else ''

    # Random elements : piocher depuis sections non encore utilisees
    rand_keywords = []
    if random_count > 0:
        conn = get_db()
        cur = conn.cursor()
        # Trouver les sections deja utilisees
        all_kw_text = (text + ' ' + ep_text).lower()
        existing = []
        for kw in all_kw_text.replace(',', ' ').split():
            kw = kw.strip()
            if len(kw) >= 3:
                existing.append(kw)
        if existing:
            placeholders = ','.join('?' for _ in existing)
            cur.execute(f"SELECT DISTINCT section_id FROM keywords WHERE LOWER(keyword) IN ({placeholders})", existing)
            used_sections = {r[0] for r in cur.fetchall() if r[0]}
        else:
            used_sections = set()
        # Piocher des keywords depuis des sections inutilisees
        if used_sections:
            ph = ','.join('?' for _ in used_sections)
            cur.execute(f"SELECT keyword FROM keywords WHERE section_id NOT IN ({ph}) OR section_id IS NULL ORDER BY RANDOM() LIMIT ?", list(used_sections) + [random_count])
        else:
            cur.execute("SELECT keyword FROM keywords ORDER BY RANDOM() LIMIT ?", (random_count,))
        rand_keywords = [r[0] for r in cur.fetchall()]
        conn.close()

    rand_text = ', '.join(rand_keywords) if rand_keywords else ''

    # Fusionner avec priorites
    merged_parts = []
    if text:
        merged_parts.append(f"[PRIORITE HAUTE] {text}")
    if ep_text:
        merged_parts.append(f"[PRIORITE MOYENNE] {ep_text}")
    if rand_text:
        merged_parts.append(f"[PRIORITE BASSE] {rand_text}")

    merged_text = '\n'.join(merged_parts)

    if not merged_text.strip():
        return jsonify({'error': 'Aucun contenu a generer'}), 400

    # Recuperer le preset
    conn = get_db()
    preset = None
    if preset_id:
        preset = conn.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not preset:
        # Fallback : premier preset personnel dispo
        preset = conn.execute(
            "SELECT * FROM ai_presets WHERE user_id = ? OR is_global = 1 ORDER BY is_global DESC LIMIT 1",
            (user_id,)
        ).fetchone()
    if not preset:
        conn.close()
        return jsonify({'error': 'Aucun preset IA configure. Cree un preset dans la configuration.'}), 400

    api_key = decrypt_api_key(preset['api_key_encrypted'])
    base_url = preset['base_url'].rstrip('/')
    model = preset['model']
    conn.close()

    # Construire le prompt systeme
    type_formats = {
        'liste': 'Liste de tags separes par des virgules, ordonnes par importance (exemple: "masterpiece, 1girl, blue sky, city street, long hair").',
        'sdxl': 'Prompt SDXL optimise avec Natural Language + tags Danbooru, bien equilibre. Format: qualite + sujet principal + description scene + details techniques.',
        'sd15': 'Prompt Stable Diffusion 1.5 avec tags Danbooru. Format court et dense, priorite aux tags essentiels.',
        'flux': 'Prompt Flux, description longue et naturelle en anglais.',
        'anima': 'Prompt Anime/Manga, tags Danbooru avec suffixes specifiques (pixel art, lineart, flat color, etc.).',
        'qwen': 'Prompt Qwen, format optimise pour modele Qwen2-VL / image generation.',
    }

    format_instruction = type_formats.get(prompt_type, type_formats['sdxl'])

    # Recuperer les top 5 examples pour ce type
    conn = get_db()
    examples = conn.execute(
        "SELECT prompt_text FROM prompt_examples WHERE type = ? ORDER BY rating DESC LIMIT 5",
        (prompt_type,)
    ).fetchall()
    conn.close()

    examples_text = ''
    if examples:
        examples_text = '\nExemples de prompts ' + prompt_type + ' :\n'
        for ex in examples:
            examples_text += '- ' + ex['prompt_text'] + '\n'

    # Construire le format de sortie
    format_rules = {
        'text': 'Reponds UNIQUEMENT avec le prompt final, sans guillemets ni code blocks. Pas d\'explications.',
        'markdown': 'Reponds en Markdown pur, SANS bloc de code (pas de \`\`\`). Le prompt doit etre le contenu principal, tu peux ajouter des titres et listes si pertinent.',
        'json': 'Reponds en JSON pur, SANS bloc de code (pas de \`\`\`json). Format: {\"prompt\": \"...\", \"format\": \"' + prompt_type + '\", \"negative_prompt\": \"\"}.'
    }

    system_prompt = f"""Tu es un assistant expert en generation de prompts d'images.
Ta tache : transformer le contenu fourni en un prompt optimise pour {prompt_type}.

Le contenu peut avoir des annotations de priorite :
- [PRIORITE HAUTE] = choix explicite de l'utilisateur, a preserver au maximum
- [PRIORITE MOYENNE] = suggestions d'un picker automatique, a integrer si pertinent
- [PRIORITE BASSE] = elements aleatoires pour diversifier, a utiliser seulement si ils enrichissent vraiment le prompt

Format demande : {format_instruction}

{examples_text}
Regles :
- En cas de conflit entre tags (ex: "long hair" vs "short hair"), privilegie [PRIORITE HAUTE]
- Supprime les doublons automatiquement
- Organise les tags par ordre d'importance
- Ajoute des qualifiers si pertinent (masterpiece, best quality, etc.)
{format_rules.get(output_format, "Reponds UNIQUEMENT avec le prompt final.")}
"""

    if style_text:
        system_prompt += f"\nStyle impose : {style_text}"
    if special_instructions:
        system_prompt += f"\nInstructions speciales : {special_instructions}"

    # Appel LLM
    import requests
    try:
        headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'} if api_key else {'Content-Type': 'application/json'}
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': merged_text}
            ],
            'temperature': 0.7,
            'max_tokens': 1024
        }
        r = requests.post(f'{base_url}/chat/completions', headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        result = r.json()
        output = result['choices'][0]['message']['content'].strip()
        # Nettoyer les balises de code eventuelles
        if output.startswith('```'):
            lines = output.split('\n')
            if lines[0].startswith('```'):
                lines = lines[1:]
            if lines and lines[-1].strip() == '```':
                lines = lines[:-1]
            output = '\n'.join(lines).strip()
    except Exception as e:
        msg = str(e)
        if '429' in msg:
            return jsonify({'error': 'Rate limit atteint sur le serveur LLM. Attends un peu et reessaye.'}), 429
        if 'connect' in msg.lower() or 'refused' in msg.lower():
            return jsonify({'error': f'Serveur LLM inaccessible : verifie l\'URL ({base_url})'}), 502
        return jsonify({'error': f'Erreur LLM: {msg}'}), 502

    # Sauvegarde du prompt genere
    try:
        conn2 = get_db()
        conn2.execute(
            """INSERT INTO generated_prompts (user_id, preset_id, prompt_type, input_text, output_text, style_id, model_used)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, preset['id'] if preset else None, prompt_type, merged_text, output, data.get('style_id'), model)
        )
        conn2.commit()
        conn2.close()
    except Exception:
        pass  # non-bloquant

    return jsonify({'output': output, 'model_used': model})


@app.route('/api/generate', methods=['POST'])
def generate_prompt():
    guard = _login_required()
    if guard:
        return guard
    data = request.get_json()
    if not data or not data.get('elements'):
        return jsonify({'error': 'elements requis'}), 400

    elements = data['elements']
    conn = get_db()
    cur = conn.cursor()
    keywords = []
    debug = []

    for elem in elements:
        kid = None
        kind = ''
        score = 0

        if elem.get('type') == 'filter' and elem.get('id'):
            kind = 'filter'
            # Recuperer le nom du filtre et la taille du cache
            finfo = cur.execute("SELECT name, (SELECT COUNT(*) FROM filter_cache WHERE filter_id = ?) as cnt FROM saved_filters WHERE id = ?", (elem['id'], elem['id'])).fetchone()
            cur.execute("SELECT keyword_id FROM filter_cache WHERE filter_id = ? ORDER BY RANDOM() LIMIT 1", (elem['id'],))
            row = cur.fetchone()
            if row:
                kid = row['keyword_id']
            if finfo:
                debug.append({'source': f"filtre '{finfo['name']}' (cache: {finfo['cnt']})", 'picked': bool(kid)})

        elif elem.get('type') == 'text' and elem.get('text'):
            kind = 'semantic'
            try:
                from embeddings import generate_embedding, cosine_similarity
                qe = generate_embedding(elem['text'])
                cur.execute("SELECT k.id, ke.embedding FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id")
                rows = cur.fetchall()
                if rows:
                    scored = []
                    for r in rows:
                        emb = json.loads(r['embedding'])
                        sim = cosine_similarity(qe, emb)
                        if sim >= 0.45:
                            scored.append((r['id'], sim))
                    if scored:
                        scored.sort(key=lambda x: x[1], reverse=True)
                        top = scored[:min(5, len(scored))]
                        kid, score = random.choice(top)
            except Exception:
                pass

        if kid:
            cur.execute("SELECT keyword FROM keywords WHERE id = ?", (kid,))
            row = cur.fetchone()
            if row:
                keywords.append(row['keyword'])
                debug.append({'keyword': row['keyword'], 'source': kind, 'score': round(score, 3)})

    conn.close()
    prompt = ", ".join(keywords) if keywords else ""
    return jsonify({'prompt': prompt, 'count': len(keywords), 'elements': debug, 'debug': debug})


@app.route('/api/export', methods=['GET'])
def export_md():
    guard = _login_required()
    if guard:
        return guard

    if not DB_PATH.exists():
        return jsonify({'error': 'Base de données vide'}), 400

    content = export_to_markdown(str(DB_PATH))
    buf = io.BytesIO(content.encode('utf-8'))
    buf.seek(0)
    return send_file(
        buf,
        mimetype='text/markdown',
        as_attachment=True,
        download_name='Keywords-Export.md'
    )


# ── Fichiers statiques ────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR / 'frontend'), 'index.html')


@app.route('/beta')
def beta():
    return send_from_directory(str(BASE_DIR / 'frontend'), 'beta.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(str(BASE_DIR / 'frontend'), path)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
