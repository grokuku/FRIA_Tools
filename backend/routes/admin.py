"""Routes admin for FR.IA backend."""

from context import *


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
    """Liste tous les utilisateurs avec leurs stats (accessible aux membres connectés)."""
    try:
        guard = _login_required()
        if guard:
            return guard
        conn = get_db()
        cur = conn.cursor()
        # Infos de base + avatar
        cur.execute('SELECT id, username, display_name, avatar, role FROM users ORDER BY role, username')
        users = [dict(r) for r in cur.fetchall()]
        # Stats par utilisateur
        for u in users:
            uid = u['id']
            # Nombre de filtres sauvegardés
            cur.execute('SELECT COUNT(*) FROM saved_filters WHERE user_id = ?', (uid,))
            u['filter_count'] = cur.fetchone()[0]
            # Nombre de prompts générés
            cur.execute('SELECT COUNT(*) FROM generated_prompts WHERE user_id = ?', (uid,))
            u['prompt_count'] = cur.fetchone()[0]
            # Avatar URL
            if u.get('avatar') and u.get('id'):
                u['avatar_url'] = f"https://cdn.discordapp.com/avatars/{u['id']}/{u['avatar']}.png?size=64"
            else:
                u['avatar_url'] = ''
        conn.close()
        return jsonify(users)
    except Exception as e:
        return jsonify({'error': f'Erreur serveur: {e}'}), 500


@app.route('/api/members/<user_id>', methods=['GET'])
def member_detail(user_id):
    """Détails d'un membre : stats + historique des prompts."""
    guard = _login_required()
    if guard: return guard
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute('SELECT id, username, display_name, avatar, role FROM users WHERE id = ?', (user_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Membre introuvable'}), 404
        user = dict(row)
        if user.get('avatar') and user.get('id'):
            user['avatar_url'] = f"https://cdn.discordapp.com/avatars/{user['id']}/{user['avatar']}.png?size=256"
        else:
            user['avatar_url'] = ''
        cur.execute('SELECT COUNT(*) FROM saved_filters WHERE user_id = ?', (user_id,))
        user['filter_count'] = cur.fetchone()[0]
        cur.execute('SELECT COUNT(*) FROM generated_prompts WHERE user_id = ?', (user_id,))
        user['prompt_count'] = cur.fetchone()[0]
        cur.execute("""SELECT t.name, COUNT(*) as cnt FROM generated_prompts gp JOIN prompt_templates t ON t.id = gp.template_id WHERE gp.user_id = ? AND gp.template_id IS NOT NULL GROUP BY gp.template_id ORDER BY cnt DESC LIMIT 1""", (user_id,))
        pt = cur.fetchone()
        user['favorite_type'] = pt['name'] if pt else None
        cur.execute("""SELECT s.name, COUNT(*) as cnt FROM generated_prompts gp JOIN styles s ON s.id = gp.style_id WHERE gp.user_id = ? AND gp.style_id IS NOT NULL GROUP BY gp.style_id ORDER BY cnt DESC LIMIT 1""", (user_id,))
        st = cur.fetchone()
        user['favorite_style'] = st['name'] if st else None
        cur.execute("""SELECT t.name as template_name, gp.output_text, gp.style_id, gp.created_at FROM generated_prompts gp LEFT JOIN prompt_templates t ON t.id = gp.template_id WHERE gp.user_id = ? ORDER BY gp.created_at DESC LIMIT 15""", (user_id,))
        user['recent_prompts'] = [dict(r) for r in cur.fetchall()]
        conn.close()
        return jsonify(user)
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500


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

