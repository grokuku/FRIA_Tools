"""Routes templates for FR.IA backend."""

from context import *


# ── Prompt Templates ────────────────────────────────────────────────

@app.route('/api/prompts/templates', methods=['GET', 'POST'])
def prompt_templates():
    """Lister / Créer un template personnalisé."""
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()

    if request.method == 'GET':
        pt = request.args.get('prompt_type')
        fmt = request.args.get('output_format')
        query = "SELECT * FROM prompt_templates WHERE (user_id IS NULL OR user_id = ?)"
        params = [user_id]
        if pt:
            query += " AND prompt_type = ?"
            params.append(pt)
        if fmt:
            query += " AND output_format = ?"
            params.append(fmt)
        query += " ORDER BY is_default DESC, user_id NULLS FIRST"
        rows = conn.execute(query, params).fetchall()
        conn.close()
        result = []
        for r in rows:
            d = dict(r)
            d['examples'] = json.loads(d.get('examples', '[]')) if isinstance(d.get('examples'), str) else d.get('examples', [])
            d['editable'] = (d['user_id'] == user_id)
            result.append(d)
        return jsonify(result)

    data = request.get_json()
    if not data or not data.get('prompt_type'):
        conn.close()
        return jsonify({'error': 'prompt_type requis'}), 400
    pt = data['prompt_type'].strip()
    fmt = data.get('output_format', 'text').strip()
    system_prompt = data.get('system_prompt', '').strip()
    examples = json.dumps(data.get('examples', []))
    conn.execute("""
        INSERT INTO prompt_templates (user_id, prompt_type, output_format, system_prompt, examples, is_default)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(user_id, prompt_type, output_format)
        DO UPDATE SET system_prompt = excluded.system_prompt,
                      examples = excluded.examples,
                      updated_at = CURRENT_TIMESTAMP
    """, (user_id, pt, fmt, system_prompt, examples))
    conn.commit()
    template_id = conn.execute("SELECT id FROM prompt_templates WHERE user_id = ? AND prompt_type = ? AND output_format = ?",
                                (user_id, pt, fmt)).fetchone()
    conn.close()
    return jsonify({'id': template_id['id'] if template_id else None}), 201


@app.route('/api/prompts/templates/<int:template_id>', methods=['PUT', 'DELETE'])
def single_template(template_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    row = conn.execute("SELECT * FROM prompt_templates WHERE id = ?", (template_id,)).fetchone()
    if not row or row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    if request.method == 'PUT':
        data = request.get_json()
        system_prompt = data.get('system_prompt', row['system_prompt'])
        ex = data.get('examples')
        examples = json.dumps(ex) if ex is not None else row['examples']
        conn.execute("""
            UPDATE prompt_templates SET system_prompt = ?, examples = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (system_prompt, examples, template_id))
        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    conn.execute("DELETE FROM prompt_templates WHERE id = ?", (template_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/prompts/templates/defaults', methods=['GET'])
def get_default_templates():
    guard = _login_required()
    if guard: return guard
    conn = get_db()
    rows = conn.execute("SELECT * FROM prompt_templates WHERE is_default = 1 ORDER BY prompt_type, output_format").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d['examples'] = json.loads(d.get('examples', '[]')) if isinstance(d.get('examples'), str) else d.get('examples', [])
        d['editable'] = False
        result.append(d)
    return jsonify(result)


