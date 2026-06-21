"""Flask app instance and shared constants for FR.IA backend."""

import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from flask import Flask
from flask_cors import CORS

from auth import init_oauth

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / 'keywords.db'
MD_PATH = BASE_DIR / 'Keywords-Complete.md'

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24).hex())
CORS(app, resources={r"/api/*": {"origins": "*"}})

oauth = init_oauth(app)
