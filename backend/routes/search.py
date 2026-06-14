"""Routes search for FR.IA backend."""

from context import *


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
    subsection = request.args.get('subsection', '').strip()
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
    if subsection:
        conditions.append("k.subsection_id = ?")
        params.append(subsection)

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


