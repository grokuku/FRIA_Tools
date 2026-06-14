"""Shared imports and globals for FR.IA backend route modules."""

import os
import sqlite3
import io
import json
import random
import time
import secrets
from datetime import datetime, timedelta
from threading import Thread

from flask import request, jsonify, send_file, send_from_directory, session, redirect, render_template_string, g, Response
from cryptography.fernet import Fernet

from extensions import app, oauth, DB_PATH, MD_PATH, BASE_DIR
from parser import parse_markdown
from exporter import export_to_markdown
from embeddings import generate_embedding, cosine_similarity, is_available, set_config
from auth import make_discord_session, check_guild_access, get_guild_member, get_user_info, avatar_url, get_logged_user
