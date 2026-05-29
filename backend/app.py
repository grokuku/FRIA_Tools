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

    # Migrations : ajout de colonnes si absentes
    cols_kw = [r[1] for r in conn.execute("PRAGMA table_info(keywords)").fetchall()]
    if "user_id" not in cols_kw:
        conn.execute("ALTER TABLE keywords ADD COLUMN user_id TEXT REFERENCES users(id)")

    cols_users = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    for col, default in [("role", "'user'"), ("settings", "'{}'"), ("guild_nickname", "NULL")]:
        if col not in cols_users:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT DEFAULT {default}")

    conn.commit()
    conn.close()


def _get_current_user_id() -> str | None:
    """Retourne l'ID Discord de l'utilisateur connecté, ou None."""
    user = session.get("user")
    return user["id"] if user else None


def _login_required():
    """Retourne une erreur 401 si non connecté."""
    user_id = _get_current_user_id()
    if not user_id:
        return jsonify({"error": "Connexion requise. Utilisez le bouton 'Connexion Discord'."}), 401
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
    """Génère et stocke les embeddings HF pour tous les mots-clés."""
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

    # Détermination du rôle
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
    conn = get_db()
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
    section = request.args.get('section', '').strip()
    nsfw_raw = request.args.get('nsfw', '').strip()

    conditions = ["1=1"]
    params = []

    if q:
        conditions.append("(LOWER(k.keyword) LIKE ? OR LOWER(k.description) LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])

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
    # Gérer les NULL (SUM sur table vide)
    row = {k: (v if v is not None else 0) for k, v in row.items()}
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
            return jsonify({'error': 'Token HF non configuré. Définissez HF_TOKEN.'}), 400

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
    conn.commit()
    config = data.get('config')
    if config and isinstance(config, dict):
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
    semantic_text = config.get('semantic_text', '').strip()
    min_confidence = float(config.get('min_confidence', 0))
    nsfw = str(config.get('nsfw_filter', ''))

    if section:
        conditions.append("k.section_id = ?")
        params.append(section)
    if nsfw == '0':
        conditions.append("k.nsfw = 0")
    elif nsfw == '1':
        conditions.append("k.nsfw = 1")
    if search_text and not semantic_text:
        like = f"%{search_text.lower()}%"
        conditions.append("(LOWER(k.keyword) LIKE ? OR LOWER(k.description) LIKE ?)")
        params.extend([like, like])

    if semantic_text:
        try:
            from embeddings import generate_embedding, cosine_similarity
            qe = generate_embedding(semantic_text)
            cur.execute("SELECT k.id, ke.embedding FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id")
            for r in cur.fetchall():
                emb = json.loads(r['embedding'])
                sim = cosine_similarity(qe, emb)
                if sim >= min_confidence:
                    ok = True
                    if section or nsfw in ('0', '1'):
                        tmp = cur.execute("SELECT section_id, nsfw FROM keywords WHERE id = ?", (r['id'],)).fetchone()
                        if tmp:
                            if section and tmp['section_id'] != section: ok = False
                            if nsfw == '0' and tmp['nsfw'] != 0: ok = False
                            if nsfw == '1' and tmp['nsfw'] != 1: ok = False
                    if ok:
                        cur.execute("INSERT OR IGNORE INTO filter_cache (filter_id, keyword_id) VALUES (?, ?)", (filter_id, r['id']))
        except Exception:
            pass
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
    cur.execute("SELECT name, config FROM saved_filters WHERE id = ?", (filter_id,))
    info = cur.fetchone()
    conn.close()
    return jsonify({
        'name': info['name'] if info else '',
        'total': len(keywords),
        'keywords': keywords,
        'config': json.loads(info['config']) if info and isinstance(info['config'], str) else (info['config'] if info else {})
    })


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
            cur.execute("SELECT keyword_id FROM filter_cache WHERE filter_id = ? ORDER BY RANDOM() LIMIT 1", (elem['id'],))
            row = cur.fetchone()
            if row:
                kid = row['keyword_id']

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
    return jsonify({'prompt': prompt, 'count': len(keywords), 'elements': debug})


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
