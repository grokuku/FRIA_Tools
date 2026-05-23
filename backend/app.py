import os
import sqlite3
import io
from pathlib import Path

from flask import Flask, request, jsonify, send_file, send_from_directory, Response
from flask_cors import CORS

from parser import parse_markdown
from exporter import export_to_markdown

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / 'keywords.db'
MD_PATH = BASE_DIR / 'Keywords-Complete.md'

app = Flask(__name__)
CORS(app)

# ── helpers ──────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    if not DB_PATH.exists():
        conn = sqlite3.connect(str(DB_PATH))
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
        conn.commit()
        conn.close()

# Init à l'import
init_db()

# ── API ───────────────────────────────────────────────────────────────

@app.route('/api/keywords', methods=['GET'])
def list_keywords():
    """
    Query params:
      q        -> recherche texte sur keyword + description
      section  -> filtre section_id exact
      nsfw     -> 0|1 filtre NSFW (si absente, tous)
    """
    conn = get_db()
    cur = conn.cursor()

    q = request.args.get('q', '').strip().lower()
    section = request.args.get('section', '').strip()
    nsfw_raw = request.args.get('nsfw', '').strip()

    conditions = ["1=1"]
    params = []

    if q:
        conditions.append("(LOWER(keyword) LIKE ? OR LOWER(description) LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])

    if section:
        conditions.append("section_id = ?")
        params.append(section)

    if nsfw_raw in ('0', '1'):
        conditions.append("nsfw = ?")
        params.append(int(nsfw_raw))

    sql = f"""
        SELECT id, keyword, description, section_id, section_title,
               subsection_id, subsection_title, nsfw
        FROM keywords
        WHERE {' AND '.join(conditions)}
        ORDER BY section_id, subsection_id, keyword
    """
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.route('/api/sections', methods=['GET'])
def list_sections():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT section_id, section_title,
               COUNT(*) as total,
               SUM(nsfw) as nsfw_count
        FROM keywords
        GROUP BY section_id
        ORDER BY section_id
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.route('/api/stats', methods=['GET'])
def stats():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*) as total,
               SUM(nsfw) as nsfw_total,
               COUNT(DISTINCT section_id) as section_count,
               COUNT(DISTINCT subsection_id) as subsection_count
        FROM keywords
    """)
    row = dict(cur.fetchone())
    conn.close()
    return jsonify(row)


@app.route('/api/import', methods=['POST'])
def import_md():
    """Reçoit un fichier .md ou lit le fichier local, parse, vide et remplit la BDD."""
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
    cur.execute("DELETE FROM keywords")
    cur.execute("DELETE FROM sqlite_sequence WHERE name='keywords'")  # reset AUTOINCREMENT
    cur.executemany("""
        INSERT INTO keywords
        (keyword, description, section_id, section_title, subsection_id, subsection_title, nsfw)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, [
        (e['keyword'], e['description'], e['section_id'], e['section_title'],
         e['subsection_id'], e['subsection_title'], int(e['nsfw']))
        for e in entries
    ])
    conn.commit()
    conn.close()

    if delete_after and tmp.exists():
        tmp.unlink()

    return jsonify({'imported': len(entries)})


@app.route('/api/export', methods=['GET'])
def export_md():
    """Génère le markdown depuis la BDD et le renvoie en téléchargement."""
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
