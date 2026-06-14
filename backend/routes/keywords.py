"""Routes keywords for FR.IA backend."""

from context import *


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
    subsection = request.args.get('subsection', '').strip()
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
    if subsection:
        conditions.append("k.subsection_id = ?")
        params.append(subsection)

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


@app.route('/api/subsections', methods=['GET'])
def list_subsections():
    guard = _login_required()
    if guard:
        return guard

    section_id = request.args.get('section', '').strip()
    conn = get_db()
    cur = conn.cursor()
    if section_id:
        cur.execute("""
            SELECT subsection_id, subsection_title, COUNT(*) as total
            FROM keywords
            WHERE section_id = ?
            GROUP BY subsection_id
            ORDER BY subsection_id
        """, (section_id,))
    else:
        cur.execute("""
            SELECT subsection_id, subsection_title, COUNT(*) as total
            FROM keywords
            GROUP BY subsection_id
            ORDER BY subsection_id
        """)
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


