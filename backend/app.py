import sqlite3
import io
import json
import random
import time
import secrets
from datetime import datetime, timedelta
from threading import Thread

from flask import request, jsonify, send_file, send_from_directory, session, redirect, render_template_string, g, Response

from extensions import app, oauth, DB_PATH, MD_PATH, BASE_DIR

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
            set_config(ollama_url=cfg.get('ollama_url'), ollama_model=cfg.get('ollama_model'))
    except Exception as e:
        logging.warning(f"Failed to load Ollama config from DB: {e}")

# Import route modules
from routes.helpers import *
from routes.auth import *
from routes.admin import *
from routes.search import *
from routes.keywords import *
from routes.import_export import *
from routes.filters import *
from routes.presets import *
from routes.styles import *
from routes.templates import *
from routes.enhance import *
from routes.generate import *
from routes.export import *
from routes.ideogram import *
from routes.blobby import *

# Initialisation unique de la BDD (schemas + migrations) au demarrage
from routes.helpers import _init_db
_init_db()

# Chargement de la config Ollama stockée en BDD (doit arriver APRES _init_db)
_load_ollama_config_at_startup()

# ── Fichiers statiques ────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR / 'frontend'), 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(str(BASE_DIR / 'frontend'), path)


if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5000, debug=debug)
