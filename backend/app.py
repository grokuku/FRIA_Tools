import os
import sqlite3
import io
import json
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify, send_file, send_from_directory, session, redirect, render_template_string
from flask_cors import CORS

from parser import parse_markdown
from exporter import export_to_markdown
from embeddings import generate_embedding, cosine_similarity, is_available
from auth import init_oauth, make_discord_session, check_guild_access, get_guild_member, get_user_info, avatar_url, get_logged_user

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / 'keywords.db'
MD_PATH = BASE_DIR / 'Keywords-Complete.md'

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24).hex())
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

oauth = init_oauth(app)

# Chargement du token HF stocké en BDD (si présent)
def _load_hf_token_at_startup():
    try:
        from embeddings import set_token
        conn = sqlite3.connect(str(DB_PATH))
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_settings WHERE key = 'hf_token'")
        row = cur.fetchone()
        conn.close()
        if row:
            set_token(row[0])
    except Exception:
        pass  # La BDD peut ne pas encore exister

_load_hf_token_at_startup()

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


def _get_stored_hf_token() -> str | None:
    """Lit le token HF depuis la BDD (app_settings) ou l'env var."""
    env_token = os.environ.get("HF_TOKEN")
    if env_token:
        return env_token
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_settings WHERE key = 'hf_token'")
        row = cur.fetchone()
        conn.close()
        return row['value'] if row else None
    except Exception as e:
        print(f"[_get_stored_hf_token] Erreur: {e}")
        return None


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

    # Surcharge du token HF stocké en BDD si présent
    stored_token = _get_stored_hf_token()
    if stored_token:
        from embeddings import set_token
        set_token(stored_token)

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


@app.route('/api/admin/settings/hf-token', methods=['GET', 'POST'])
def admin_hf_token():
    """Lire / définir le token HF (admin seulement)."""
    try:
        guard = _admin_required()
        if guard:
            return guard
        if request.method == 'POST':
            data = request.get_json()
            token = data.get('token', '').strip()
            if not token:
                return jsonify({'error': 'Token requis'}), 400
            conn = get_db()
            conn.execute("INSERT INTO app_settings (key, value) VALUES ('hf_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (token,))
            conn.commit()
            conn.close()
            from embeddings import set_token
            set_token(token)
            return jsonify({'status': 'ok'})
        stored = _get_stored_hf_token()
        masked = stored[:8] + '*' * (len(stored) - 8) if stored else None
        return jsonify({'token': masked, 'has_token': stored is not None})
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
    Recherche sémantique via embeddings Hugging Face.
    """
    # Auth required
    guard = _login_required()
    if guard:
        return guard

    q = request.args.get('q', '').strip()
    limit = int(request.args.get('limit', 50))
    user_id = _get_current_user_id()

    if not q:
        return jsonify([])

    if not is_available():
        return jsonify({'error': 'Token HF non configuré. Définissez HF_TOKEN.'}), 400

    query_vec = generate_embedding(q)

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT k.id, k.keyword, k.description, k.section_id, k.section_title,
               k.subsection_id, k.subsection_title, k.nsfw, ke.embedding
        FROM keywords k
        JOIN keyword_embeddings ke ON ke.keyword_id = k.id
        WHERE k.user_id = ?
    """, (user_id,))
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return jsonify([])

    results = []
    for row in rows:
        vec = json.loads(row['embedding'])
        similarity = cosine_similarity(query_vec, vec)
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

    conditions = ["k.user_id = ?"]
    params = [user_id]

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
        WHERE k.user_id = ?
        GROUP BY k.section_id
        ORDER BY k.section_id
    """, (user_id,))
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
        WHERE k.user_id = ?
    """, (user_id,))
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

        cur.execute("DELETE FROM keyword_embeddings WHERE keyword_id IN (SELECT id FROM keywords WHERE user_id = ?)", (user_id,))
        cur.execute("DELETE FROM keywords WHERE user_id = ?", (user_id,))

        cur.executemany("""
            INSERT INTO keywords
            (keyword, description, section_id, section_title, subsection_id, subsection_title, nsfw, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            (e['keyword'], e['description'], e['section_id'], e['section_title'],
             e['subsection_id'], e['subsection_title'], int(e['nsfw']), user_id)
            for e in entries
        ])
        conn.commit()

        _generate_all_embeddings(conn)
        conn.close()

        return jsonify({'imported': len(entries)})
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
        return jsonify({'error': 'Token HF non configuré. Définissez HF_TOKEN.'}), 400
    try:
        conn = get_db()
        _generate_all_embeddings(conn)
        conn.close()
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(str(BASE_DIR / 'frontend'), path)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
