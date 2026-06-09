import os
import sqlite3
import io
import json
import random
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify, send_file, send_from_directory, session, redirect, render_template_string, g
from flask_cors import CORS

from parser import parse_markdown
from exporter import export_to_markdown
from embeddings import generate_embedding, cosine_similarity, is_available, set_config
from auth import init_oauth, make_discord_session, check_guild_access, get_guild_member, get_user_info, avatar_url, get_logged_user

BASE_DIR = Path(__file__).resolve().parent.parent
from cryptography.fernet import Fernet

DB_PATH = BASE_DIR / 'keywords.db'
MD_PATH = BASE_DIR / 'Keywords-Complete.md'

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24).hex())
CORS(app, resources={r"/api/*": {"origins": "*"}})

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

# ── encryption ───────────────────────────────────────────────────────

def _row_get(row, key, default=None):
    """Safe .get() for sqlite3.Row objects (they don't support .get())."""
    try:
        val = row[key]
        return val if val is not None else default
    except (KeyError, IndexError):
        return default


# Format de sortie par défaut selon le type de prompt.
# Le frontend ne demande plus le format : il est determiné par le type.
# L'editeur de templates peut surcharger en creant un template avec un
# format different (text/markdown/json) pour un (prompt_type, output_format) donné.
# Exemple: 'z-image' -> 'json' quand on aura des modeles JSON-only.
_DEFAULT_FORMAT_BY_TYPE = {
    'sdxl':  'text',
    'sd15':  'text',
    'flux':  'text',
    'anima': 'text',
    'qwen':  'text',
    'liste': 'text',
    'ideogram4': 'json',  # structured JSON caption
}

def _default_format_for_type(prompt_type):
    return _DEFAULT_FORMAT_BY_TYPE.get(prompt_type, 'text')


def _get_encryption_key():
    """Recupere ou genere la cle de chiffrement."""
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.execute("SELECT value FROM app_settings WHERE key = 'encryption_key'")
    row = cur.fetchone()
    conn.close()
    key = row[0] if row else None
    if not key:
        key = Fernet.generate_key().decode()
        conn = sqlite3.connect(str(DB_PATH))
        conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ('encryption_key', key))
        conn.commit()
        conn.close()
    return Fernet(key.encode())

def encrypt_api_key(plain):
    if not plain: return ''
    return _get_encryption_key().encrypt(plain.encode()).decode()

def decrypt_api_key(encrypted):
    if not encrypted: return ''
    return _get_encryption_key().decrypt(encrypted.encode()).decode()

# ──────────────────────────────────────────────────────────────────────

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

    # === Nouvelles tables (Phase 1 — Prompt Generator/Enhancer) ===
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ai_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            name TEXT NOT NULL,
            engine TEXT DEFAULT 'openai',
            base_url TEXT NOT NULL DEFAULT '',
            api_key_encrypted TEXT DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            is_global INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS styles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            style_text TEXT NOT NULL DEFAULT '',
            negative_prompt TEXT DEFAULT '',
            is_public INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prompt_examples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL DEFAULT 'sdxl',
            prompt_text TEXT NOT NULL,
            author_id TEXT NOT NULL,
            rating INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (author_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prompt_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_example_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            vote INTEGER NOT NULL CHECK(vote IN (-1, 1)),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (prompt_example_id) REFERENCES prompt_examples(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS generated_prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            preset_id INTEGER,
            prompt_type TEXT DEFAULT 'sdxl',
            input_text TEXT NOT NULL DEFAULT '',
            output_text TEXT NOT NULL DEFAULT '',
            negative_prompt TEXT DEFAULT '',
            style_id INTEGER,
            model_used TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (preset_id) REFERENCES ai_presets(id),
            FOREIGN KEY (style_id) REFERENCES styles(id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS prompt_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            prompt_type TEXT NOT NULL,
            output_format TEXT NOT NULL DEFAULT 'text',
            system_prompt TEXT NOT NULL DEFAULT '',
            examples TEXT NOT NULL DEFAULT '[]',
            is_default INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, prompt_type, output_format)
        )
    """)

    # Migrations : ajout de colonnes si absentes
    cols_kw = [r[1] for r in conn.execute("PRAGMA table_info(keywords)").fetchall()]
    if "user_id" not in cols_kw:
        conn.execute("ALTER TABLE keywords ADD COLUMN user_id TEXT REFERENCES users(id)")

    cols_users = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    for col, default in [("role", "'user'"), ("settings", "'{}'"), ("guild_nickname", "NULL"), ("api_token", "NULL")]:
        if col not in cols_users:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT DEFAULT {default}")

    cols_presets = [r[1] for r in conn.execute("PRAGMA table_info(ai_presets)").fetchall()]
    if "is_client_side" not in cols_presets:
        conn.execute("ALTER TABLE ai_presets ADD COLUMN is_client_side INTEGER DEFAULT 0")

    cols_styles = [r[1] for r in conn.execute("PRAGMA table_info(styles)").fetchall()]
    if "negative_prompt" not in cols_styles:
        conn.execute("ALTER TABLE styles ADD COLUMN negative_prompt TEXT DEFAULT ''")

    # Migration : filter_type pour les filtres composés (union)
    cols_filters = [r[1] for r in conn.execute("PRAGMA table_info(saved_filters)").fetchall()]
    if "filter_type" not in cols_filters:
        conn.execute("ALTER TABLE saved_filters ADD COLUMN filter_type TEXT DEFAULT 'simple'")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS filter_unions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            union_filter_id INTEGER NOT NULL,
            member_filter_id INTEGER NOT NULL,
            FOREIGN KEY (union_filter_id) REFERENCES saved_filters(id) ON DELETE CASCADE,
            FOREIGN KEY (member_filter_id) REFERENCES saved_filters(id) ON DELETE CASCADE,
            UNIQUE(union_filter_id, member_filter_id)
        )
    """)

    # Créer les templates par défaut si aucun n'existe
    existing = conn.execute("SELECT COUNT(*) FROM prompt_templates WHERE is_default = 1").fetchone()[0]
    if existing == 0:
        _insert_default_templates(conn)
    conn.commit()
    conn.close()

    # Migration : mise à jour des templates vers l'anglais (connexion séparée)
    _migrate_templates_to_english()


def _migrate_templates_to_english():
    """Migrate default templates from French to English if needed."""
    try:
        mconn = sqlite3.connect(str(DB_PATH))
        mconn.execute("PRAGMA foreign_keys = ON")
        cur = mconn.cursor()
        existing = cur.execute("SELECT COUNT(*) FROM prompt_templates WHERE is_default = 1").fetchone()[0]
        if existing > 0:
            tmpl_version = cur.execute("SELECT value FROM app_settings WHERE key = 'templates_version'").fetchone()
            if not tmpl_version or tmpl_version[0] < '9':
                cur.execute("DELETE FROM prompt_templates WHERE is_default = 1")
                _insert_default_templates(mconn)
                cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('templates_version', '9')")
                mconn.commit()
        mconn.close()
    except Exception as e:
        print(f"[migration] Erreur templates anglais: {e}")


def _insert_default_templates(conn):
    """Insert default system templates for each prompt type × format combination."""
    import json

    # ---- Per-type docs ----
    DOC_SD15 = """For Stable Diffusion 1.5, use Danbooru-style tags separated by commas.
Recommended structure (in order of importance):
1. Quality: masterpiece, best quality, ultra-detailed, high resolution
2. Subject: 1girl, 1boy, person, character_name
3. Appearance: long hair, blue eyes, casual clothes
4. Action/pose: standing, sitting, looking at viewer, walking
5. Environment: city street, forest, bedroom, outdoor
6. Lighting: cinematic lighting, soft light, moody lighting
7. Style: photorealistic, anime, sketch, oil painting
8. Technical: sharp focus, depth of field, bokeh

Use parentheses for weighting: (important:1.2) for +20% emphasis.
Use brackets to reduce: [less important:0.8].
Avoid full sentences, prefer short tokens."""

    DOC_SDXL = """For SDXL, use a mix of natural language and concise tags.
Structure:
1. Subject: natural description
2. Appearance: attire, expression (3-4 details max)
3. Environment: setting (1-2 elements)
4. Atmosphere: lighting, mood (1-2 elements)
5. Quality: 1-2 qualifiers max (masterpiece, photorealistic)

IMPORTANT:
- Limit to 20-25 tags or 2-3 sentences max
- Never repeat the same concept
- No artist names, no "trending on...", no "artstation"
- Prioritize quality over quantity"""

    DOC_FLUX = """For Flux (Black Forest Labs), use natural language descriptions.
Structure: Subject + Action + Style + Context
1. Subject: the main focus (person, object, character)
2. Action: what the subject is doing or their pose
3. Style: artistic approach, medium, aesthetic
4. Context: setting, lighting, time of day, mood

IMPORTANT: Flux does NOT use Danbooru tags or weights (parentheses).
Write natural, descriptive sentences.
No negative prompt - Flux does not support it.

Example: "A young woman with red hair standing in a sunlit garden, soft focus, cinematic lighting, professional photography"""

    DOC_ANIMA = """For Anime/Manga models, use Danbooru tags with specific suffixes.
Recommended structure:
1. Character: 1girl, 1boy, 2girls, etc.
2. Composition: solo, multiple views, group
3. Pose: standing, sitting, from behind, crouching
4. Expression: smile, blush, angry, serious
5. Appearance: long hair, twintails, red eyes, school uniform
6. Background: detailed background, simple background, gradient
7. Style: anime, flat color, lineart, cel shading, pixel art
8. Quality: masterpiece, best quality, highres

Use suffixes like (lineart), (flat color:1.2), (sketch).
Brackets [ ] also work to reduce emphasis."""

    DOC_QWEN = """For Qwen-Image (Alibaba, 20B MMDiT), use structured natural language descriptions.
Qwen-Image excels at:
- Multilingual text rendering (English, Chinese, Korean, Japanese...)
- Varied styles: photorealistic, painting, anime, minimalist design
- Complex scenes with characters, architecture, nature
- Precise image editing

Recommended format:
1. Subject: natural description (who, what, appearance)
2. Action/pose: what the subject is doing
3. Environment: setting, decor, background
4. Atmosphere: lighting, mood, time of day
5. Style: artistic approach, medium, quality

IMPORTANT:
- Use natural, descriptive sentences (like Flux)
- No Danbooru tags or weight parentheses
- Specify text rendering if needed (e.g. "a sign that reads '...'")
- Structure from general to specific
- Limit to 2-3 sentences or 30 elements max"""

    DOC_LISTE = """Format: structured list organized by categories.
Organize the prompt into relevant categories describing the image:

subject:
- [description of main subject, age, origin]

clothing:
- [description of clothing and accessories]

style:
- [artistic style, technique]

environment:
- [setting, decor, ambiance]

expression:
- [expression, pose, mood]

lighting:
- [lighting type, luminous atmosphere]

colors:
- [dominant palette, hues]

Every category should be relevant to the image being described.
Adapt categories based on content (e.g. architecture, nature, portrait...).
Tags should be concise but descriptive."""

    DOC_IDEOGRAM4 = """Ideogram 4 uses STRUCTURED JSON CAPTIONS. Output ONLY pure JSON, no code fences, no commentary.

## JSON Schema
{"high_level_description":"1-2 sentence summary","style_description":{"aesthetics":"2-4 keywords","lighting":"specific","photo" OR "art_style":"details","medium":"photograph/illustration/etc","color_palette":["#RRGGBB"]},"compositional_deconstruction":{"background":"scene backdrop","elements":[{"type":"obj","bbox":[y_min,x_min,y_max,x_max],"desc":"..."}]}}

Key order: high_level_description, style_description, compositional_deconstruction.
Use EITHER "photo" OR "art_style", never both.
In style_description: photo path = aesthetics, lighting, photo, medium, color_palette. Non-photo = aesthetics, lighting, medium, art_style, color_palette.
Required: aesthetics, lighting, medium. color_palette is optional.

doc_bboxes_rule (IMPORTANT): bbox format: [y_min, x_min, y_max, x_max] in PIXEL COORDINATES matching the IMAGE DIMENSIONS. Origin top-left. A bbox SURROUNDS the subject tightly. For a standing person: y_span > x_span (tall narrow). For a lying/diving person: x_span > y_span (wide short). NEVER make a standing person's bbox wider than it is tall. EVERY element MUST have a bbox. Elements MUST NOT overlap (unless physically together like holding hands). Main subject = largest bbox, centered.

color_palette: array of UPPERCASE #RRGGBB strings. Up to 16 in style, up to 5 per element.
Element type: "obj" for subjects/objects, "text" for literal text rendered in image.
background is REQUIRED in compositional_deconstruction.

## Mapping user input to JSON
- General description -> high_level_description + style_description + background
- Each numbered element -> one entry in elements (type "obj", bbox from scene)
- IMAGE DIMENSIONS -> determines element layout: landscape = spread horizontally, portrait = stack vertically
- STYLE block -> preserved verbatim in style_description

## Tips
- medium: photograph, illustration, 3d_render, painting, anime...
- aesthetics: 2-4 keywords
- lighting: be specific (golden hour rim light, low-key deep shadows)
- photo: include camera details
- art_style: describe the look

## Example (barista scene, 3 elements, 1024x1024 image, bboxes in pixel coords)
Input: A medium-shot photograph of a barista pouring latte art in a cozy cafe. Elements: 1. A young barista with curly hair. 2. A porcelain cup with latte art. 3. An espresso machine. IMAGE DIMENSIONS: 1024x1024.
Output:
{"high_level_description":"A medium-shot photograph of a barista carefully pouring latte art in a warm, cozy cafe.","style_description":{"aesthetics":"warm, intimate, artisanal","lighting":"soft natural window light, gentle shadows","photo":"shallow depth of field, eye-level, 50mm lens","medium":"photograph","color_palette":["#F5E6D3","#6F4E37","#FFFFFF","#2C1810"]},"compositional_deconstruction":{"background":"A blurred cafe interior with warm wooden counters and hanging plants in soft focus.","elements":[{"type":"obj","bbox":[150,200,750,600],"desc":"A young barista with curly auburn hair, focused expression, wearing a cream apron."},{"type":"obj","bbox":[500,450,700,680],"desc":"A white porcelain cup with intricate rosetta latte art on a wooden saucer."},{"type":"obj","bbox":[100,650,450,1000],"desc":"A vintage brass espresso machine with steam rising, polished wood accents."}]}}
"""
    DOCS = {
        "sd15": DOC_SD15,
        "sdxl": DOC_SDXL,
        "flux": DOC_FLUX,
        "anima": DOC_ANIMA,
        "qwen": DOC_QWEN,
        "liste": DOC_LISTE,
        "ideogram4": DOC_IDEOGRAM4,
    }

    # ---- Output format rules ----
    FORMAT_RULES = {
        "text": "Output ONLY the final prompt, without quotes or code blocks. No explanations, no comments, no introductory sentences. Maximum 30 tags or 3 sentences. The prompt must be directly usable.",
        "markdown": "Output in plain Markdown. The prompt is the main content. Maximum 30 elements. No code blocks (```).",
        "json": "Output in pure JSON, WITHOUT a code block (no ```json). Format: {\"prompt\": \"...\", \"negative_prompt\": \"...\"}. Maximum 30 tags in the prompt.",
    }

    # ---- Common rules ----
    CONSIGNES = """
Mandatory rules:
- The assigned STYLE must be preserved exactly as-is
- In case of conflict, prioritize: base prompt > elements > random
- Remove duplicates
- Organize by importance (30 tags max)
- Add 2-3 qualifiers max (masterpiece, best quality)
- **DO NOT REPEAT** the same tags/concepts
- **OUTPUT ONLY the prompt**, nothing else: no explanations, no comments, no introductory sentences
- The prompt must be ready to use in an image generator"""

    # ---- Examples (short and targeted) ----
    EXAMPLES = {
        "sdxl": json.dumps([
            "A serene portrait of a young woman with auburn hair and freckles, golden hour sunlight, soft bokeh, cream linen dress, ethereal atmosphere, photorealistic",
            "Ancient ruined castle on a misty mountain peak, dramatic cloudy sky, rays of light, overgrown vines, cinematic composition, epic fantasy",
            "Steaming cup of coffee on rustic wooden table, morning light, shallow depth of field, steam particles, warm tones, product photography",
        ]),
        "sd15": json.dumps([
            "masterpiece, best quality, ultra-detailed, 1girl, solo, long blonde hair, blue eyes, white sundress, standing on beach, sunset, ocean waves, cinematic lighting, soft focus, photorealistic, sharp focus",
            "masterpiece, best quality, 1boy, short brown hair, glasses, casual clothes, sitting at desk, coffee shop, warm lighting, detailed background, bokeh, (photorealistic:1.2)",
            "masterpiece, high resolution, detailed, fantasy landscape, ruined castle, mountain peak, mist, dramatic sky, cinematic composition, (epic:1.3), intricate detail, sharp focus",
        ]),
        "flux": json.dumps([
            "A young woman with flowing red hair standing in a sunlit forest clearing, soft golden rays filtering through leaves, wearing a flowing white dress, ethereal atmosphere, professional photography, shallow depth of field",
            "A majestic medieval castle perched on a cliff edge at sunset, dramatic clouds with orange and purple hues, birds circling in the distance, cinematic wide shot, highly detailed, photorealistic",
            "A cozy library interior with floor-to-ceiling bookshelves, warm lamplight, an old leather armchair, dust particles dancing in the light, vintage atmosphere, ultra-detailed, architectural photography",
        ]),
        "anima": json.dumps([
            "masterpiece, best quality, 1girl, solo, long silver hair, purple eyes, serious expression, school uniform, standing, detailed background, sunset rooftop, cinematic lighting, anime style, highres",
            "masterpiece, 1boy, short black hair, katana, dynamic pose, action scene, glowing effects, detailed background, night city, (lineart:1.1), vibrant colors, anime shading",
            "best quality, 2girls, sitting, cafe, outdoor, daytime, smiling, casual clothes, detailed background, soft lighting, (cel shading:1.2), vibrant, highres",
        ]),
        "qwen": json.dumps([
            "A professional portrait of a young woman with freckles and auburn hair, wearing a cream linen shirt, standing in a sunlit garden with soft golden hour lighting, shallow depth of field, photorealistic style, 8k detail",
            "A magical forest scene with a wooden cottage nestled among giant glowing mushrooms, fireflies floating in the air, twilight atmosphere, a small sign reading 'Welcome Home' in elegant script, detailed foliage, fantasy illustration style",
            "A cinematic wide shot of a cyberpunk city street at night, neon signs in English and Japanese, rain-slicked pavement reflecting colorful lights, a lone figure with an umbrella walking, moody blue and pink lighting, ultra-realistic",
        ]),
        "liste": json.dumps([
            "subject:\n- woman, 28 years old, caucasian\n- long auburn hair\n- freckles\n\nclothing:\n- white flowing dress\n\nstyle:\n- photorealistic\n- masterpiece\n- 8k\n\nenvironment:\n- sunlit forest\n- rays of light\n\nlighting:\n- golden hour\n- soft bokeh\n\nexpression:\n- gentle gaze\n- slight smile",
            "subject:\n- man, 35 years old\n- short brown hair\n- glasses\n\nclothing:\n- gray suit\n- black tie\n\nstyle:\n- photorealistic\n- sharp focus\n\nenvironment:\n- modern office\n- floor-to-ceiling window\n\nlighting:\n- natural light\n- backlit\n\nexpression:\n- confident\n- looking at camera",
            "subject:\n- medieval castle\n- ancient ruins\n\nstyle:\n- epic fantasy\n- cinematic\n- highly detailed\n\nenvironment:\n- mountain peak\n- morning mist\n- dramatic clouds\n\ncolors:\n- warm tones\n- orange and purple\n\nmood:\n- mysterious\n- majestic",
        ]),
        "ideogram4": json.dumps([
            '{"high_level_description": "A medium-shot photograph of a barista carefully pouring latte art in a warm, cozy cafe.", "style_description": {"aesthetics": "warm, intimate, artisanal", "lighting": "soft natural window light, gentle shadows", "photo": "shallow depth of field, eye-level, 50mm lens", "medium": "photograph", "color_palette": ["#F5E6D3", "#6F4E37", "#FFFFFF", "#2C1810", "#D4A574"]}, "compositional_deconstruction": {"background": "A blurred cafe interior with warm wooden counters, hanging plants, and the suggestion of other patrons in soft focus.", "elements": [{"type": "obj", "bbox": [200, 250, 800, 700], "desc": "A young barista with curly auburn hair and a focused expression, wearing a cream apron over a dark shirt."}, {"type": "obj", "bbox": [550, 400, 750, 650], "desc": "A white porcelain cup with intricate rosetta latte art on a wooden saucer."}, {"type": "obj", "bbox": [100, 600, 500, 1000], "desc": "A vintage brass espresso machine with steam rising from its portafilter."}]}}',
            '{"high_level_description": "A lone sailboat on calm water at sunset.", "style_description": {"aesthetics": "serene, warm, golden hour", "lighting": "golden hour backlighting, warm atmospheric haze", "photo": "wide angle, f/8, long exposure", "medium": "photograph", "color_palette": ["#FF6B35", "#F7C59F", "#004E89", "#1A659E", "#2B2D42"]}, "compositional_deconstruction": {"background": "A calm ocean stretching to a low horizon, sky washed in orange and pink with thin wisps of cloud.", "elements": [{"type": "obj", "desc": "A single sailboat with a white triangular sail, silhouetted against the setting sun."}]}}',
            '{"high_level_description": "A clean, modern business card layout for a tech company.", "style_description": {"aesthetics": "minimal, professional, geometric", "lighting": "even, diffuse studio lighting", "medium": "graphic_design", "art_style": "flat vector design, generous whitespace, sans-serif typography", "color_palette": ["#FFFFFF", "#F0F0F0", "#333333", "#0066FF", "#00CC88"]}, "compositional_deconstruction": {"background": "A solid off-white card surface with subtle paper texture.", "elements": [{"type": "text", "text": "ACME TECH", "desc": "Bold dark grey sans-serif company name across the upper third of the card."}, {"type": "text", "text": "hello@acme.tech", "desc": "Small blue sans-serif contact email near the bottom of the card."}]}}',
        ]),
    }

    # ---- Insert templates ----
    for pt in ["sdxl", "sd15", "flux", "anima", "qwen", "liste", "ideogram4"]:
        doc = DOCS.get(pt, "")
        examples = EXAMPLES.get(pt, "[]")
        for fmt in ["text", "markdown", "json"]:
            # Ideogram 4 a son propre schema JSON defini dans DOC_IDEOGRAM4,
            # donc on n'ajoute pas de regle de format generique.
            if pt == "ideogram4":
                fmt_rule = "Follow the EXACT JSON schema described above. Output PURE JSON, NO code block, NO commentary, NO markdown."
            else:
                fmt_rule = FORMAT_RULES.get(fmt, FORMAT_RULES["text"])
            system_prompt = f"""You are an expert assistant for image prompt generation.
Your task: transform the provided content into an optimized {pt.upper()} prompt.

## Documentation: How to build a {pt.upper()} prompt
{doc}

## Output format
{fmt_rule}

## Examples
Here are examples of well-structured {pt.upper()} prompts:
"""
            examples_list = json.loads(examples)
            for ex in examples_list:
                system_prompt += f"\n- {ex}"
            system_prompt += CONSIGNES

            conn.execute("""
                INSERT INTO prompt_templates
                    (user_id, prompt_type, output_format, system_prompt, examples, is_default)
                VALUES (NULL, ?, ?, ?, ?, 1)
            """, (pt, fmt, system_prompt.strip(), examples))

    conn.commit()
    conn.close()


def _get_current_user_id() -> str | None:
    """Retourne l'ID de l'utilisateur connecté (session, token API, ou Flask g)."""
    # 1) Flask g (positionné par _login_required)
    gid = getattr(g, 'user_id', None)
    if gid:
        return gid
    # 2) Session (connexion Discord)
    user = session.get("user")
    if user:
        return user["id"]
    # 3) Bearer token (API)
    return _authenticate_via_token()


def _authenticate_via_token() -> str | None:
    """Vérifie si la requête contient un Bearer token valide.
    Retourne l'user_id ou None."""
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth[7:]
    try:
        conn = get_db()
        row = conn.execute("SELECT id FROM users WHERE api_token = ?", (token,)).fetchone()
        conn.close()
        return row['id'] if row else None
    except Exception:
        return None


def _login_required():
    """Retourne une erreur 401 si non connecté (session OU token API).
    Positionne aussi g.user_id pour que _get_current_user_id() le trouve."""
    user_id = _get_current_user_id()
    if not user_id:
        return jsonify({"error": "Connexion requise. Utilisez le bouton 'Connexion Discord' ou un token API."}), 401
    g.user_id = user_id
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
    """Génère et stocke les embeddings Ollama pour tous les mots-clés."""
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

    # Détermination du rôle + sauvegarde
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
    """Retourne l'utilisateur connecté ou 401. Fonctionne avec session ET Bearer token."""
    # Essayer d'abord la session
    user = get_logged_user()
    if user:
        return jsonify(user)
    # Essayer le Bearer token
    user_id = _authenticate_via_token()
    if user_id:
        try:
            conn = get_db()
            row = conn.execute(
                "SELECT id, username, display_name, avatar, role FROM users WHERE id = ?",
                (user_id,)
            ).fetchone()
            conn.close()
            if row:
                d = dict(row)
                # Construire l'URL de l'avatar Discord
                if d.get('avatar') and d.get('id'):
                    d['avatar_url'] = f"https://cdn.discordapp.com/avatars/{d['id']}/{d['avatar']}.png?size=64"
                else:
                    d['avatar_url'] = ''
                return jsonify(d)
        except Exception:
            pass
    return jsonify({"error": "Non connecté"}), 401


@app.route('/api/auth/logout')
def discord_logout():
    """Déconnecte l'utilisateur."""
    session.clear()
    return jsonify({"status": "ok"})


@app.route('/api/auth/token', methods=['GET', 'POST'])
def api_token():
    """Gérer la clé API de l'utilisateur connecté."""
    guard = _login_required()
    if guard:
        return guard
    user_id = _get_current_user_id()
    conn = get_db()

    if request.method == 'POST':
        # Régénérer le token
        import secrets
        new_token = 'fr_ia_' + secrets.token_hex(24)
        conn.execute("UPDATE users SET api_token = ? WHERE id = ?", (new_token, user_id))
        conn.commit()
        conn.close()
        return jsonify({'token': new_token})

    # GET : retourner le token existant (ou en créer un)
    cur = conn.execute("SELECT api_token FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    if row and row['api_token']:
        conn.close()
        return jsonify({'token': row['api_token']})

    # Pas de token → en créer un
    import secrets
    new_token = 'fr_ia_' + secrets.token_hex(24)
    conn.execute("UPDATE users SET api_token = ? WHERE id = ?", (new_token, user_id))
    conn.commit()
    conn.close()
    return jsonify({'token': new_token})


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
        cur.execute("""SELECT prompt_type, COUNT(*) as cnt FROM generated_prompts WHERE user_id = ? GROUP BY prompt_type ORDER BY cnt DESC LIMIT 1""", (user_id,))
        pt = cur.fetchone()
        user['favorite_type'] = pt['prompt_type'] if pt else None
        cur.execute("""SELECT s.name, COUNT(*) as cnt FROM generated_prompts gp JOIN styles s ON s.id = gp.style_id WHERE gp.user_id = ? AND gp.style_id IS NOT NULL GROUP BY gp.style_id ORDER BY cnt DESC LIMIT 1""", (user_id,))
        st = cur.fetchone()
        user['favorite_style'] = st['name'] if st else None
        cur.execute("""SELECT prompt_type, output_text, style_id, created_at FROM generated_prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT 15""", (user_id,))
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


@app.route('/api/import', methods=['POST'])
def import_md():
    try:
        guard = _login_required()
        if guard:
            return guard

        user_id = _get_current_user_id()

        if not is_available():
            return jsonify({'error': 'Serveur Ollama inaccessible. Vérifie la configuration dans Admin > Ollama.'}), 400

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

        filter_type = data.get('filter_type', 'simple')

        cur.execute(
            "INSERT INTO saved_filters (user_id, name, category, nsfw, is_public, config, filter_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, data['name'].strip(), data.get('category', '').strip(), int(data.get('nsfw', 0)), int(data.get('is_public', 0)), json.dumps(data.get('config', {})), filter_type)
        )
        filter_id = cur.lastrowid

        # Si c'est une union, enregistrer les membres dans filter_unions
        if filter_type == 'union':
            member_ids = data.get('union_member_ids', [])
            for mid in member_ids:
                cur.execute("INSERT OR IGNORE INTO filter_unions (union_filter_id, member_filter_id) VALUES (?, ?)", (filter_id, mid))

        conn.commit()
        config = data.get('config', {})
        if isinstance(config, dict):
            # Pour les unions, on ajoute les infos nécessaires à la config pour rebuild
            if filter_type == 'union':
                config['filter_type'] = 'union'
                config['union_member_ids'] = data.get('union_member_ids', [])
            _rebuild_filter_cache(cur, filter_id, config)
        conn.commit()
        conn.close()
        return jsonify({'id': filter_id, 'count': _count_filter_cache(filter_id)}), 201

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT f.id, f.user_id, f.name, f.category, f.nsfw, f.is_public, f.config,
               u.display_name, u.username
        FROM saved_filters f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.user_id = ? OR f.is_public = 1
        ORDER BY f.name
    """, (user_id,))
    rows = cur.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d['config'] = json.loads(d['config']) if isinstance(d['config'], str) else d['config']
        # Ajouter owner_name pour l'affichage dans l'UI
        d['owner_name'] = d.pop('display_name', None) or d.pop('username', None) or d['user_id']
        # Ajouter filter_type (avec défaut pour les anciens filtres)
        d['filter_type'] = d.get('filter_type', 'simple')
        # Si c'est une union, charger les membres
        if d['filter_type'] == 'union':
            cur2 = conn.cursor()
            cur2.execute("""
                SELECT fu.member_filter_id, sf.name
                FROM filter_unions fu
                JOIN saved_filters sf ON sf.id = fu.member_filter_id
                WHERE fu.union_filter_id = ?
            """, (d['id'],))
            d['union_members'] = [dict(m) for m in cur2.fetchall()]
        else:
            d['union_members'] = []
        result.append(d)
    conn.close()
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

    # Gérer les membres d'une union
    if 'union_member_ids' in data:
        cur.execute("DELETE FROM filter_unions WHERE union_filter_id = ?", (filter_id,))
        for mid in data['union_member_ids']:
            cur.execute("INSERT OR IGNORE INTO filter_unions (union_filter_id, member_filter_id) VALUES (?, ?)", (filter_id, mid))
        # Mettre à jour le filter_type selon la nouvelle config
        if data.get('filter_type') == 'union':
            cur.execute("UPDATE saved_filters SET filter_type = 'union', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (filter_id,))
        else:
            # L'utilisateur a retiré les membres → repasser en filtre simple
            cur.execute("UPDATE saved_filters SET filter_type = 'simple', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (filter_id,))

    config = data.get('config')
    if config and isinstance(config, dict):
        if data.get('filter_type') == 'union':
            config['filter_type'] = 'union'
            config['union_member_ids'] = data.get('union_member_ids', [])
        cur.execute("UPDATE saved_filters SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (json.dumps(config), filter_id))
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
    # Pour les unions, enrichir la config avec les membres actuels
    cur.execute("SELECT filter_type FROM saved_filters WHERE id = ?", (filter_id,))
    ft = cur.fetchone()
    filter_type = ft['filter_type'] if ft else 'simple'
    if filter_type == 'union':
        config['filter_type'] = 'union'
        cur.execute("SELECT member_filter_id FROM filter_unions WHERE union_filter_id = ?", (filter_id,))
        config['union_member_ids'] = [r['member_filter_id'] for r in cur.fetchall()]
    cur.execute("DELETE FROM filter_cache WHERE filter_id = ?", (filter_id,))
    _rebuild_filter_cache(cur, filter_id, config)
    conn.commit(); conn.close()
    return jsonify({'status': 'ok', 'count': _count_filter_cache(filter_id)})


def _rebuild_filter_cache(cur, filter_id, config):
    # Si c'est un filtre composé (union), merger les caches des membres
    filter_type = config.get('filter_type', 'simple')
    if filter_type == 'union':
        member_ids = config.get('union_member_ids', [])
        if member_ids:
            # Récupérer les keyword_ids de chaque membre et les unir (déduplication automatique par PRIMARY KEY)
            ph = ','.join('?' for _ in member_ids)
            cur.execute(f"""
                INSERT OR IGNORE INTO filter_cache (filter_id, keyword_id)
                SELECT ?, keyword_id FROM filter_cache
                WHERE filter_id IN ({ph})
            """, [filter_id] + member_ids)
        return

    # Filtre simple : construction de la requête
    conditions = ["1=1"]
    params = []
    section = config.get('section', '').strip()
    subsection = config.get('subsection', '').strip()
    search_text = config.get('search_text', '').strip()
    search_neg = config.get('search_neg', '').strip()
    semantic_text = config.get('semantic_text', '').strip()
    min_confidence = float(config.get('min_confidence', 0))
    nsfw = str(config.get('nsfw_filter', ''))
    hidden_ids = config.get('hidden_kw_ids', [])

    if section:
        conditions.append("k.section_id = ?")
        params.append(section)
    if subsection:
        conditions.append("k.subsection_id = ?")
        params.append(subsection)
    if nsfw == '0':
        conditions.append("k.nsfw = 0")
    elif nsfw == '1':
        conditions.append("k.nsfw = 1")
    if search_text and not semantic_text:
        like = f"%{search_text.lower()}%"
        conditions.append("(LOWER(k.keyword) LIKE ? OR LOWER(k.description) LIKE ? OR LOWER(k.section_title) LIKE ? OR LOWER(k.subsection_title) LIKE ?)")
        params.extend([like, like, like, like])
    if search_neg:
        like_neg = f"%{search_neg.lower()}%"
        conditions.append("(LOWER(k.keyword) NOT LIKE ? AND LOWER(k.description) NOT LIKE ? AND LOWER(k.section_title) NOT LIKE ? AND LOWER(k.subsection_title) NOT LIKE ?)")
        params.extend([like_neg, like_neg, like_neg, like_neg])
    if hidden_ids and isinstance(hidden_ids, list) and len(hidden_ids) > 0:
        ph = ','.join('?' for _ in hidden_ids)
        conditions.append(f"k.id NOT IN ({ph})")
        params.extend(hidden_ids)

    if semantic_text:
        try:
            from embeddings import generate_embedding, cosine_similarity
            qe = generate_embedding(semantic_text)
            # Pré-filtrer section/nsfw/subsection dans la requête SQL (hidden_ids appliqué APRES la limite)
            sem_conds = ["1=1"]
            sem_params = []
            if section:
                sem_conds.append("k.section_id = ?")
                sem_params.append(section)
            if subsection:
                sem_conds.append("k.subsection_id = ?")
                sem_params.append(subsection)
            if nsfw == '0':
                sem_conds.append("k.nsfw = 0")
            elif nsfw == '1':
                sem_conds.append("k.nsfw = 1")
            sem_where = " AND ".join(sem_conds)
            cur.execute(f"SELECT k.id, ke.embedding, k.keyword, k.description, k.section_title, k.subsection_title FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id WHERE {sem_where}", sem_params)
            # Calculer scores, filtrer, trier, limiter
            scored = []
            q_lower = search_text.lower() if search_text else ''
            neg_lower = search_neg.lower() if search_neg else ''
            for r in cur.fetchall():
                emb = json.loads(r['embedding'])
                sim = cosine_similarity(qe, emb)
                if sim < min_confidence:
                    continue
                # Appliquer texte (+) et exclusion (-) sur 4 champs (identique à loadKeywords)
                if q_lower or neg_lower:
                    fields = [
                        (r['keyword'] or '').lower(),
                        (r['description'] or '').lower(),
                        (r['section_title'] or '').lower(),
                        (r['subsection_title'] or '').lower()
                    ]
                    if q_lower and not any(q_lower in f for f in fields):
                        continue
                    if neg_lower and any(neg_lower in f for f in fields):
                        continue
                scored.append((r['id'], sim))
            scored.sort(key=lambda x: x[1], reverse=True)
            # Prendre le top 500 (même ensemble que l'API), puis filtrer les masqués (comme renderTable)
            top = scored[:500]
            hidden_set = set(hidden_ids) if hidden_ids and isinstance(hidden_ids, list) else set()
            for kid, _ in top:
                if kid not in hidden_set:
                    cur.execute("INSERT OR IGNORE INTO filter_cache (filter_id, keyword_id) VALUES (?, ?)", (filter_id, kid))
        except Exception as e:
            print(f"[_rebuild_filter_cache] Erreur branche semantique filtre {filter_id}: {e}")
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
    cur.execute("SELECT COUNT(*) FROM filter_cache WHERE filter_id = ?", (filter_id,))
    total = cur.fetchone()[0]
    cur.execute("SELECT name, config, filter_type FROM saved_filters WHERE id = ?", (filter_id,))
    info = cur.fetchone()
    result = {
        'name': info['name'] if info else '',
        'total': total,
        'keywords': keywords,
        'filter_type': info['filter_type'] if info else 'simple',
        'config': json.loads(info['config']) if info and isinstance(info['config'], str) else (info['config'] if info else {})
    }
    if info and info['filter_type'] == 'union':
        cur.execute("""
            SELECT fu.member_filter_id, sf.name
            FROM filter_unions fu
            JOIN saved_filters sf ON sf.id = fu.member_filter_id
            WHERE fu.union_filter_id = ?
        """, (filter_id,))
        result['union_members'] = [{'id': r['member_filter_id'], 'name': r['name']} for r in cur.fetchall()]
    conn.close()
    return jsonify(result)


# ═══════════════════════════════════════════════════════════════════
# Phase 1 : Presets IA + Styles + Enhance
# ═══════════════════════════════════════════════════════════════════

# ── Presets ─────────────────────────────────────────────────────────

@app.route('/api/presets', methods=['GET', 'POST'])
def presets():
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()

    if request.method == 'GET':
        try:
            rows = cur.execute("""
                SELECT p.*, u.username, u.display_name
                FROM ai_presets p
                LEFT JOIN users u ON u.id = p.user_id
                WHERE p.is_global = 1 OR p.user_id = ?
                ORDER BY p.is_global DESC, p.name
            """, (user_id,)).fetchall()
        except Exception as e:
            conn.close()
            return jsonify({'error': f'DB error: {e}'}), 500
        conn.close()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'user_id': r['user_id'],
                'name': r['name'],
                'engine': r['engine'],
                'base_url': r['base_url'],
                'model': r['model'],
                'is_global': bool(r['is_global']),
                'is_client_side': bool(_row_get(r, 'is_client_side', 0)),
                'owner_name': r['display_name'] or r['username'] or '',
                'created_at': r['created_at']
            })
        return jsonify(result)

    # POST : creation (admin pour global, tout le monde pour perso)
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    base_url = data.get('base_url', '').strip()
    api_key = data.get('api_key', '').strip()
    model = data.get('model', '').strip()
    is_global = int(data.get('is_global', 0))
    is_client_side = int(data.get('is_client_side', 0))

    if not name or not base_url:
        conn.close()
        return jsonify({'error': 'Nom et URL requis'}), 400

    if is_global:
        admin_guard = _admin_required()
        if admin_guard:
            conn.close()
            return admin_guard

    enc = encrypt_api_key(api_key)
    cur.execute(
        "INSERT INTO ai_presets (user_id, name, engine, base_url, api_key_encrypted, model, is_global, is_client_side) VALUES (?, ?, 'openai', ?, ?, ?, ?, ?)",
        (user_id if not is_global else None, name, base_url, enc, model, is_global, is_client_side)
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return jsonify({'id': pid, 'name': name}), 201


@app.route('/api/presets/<int:preset_id>', methods=['PUT', 'DELETE'])
def single_preset(preset_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    # Verifier propriete : global = admin only, perso = owner or admin
    if row['is_global']:
        admin_guard = _admin_required()
        if admin_guard:
            conn.close()
            return admin_guard
    elif row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    if request.method == 'DELETE':
        cur.execute("UPDATE generated_prompts SET preset_id = NULL WHERE preset_id = ?", (preset_id,))
        cur.execute("DELETE FROM ai_presets WHERE id = ?", (preset_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok'})

    # PUT
    data = request.get_json() or {}
    api_key_val = data.get('api_key', None)
    if api_key_val is not None:
        enc = encrypt_api_key(api_key_val.strip()) if api_key_val.strip() else ''
    else:
        enc = row['api_key_encrypted']  # garder l'ancienne

    # Si on tente de passer en global (ou rester global), il faut etre admin
    new_is_global = int(data.get('is_global', row['is_global']))
    if new_is_global and not row['is_global']:
        # Transition perso -> global : admin only
        admin_guard = _admin_required()
        if admin_guard:
            conn.close()
            return admin_guard
    if new_is_global != int(row['is_global']):
        # Changement d'etat is_global : admin only dans tous les cas
        admin_guard = _admin_required()
        if admin_guard:
            conn.close()
            return admin_guard

    cur.execute("""
        UPDATE ai_presets
        SET name = ?, base_url = ?, api_key_encrypted = ?, model = ?, is_client_side = ?, is_global = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (
        data.get('name', row['name']),
        data.get('base_url', row['base_url']),
        enc,
        data.get('model', row['model']),
        int(data.get('is_client_side', _row_get(row, 'is_client_side', 0))),
        new_is_global,
        preset_id
    ))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/api/presets/<int:preset_id>/duplicate', methods=['POST'])
def duplicate_preset(preset_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    row = conn.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    # Seulement les globaux ou ses propres presets peuvent être dupliques
    if not row['is_global'] and row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO ai_presets (user_id, name, engine, base_url, api_key_encrypted, model, is_global, is_client_side)
        VALUES (?, ? || ' (copie)', ?, ?, ?, ?, 0, ?)
    """, (user_id, row['name'], row['engine'], row['base_url'], row['api_key_encrypted'], row['model'], _row_get(row, 'is_client_side', 0)))
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return jsonify({'id': pid, 'name': row['name'] + ' (copie)'}), 201


@app.route('/api/presets/<int:preset_id>/models', methods=['GET'])
def list_preset_models(preset_id):
    guard = _login_required()
    if guard: return guard
    conn = get_db()
    row = conn.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    base_url = row['base_url'].rstrip('/')
    api_key = decrypt_api_key(row['api_key_encrypted'])
    conn.close()

    import requests
    try:
        headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
        r = requests.get(f'{base_url}/models', headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()
        models = []
        for m in data.get('data', data.get('models', [])):
            if isinstance(m, dict):
                models.append({'id': m.get('id', ''), 'name': m.get('name', m.get('id', '')), 'owned_by': m.get('owned_by', '')})
            elif isinstance(m, str):
                models.append({'id': m, 'name': m, 'owned_by': ''})
        return jsonify(models)
    except Exception as e:
        return jsonify({'error': f'Impossible de lister les modeles : {e}'}), 502


@app.route('/api/presets/list-models', methods=['POST'])
def list_models_temp():
    """Endpoint temporaire pour lister les modeles sans preset enregistre."""
    guard = _login_required()
    if guard: return guard
    data = request.get_json() or {}
    base_url = (data.get('base_url') or '').rstrip('/')
    api_key = (data.get('api_key') or '').strip()
    if not base_url:
        return jsonify({'error': 'URL requise'}), 400
    import requests
    try:
        headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
        r = requests.get(f'{base_url}/models', headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()
        models = []
        raw = data.get('data', data.get('models', []))
        for m in raw:
            if isinstance(m, dict):
                models.append({'id': m.get('id', ''), 'name': m.get('name', m.get('id', '')), 'owned_by': m.get('owned_by', '')})
            elif isinstance(m, str):
                models.append({'id': m, 'name': m, 'owned_by': ''})
        return jsonify(models)
    except Exception as e:
        return jsonify({'error': f'Impossible de lister les modeles : {e}'}), 502


# ── Styles ──────────────────────────────────────────────────────────

@app.route('/api/styles', methods=['GET', 'POST'])
def styles():
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    cur = conn.cursor()

    if request.method == 'GET':
        try:
            rows = cur.execute("""
                SELECT s.*, u.username, u.display_name
                FROM styles s
                LEFT JOIN users u ON u.id = s.user_id
                WHERE s.is_public = 1 OR s.user_id = ?
                ORDER BY s.is_public DESC, s.name
            """, (user_id,)).fetchall()
        except Exception as e:
            conn.close()
            return jsonify({'error': f'DB error: {e}'}), 500
        conn.close()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'name': r['name'],
                'style_text': r['style_text'],
                'negative_prompt': _row_get(r, 'negative_prompt', ''),
                'is_public': bool(r['is_public']),
                'user_id': r['user_id'],
                'owner_name': r['display_name'] or r['username'] or ''
            })
        return jsonify(result)

    data = request.get_json() or {}
    name = data.get('name', '').strip()
    style_text = data.get('style_text', '').strip()
    negative_prompt = data.get('negative_prompt', '').strip()
    is_public = int(data.get('is_public', 0))
    if not name or not style_text:
        conn.close()
        return jsonify({'error': 'Nom et texte requis'}), 400

    cur.execute(
        "INSERT INTO styles (user_id, name, style_text, negative_prompt, is_public) VALUES (?, ?, ?, ?, ?)",
        (user_id, name, style_text, negative_prompt, is_public)
    )
    conn.commit()
    sid = cur.lastrowid
    conn.close()
    return jsonify({'id': sid, 'name': name}), 201


@app.route('/api/styles/<int:style_id>', methods=['PUT', 'DELETE'])
def single_style(style_id):
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    conn = get_db()
    row = conn.execute("SELECT * FROM styles WHERE id = ?", (style_id,)).fetchone()
    if not row or row['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    if request.method == 'DELETE':
        # Détacher les prompts générés qui référencent ce style (FK constraint)
        conn.execute("UPDATE generated_prompts SET style_id = NULL WHERE style_id = ?", (style_id,))
        conn.execute("DELETE FROM styles WHERE id = ?", (style_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok'})

    data = request.get_json() or {}
    conn.execute("""
        UPDATE styles SET name = ?, style_text = ?, negative_prompt = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (
        data.get('name', row['name']),
        data.get('style_text', row['style_text']),
        data.get('negative_prompt', _row_get(row, 'negative_prompt', '')),
        int(data.get('is_public', row['is_public'])),
        style_id
    ))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


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


# ── Enhance ─────────────────────────────────────────────────────────

def convert_bboxes_to_normalized(json_text, width, height):
    """
    Convertit les bboxes du JSON caption de pixels vers 0-1000 normalise.
    Le LLM genere les bboxes en coordonnees pixels (car c'est plus intuitif),
    mais l'API Ideogram 4 attend du 0-1000 normalise.

    Pour chaque element avec un bbox [y_min, x_min, y_max, x_max] en pixels :
      y_min_norm = round(y_min / height * 1000)
      x_min_norm = round(x_min / width * 1000)
      y_max_norm = round(y_max / height * 1000)
      x_max_norm = round(x_max / width * 1000)
    """
    import re
    if not json_text or not width or not height:
        return json_text
    try:
        s = json_text.strip()
        # Strip code fences si present
        m = re.search(r'```(?:json)?\s*([\s\S]+?)\s*```', s)
        if m:
            s = m.group(1)
        data = json.loads(s)
    except Exception:
        return json_text

    elements = (data.get("compositional_deconstruction") or {}).get("elements") or []
    changed = False
    for el in elements:
        bbox = el.get("bbox")
        if not bbox or not isinstance(bbox, list) or len(bbox) != 4:
            continue
        y_min, x_min, y_max, x_max = bbox
        # Detecter si deja en 0-1000 (toutes valeurs <= 1000)
        # Si max value > 1000, c'est des pixels -> convertir
        max_val = max(y_min, x_min, y_max, x_max)
        if max_val <= 1000:
            continue  # deja normalise, on touche pas
        # Clamp aux dimensions de l'image
        y_min = max(0, min(y_min, height))
        x_min = max(0, min(x_min, width))
        y_max = max(y_min + 1, min(y_max, height))
        x_max = max(x_min + 1, min(x_max, width))
        # Convertir en 0-1000
        el["bbox"] = [
            round(y_min / height * 1000),
            round(x_min / width * 1000),
            round(y_max / height * 1000),
            round(x_max / width * 1000),
        ]
        changed = True

    if changed:
        # Re-serialiser en gardant le meme format
        try:
            return json.dumps(data, ensure_ascii=False)
        except Exception:
            return json_text
    return json_text


def _build_debug_markdown(sections, conversion_debug, width, height):
    """Assemble un markdown de debug a partir des sections collectees."""
    lines = []
    lines.append("# FR.IA Ideogram 4 — Debug")
    lines.append("")
    lines.append(f"**Image** : {width}x{height}")
    lines.append("")

    for sec in sections:
        if 'title' in sec:
            # Passe 1 : generation
            lines.append(f"## {sec['title']}")
            lines.append("")
            lines.append(f"**Model** : `{sec.get('model', '?')}`  ")
            lines.append(f"**Temperature** : {sec.get('temperature', '?')}  ")
            lines.append(f"**Max tokens** : {sec.get('max_tokens', '?')}")
            lines.append("")
            lines.append("### System Prompt")
            lines.append("```")
            lines.append(sec.get('system_prompt', ''))
            lines.append("```")
            lines.append("")
            lines.append("### User Prompt")
            lines.append("```")
            lines.append(sec.get('user_prompt', ''))
            lines.append("```")
            lines.append("")
            if 'raw_output' in sec:
                lines.append("### Sortie brute LLM")
                lines.append("```")
                lines.append(sec['raw_output'])
                lines.append("```")
                lines.append("")
        elif 'pass' in sec:
            # Passe de validation
            lines.append(f"## Passe {sec['pass']} : Validation spatiale")
            lines.append("")
            for i, call in enumerate(sec.get('api_calls', [])):
                lines.append(f"### Appel LLM {i+1}")
                lines.append("")
                lines.append(f"**Model** : `{call.get('model', '?')}`  ")
                lines.append(f"**Temperature** : {call.get('temperature', '?')}")
                lines.append("")
                lines.append("#### System Prompt")
                lines.append("```")
                lines.append(call.get('system_prompt', ''))
                lines.append("```")
                lines.append("")
                lines.append("#### User Prompt")
                lines.append("```")
                lines.append(call.get('user_prompt', ''))
                lines.append("```")
                lines.append("")
                if 'raw_output' in call:
                    lines.append("#### Sortie brute LLM")
                    lines.append("```")
                    lines.append(call['raw_output'])
                    lines.append("```")
                    lines.append("")
                if 'error' in call:
                    lines.append(f"**Erreur** : {call['error']}")
                    lines.append("")
                if 'status' in call:
                    lines.append(f"**Statut** : {call['status']}")
                    lines.append("")

    if conversion_debug:
        lines.append("## Conversion pixels \u2192 0-1000")
        lines.append("")
        lines.append(f"**Dimensions** : {conversion_debug['width']}x{conversion_debug['height']}")
        lines.append("")
        lines.append("### Avant conversion (pixels)")
        lines.append("```")
        lines.append(conversion_debug.get('before', ''))
        lines.append("```")
        lines.append("")
        lines.append("### Apres conversion (0-1000 normalise)")
        lines.append("```")
        lines.append(conversion_debug.get('after', ''))
        lines.append("```")
        lines.append("")

    return '\n'.join(lines)


@app.route('/api/enhance', methods=['POST'])
def enhance_prompt():
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    data = request.get_json() or {}

    # Debug : collecter les etapes pour le markdown de debug
    debug_sections = []

    preset_id = data.get('preset_id')
    text = data.get('text', '').strip()
    prompt_type = data.get('prompt_type', 'sdxl').strip()
    # Format de sortie : si non fourni, déduit du type de prompt.
    # Par défaut tout est en 'text'. L'editeur de templates peut surcharger
    # par type en creant un template avec un format different.
    output_format = (data.get('output_format') or '').strip() or _default_format_for_type(prompt_type)
    style_id = data.get('style_id')
    style_text = data.get('style_text', '').strip()
    special_instructions = data.get('special_instructions', '').strip()
    ep_elements = data.get('ep_elements', [])
    random_count = int(data.get('random_count', 0))
    width = int(data.get('width') or 0)
    height = int(data.get('height') or 0)

    # Resoudre le style si style_id fourni
    negative_prompt = ''
    if style_id:
        conn = get_db()
        row = conn.execute("SELECT style_text, negative_prompt FROM styles WHERE id = ?", (style_id,)).fetchone()
        if row:
            if not style_text:
                style_text = row['style_text'] or ''
            negative_prompt = row['negative_prompt'] or ''
        conn.close()

    # Resoudre les elements EP
    ep_keywords = []
    if ep_elements:
        conn = get_db()
        cur = conn.cursor()
        for elem in ep_elements:
            if elem.get('type') == 'filter' and elem.get('id'):
                cur.execute("SELECT keyword_id FROM filter_cache WHERE filter_id = ?", (elem['id'],))
                kids = [r[0] for r in cur.fetchall()]
                if kids:
                    cur.execute("SELECT keyword FROM keywords WHERE id IN (" + ','.join('?' for _ in kids) + ")", kids)
                    kws = [r[0] for r in cur.fetchall()]
                    if kws:
                        ep_keywords.append(random.choice(kws))
            elif elem.get('type') == 'text' and elem.get('text'):
                try:
                    qv = generate_embedding(elem['text'])
                    cur.execute("SELECT k.keyword, ke.embedding FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id")
                    rows = cur.fetchall()
                    scored = []
                    for r in rows:
                        vec = json.loads(r['embedding']) if r['embedding'] else None
                        if vec:
                            s = cosine_similarity(qv, vec)
                            if s >= 0.45:
                                scored.append((r['keyword'], s))
                    scored.sort(key=lambda x: x[1], reverse=True)
                    top5 = [k for k, _ in scored[:5]]
                    if top5:
                        ep_keywords.append(random.choice(top5))
                except Exception:
                    pass
        conn.close()

    ep_text = ', '.join(ep_keywords) if ep_keywords else ''

    # Random elements : piocher depuis sections non encore utilisees
    rand_keywords = []
    if random_count > 0:
        conn = get_db()
        cur = conn.cursor()
        # Trouver les sections deja utilisees
        all_kw_text = (text + ' ' + ep_text).lower()
        existing = []
        for kw in all_kw_text.replace(',', ' ').split():
            kw = kw.strip()
            if len(kw) >= 3:
                existing.append(kw)
        if existing:
            placeholders = ','.join('?' for _ in existing)
            cur.execute(f"SELECT DISTINCT section_id FROM keywords WHERE LOWER(keyword) IN ({placeholders})", existing)
            used_sections = {r[0] for r in cur.fetchall() if r[0]}
        else:
            used_sections = set()
        # Piocher des keywords depuis des sections inutilisees
        if used_sections:
            ph = ','.join('?' for _ in used_sections)
            cur.execute(f"SELECT keyword FROM keywords WHERE section_id NOT IN ({ph}) OR section_id IS NULL ORDER BY RANDOM() LIMIT ?", list(used_sections) + [random_count])
        else:
            cur.execute("SELECT keyword FROM keywords ORDER BY RANDOM() LIMIT ?", (random_count,))
        rand_keywords = [r[0] for r in cur.fetchall()]
        conn.close()

    rand_text = ', '.join(rand_keywords) if rand_keywords else ''

    # ── Branche specifique Ideogram 4 ─────────────────────────────
    # Pour Ideogram 4 on structure l'entree en sections nommees
    # (description generale + 4 elements + dimensions) au lieu du
    # format avec priorites [PRIORITE ...] qui n'a pas de sens ici.
    if prompt_type == 'ideogram4':
        parts = []
        if text:
            parts.append("GENERAL DESCRIPTION (scene, style, lighting, mood):\n" + text)
        # Les elements EP de type "text" sont les sujets principaux
        named_elems = [e.get('text', '').strip() for e in ep_elements
                       if e.get('type') == 'text' and e.get('text', '').strip()]
        if named_elems:
            parts.append("ELEMENTS TO PLACE IN THE SCENE:")
            for i, desc in enumerate(named_elems, 1):
                parts.append(f"  {i}. {desc}")
        if width and height:
            from math import gcd
            g = gcd(width, height)
            parts.append(f"IMAGE DIMENSIONS: {width}x{height} pixels (aspect ratio: {width//g}:{height//g})")
        if style_text:
            parts.append("STYLE (must be preserved verbatim):\n" + style_text)
        if special_instructions:
            parts.append("ADDITIONAL INSTRUCTIONS:\n" + special_instructions)
        merged_text = '\n\n'.join(parts)
    else:
        # Fusionner avec priorites (autres types)
        merged_parts = []
        if text:
            merged_parts.append(f"[PRIORITE HAUTE] {text}")
        if ep_text:
            merged_parts.append(f"[PRIORITE MOYENNE] {ep_text}")
        if rand_text:
            merged_parts.append(f"[PRIORITE BASSE] {rand_text}")
        merged_text = '\n'.join(merged_parts)

    if not merged_text.strip():
        return jsonify({'error': 'Aucun contenu a generer'}), 400

    # Recuperer le preset
    conn = get_db()
    preset = None
    if preset_id:
        preset = conn.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not preset:
        # Fallback : premier preset personnel dispo
        preset = conn.execute(
            "SELECT * FROM ai_presets WHERE user_id = ? OR is_global = 1 ORDER BY is_global DESC LIMIT 1",
            (user_id,)
        ).fetchone()
    if not preset:
        conn.close()
        return jsonify({'error': 'Aucun preset IA configure. Cree un preset dans la configuration.'}), 400

    api_key = decrypt_api_key(preset['api_key_encrypted'])
    base_url = preset['base_url'].rstrip('/')
    model = preset['model']
    conn.close()
    # Debug temporaire : tracer le preset utilise
    import logging
    logging.warning(f"[enhance] user={user_id} preset_id={preset['id']} name='{preset['name']}' is_global={preset['is_global']} model='{model}' base_url='{base_url}' api_key_len={len(api_key) if api_key else 0}")

    # Construire le prompt systeme
    type_formats = {
        'liste': 'Liste de tags separes par des virgules, ordonnes par importance (exemple: "masterpiece, 1girl, blue sky, city street, long hair").',
        'sdxl': 'Prompt SDXL optimise avec Natural Language + tags Danbooru, bien equilibre. Format: qualite + sujet principal + description scene + details techniques.',
        'sd15': 'Prompt Stable Diffusion 1.5 avec tags Danbooru. Format court et dense, priorite aux tags essentiels.',
        'flux': 'Prompt Flux, description longue et naturelle en anglais.',
        'anima': 'Prompt Anime/Manga, tags Danbooru avec suffixes specifiques (pixel art, lineart, flat color, etc.).',
        'qwen': 'Prompt Qwen, format optimise pour modele Qwen2-VL / image generation.',
        'ideogram4': 'JSON Ideogram 4 : caption structuree avec high_level_description, style_description (aesthetics, lighting, photo/art_style, medium, color_palette optionnel) et compositional_deconstruction (background + elements avec bbox obligatoire en coordonnees pixels). Format JSON strict, ordre des cles preserve.',
    }

    format_instruction = type_formats.get(prompt_type, type_formats['sdxl'])

    # Recuperer les top 5 examples pour ce type
    conn = get_db()
    examples = conn.execute(
        "SELECT prompt_text FROM prompt_examples WHERE type = ? ORDER BY rating DESC LIMIT 5",
        (prompt_type,)
    ).fetchall()
    conn.close()

    examples_text = ''
    if examples:
        examples_text = '\nExemples de prompts ' + prompt_type + ' :\n'
        for ex in examples:
            examples_text += '- ' + ex['prompt_text'] + '\n'

    # Regles de format de sortie par defaut (utilisees SEULEMENT si pas de
    # template en BDD). Ces regles sont GENERIQUES — les templates Ideogram 4
    # en BDD contiennent leur propre regle stricte.
    format_rules = {
        'text': 'Output ONLY the final prompt — no quotes, no code blocks, no explanations, no introduction.',
        'markdown': 'Output in clean Markdown (no ``` code blocks). The prompt is the main content.',
        'json': 'Output raw JSON (no ```json). The JSON structure depends on the prompt type — follow the schema described in the documentation above.',
    }

    # Resoudre le template personnalise depuis prompt_templates
    template_examples = []
    template_system_prompt = None  # system_prompt du template (peut etre None)
    conn = get_db()
    try:
        cur = conn.execute(
            "SELECT system_prompt, examples FROM prompt_templates WHERE user_id = ? AND prompt_type = ? AND output_format = ?",
            (user_id, prompt_type, output_format)
        )
        tmpl = cur.fetchone()
        if not tmpl:
            cur = conn.execute(
                "SELECT system_prompt, examples FROM prompt_templates WHERE user_id IS NULL AND prompt_type = ? AND output_format = ? AND is_default = 1",
                (prompt_type, output_format)
            )
            tmpl = cur.fetchone()
        if tmpl:
            template_system_prompt = tmpl['system_prompt']
            try:
                template_examples = json.loads(tmpl['examples']) if tmpl['examples'] else []
            except:
                template_examples = []
    except:
        pass
    conn.close()

    system_parts = []

    # 1) STYLE — tout en haut, imperatif
    if style_text:
        system_parts.append(f"""CRITICAL — STYLE PRESERVATION RULE
You MUST preserve the following style in the output prompt, verbatim and unmodified:
{style_text}

This style is IMPERATIVE. Keep it exactly as written, do NOT rephrase or summarize it.""")

    # 2) System prompt du template en BDD (le coeur de l'instruction)
    # Si le template existe en BDD, on l'utilise ENTIEREMENT — il contient
    # deja la doc du format, les exemples, les regles. Sinon on retombe
    # sur le system prompt generique ci-dessous.
    if template_system_prompt and template_system_prompt.strip():
        system_parts.append(template_system_prompt.strip())
    else:
        # Fallback : system prompt generique (pour les types sans template en BDD)
        system_parts.append("""You are an expert image prompt engineer. Your task is to rewrite and optimize the user's input into a high-quality image generation prompt.""")

        # Format demande (type-agnostic)
        format_instr = type_formats.get(prompt_type, type_formats['sdxl'])
        system_parts.append(f"Expected output style: {format_instr}")

        # Exemples (inspiration, pas copie)
        if template_examples:
            ex_list = '\n'.join(f'- {ex}' for ex in template_examples)
            system_parts.append(f"""Study these example prompts to understand the expected structure and quality level — use them for inspiration, do NOT copy them verbatim:
{ex_list}""")
        elif examples_text.strip():
            system_parts.append(f"""Study these example prompts for reference:
{examples_text}""")

        # Regles
        system_parts.append("""Rules:
- Preserve the user's main intent and keywords; do not discard specific requests
- Remove duplicate concepts
- Organize by importance (most important first)
- Output ONLY the final prompt text — no markers, no tags like [PRIORITE HAUTE], no meta-commentary""")

        # Format de sortie
        system_parts.append(format_rules.get(output_format, "Output ONLY the final prompt."))

    # 3) Instructions speciales (toujours en dernier)
    if special_instructions:
        system_parts.append(f"Additional instructions: {special_instructions}")

    system_prompt = '\n\n'.join(system_parts)

    # Post-nettoyage de la sortie : retirer les marqueurs [PRIORITE ...]
    import re
    def clean_output(text):
        text = re.sub(r'\[PRIORITE\s+(HAUTE|MOYENNE|BASSE)\]', '', text, flags=re.IGNORECASE)
        return text.strip()

    # Appel LLM
    import requests
    try:
        headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'} if api_key else {'Content-Type': 'application/json'}
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': merged_text}
            ],
            'temperature': 0.3,
            'max_tokens': 2000 if output_format == 'json' else 400,
            'frequency_penalty': 0.5,
            'repeat_penalty': 1.2,
        }
        # Debug : enregistrer la passe 1
        debug_sections.append({
            'title': 'Passe 1 : Generation',
            'model': model,
            'system_prompt': system_prompt[:2000],
            'user_prompt': merged_text[:2000],
            'temperature': payload['temperature'],
            'max_tokens': payload['max_tokens'],
        })
        r = requests.post(f'{base_url}/chat/completions', headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        result = r.json()
        output = result['choices'][0]['message']['content'].strip()
        # Debug : sortie brute passe 1
        if debug_sections:
            debug_sections[-1]['raw_output'] = output[:3000]
        # Nettoyer les balises de code eventuelles
        if output.startswith('```'):
            lines = output.split('\n')
            if lines[0].startswith('```'):
                lines = lines[1:]
            if lines and lines[-1].strip() == '```':
                lines = lines[:-1]
            output = '\n'.join(lines).strip()
        # Nettoyer les marqueurs [PRIORITE ...]
        output = clean_output(output)
    except Exception as e:
        msg = str(e)
        if '429' in msg:
            return jsonify({'error': 'Rate limit atteint sur le serveur LLM. Attends un peu et reessaye.'}), 429
        if 'connect' in msg.lower() or 'refused' in msg.lower():
            return jsonify({'error': f'Serveur LLM inaccessible : verifie l\'URL ({base_url})'}), 502
        return jsonify({'error': f'Erreur LLM: {msg}'}), 502

    # Sauvegarde du prompt genere
    try:
        conn2 = get_db()
        conn2.execute(
            """INSERT INTO generated_prompts (user_id, preset_id, prompt_type, input_text, output_text, style_id, model_used)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, preset['id'] if preset else None, prompt_type, merged_text, output, data.get('style_id'), model)
        )
        conn2.commit()
        conn2.close()
    except Exception:
        pass  # non-bloquant

    # ── Auto-critique : passes de validation (Ideogram 4 uniquement) ────
    # Pour les autres types, pas de bbox/structure a valider, on garde 0.
    validation_passes = int(data.get('validation_passes', 1 if prompt_type == 'ideogram4' else 0))
    validation_passes = max(0, min(validation_passes, 3))  # borne 0..3

    for pass_idx in range(validation_passes):
        try:
            corrected, val_debug = _validate_caption_pass(
                output, merged_text, style_text, width, height,
                api_key, base_url, model, pass_idx
            )
            debug_sections.append(val_debug)
            if corrected:
                output = corrected
        except Exception:
            # En cas d'erreur de validation, on garde la sortie precedente
            pass

    # Convertir les bboxes de pixels vers 0-1000 normalise (Ideogram 4)
    conversion_debug = None
    if prompt_type == 'ideogram4' and width and height:
        before_conversion = output[:500]
        output = convert_bboxes_to_normalized(output, width, height)
        conversion_debug = {'before': before_conversion, 'after': output[:500], 'width': width, 'height': height}

    # Assembler le markdown de debug (uniquement pour ideogram4)
    debug_md = ''
    if prompt_type == 'ideogram4' and debug_sections:
        debug_md = _build_debug_markdown(debug_sections, conversion_debug, width, height)

    return jsonify({'output': output, 'negative_prompt': negative_prompt, 'model_used': model, 'debug_md': debug_md})


def _validate_caption_pass(current_output, original_input, style_text, width, height,
                            api_key, base_url, model, pass_idx):
    """
    Passe dediee au placement des bounding boxes.
    Le LLM recoit le JSON caption + l'input original, et son SEUL job
    est de placer les bboxes de maniere coherente avec la scene.

    Retourne (json_corrige, debug_dict) ou (None, debug_dict) si pas de correction.
    """
    import requests as _req
    debug = {'pass': pass_idx + 1, 'api_calls': []}
    import re as _re

    # Tenter de parser le JSON
    try:
        s = current_output.strip()
        m = _re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", s)
        if m:
            s = m.group(1)
        parsed = json.loads(s)
        parsed_ok = True
    except Exception:
        parsed_ok = False
        parsed = None

    if not parsed_ok:
        critique_prompt = ("The previous Ideogram 4 caption is NOT valid JSON. "
                           "Regenerate it as a valid JSON object matching the schema. "
                           "Output ONLY the JSON, no commentary.")
    else:
        # Extraire les elements
        elements = (parsed.get('compositional_deconstruction') or {}).get('elements') or []
        element_list = []
        for i, el in enumerate(elements):
            bbox = el.get('bbox', '?')
            desc = (el.get('desc') or el.get('text') or '?')[:120]
            element_list.append(f"  {i+1}. {desc} | bbox: {bbox}")
        elements_text = '\n'.join(element_list) if element_list else "  (none)"

        from math import gcd
        g = gcd(width, height) if width and height else 1
        aspect = f"{width//g}:{height//g}"

        # Prompt simple et direct : le LLM sait deja ce qu'est une personne debout
        critique_prompt = f"""Fix the bounding boxes in this Ideogram 4 caption.

USER SCENE: {original_input}

ELEMENTS (each one is a separate subject that needs a bbox):
{elements_text}

IMAGE: {width}x{height} (aspect ratio: {aspect})

Your ONLY task: imagine a photograph of this scene, then assign each element a bounding box that matches WHERE that person/object would actually be in the photo.

bbox format: [y_min, x_min, y_max, x_max] in pixel coordinates matching the image dimensions. Origin top-left.

Rules:
- Each element gets its own NON-OVERLAPPING zone
- A bbox SURROUNDS the subject: standing person = tall narrow (y_span > x_span), diving person = wide short (x_span > y_span). NEVER make a standing person's bbox wider than tall.
- LAYOUT depends on aspect ratio: landscape ({aspect}) = spread elements side by side horizontally. Portrait = stack elements vertically with less horizontal room.
- The first element is the main subject (largest, centered)
- Never remove or add elements

Current JSON:
{current_output}

Output ONLY the corrected JSON. No code fences."""

    # Appel LLM
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'} if api_key else {'Content-Type': 'application/json'}
    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': 'You are a spatial composition expert. You output ONLY corrected JSON with properly placed bounding boxes.'},
            {'role': 'user', 'content': critique_prompt},
        ],
        'temperature': 0.1,
        'max_tokens': 2000,
        'frequency_penalty': 0.0,
        'repeat_penalty': 1.0,
    }
    # Debug : enregistrer l'appel de validation
    debug['api_calls'].append({
        'system_prompt': payload['messages'][0]['content'],
        'user_prompt': critique_prompt[:3000],
        'temperature': payload['temperature'],
        'model': model,
    })
    try:
        r = _req.post(f'{base_url}/chat/completions', headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        result = r.json()
        new_output = result['choices'][0]['message']['content'].strip()
        debug['api_calls'][-1]['raw_output'] = new_output[:3000]
    except Exception as e:
        debug['api_calls'][-1]['error'] = str(e)
        return None, debug

    # Nettoyer les fences
    if new_output.startswith('```'):
        nl = new_output.split('\n')
        if nl[0].startswith('```'):
            nl = nl[1:]
        if nl and nl[-1].strip() == '```':
            nl = nl[:-1]
        new_output = '\n'.join(nl).strip()

    # Verifier que c'est du JSON valide
    try:
        s2 = new_output.strip()
        m2 = _re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", s2)
        if m2:
            s2 = m2.group(1)
        json.loads(s2)
        debug['api_calls'][-1]['status'] = 'valid_json'
        return new_output, debug
    except Exception as e:
        debug['api_calls'][-1]['status'] = f'invalid_json: {e}'
        return None, debug
@app.route('/api/generate', methods=['POST'])
def generate_prompt():
    guard = _login_required()
    if guard:
        return guard
    data = request.get_json()
    if not data:
        return jsonify({'error': 'payload requis'}), 400

    elements = data.get('elements', [])
    # Seed pour reproductibilité — on utilise un Random local pour ne pas
    # polluer l'état global et garantir le déterminisme.
    # IMPORTANT : les requêtes SQL ne DOIVENT PAS utiliser ORDER BY RANDOM()
    # car SQLite a son propre RNG qui ignore random.seed().
    seed = data.get('seed')
    rng = random.Random(seed if seed is not None else None)

    random_count = int(data.get('random_count', 0))
    random_sfw = data.get('random_sfw', True)   # Défaut : SFW autorisé
    random_nsfw = data.get('random_nsfw', False)  # Défaut : NSFW non autorisé

    if not elements and random_count <= 0:
        return jsonify({'prompt': '', 'count': 0, 'elements': [], 'debug': []})

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
            finfo = cur.execute(
                "SELECT name, (SELECT COUNT(*) FROM filter_cache WHERE filter_id = ?) as cnt FROM saved_filters WHERE id = ?",
                (elem['id'], elem['id'])
            ).fetchone()
            # Charger TOUS les keyword_ids du filtre, puis choisir en Python (déterministe)
            cur.execute(
                "SELECT keyword_id FROM filter_cache WHERE filter_id = ?",
                (elem['id'],)
            )
            all_kids = [r['keyword_id'] for r in cur.fetchall()]
            if all_kids:
                kid = rng.choice(all_kids)
            if finfo:
                debug.append({'source': f"filtre '{finfo['name']}' (cache: {finfo['cnt']})", 'picked': bool(kid)})

        elif elem.get('type') == 'text' and elem.get('text'):
            kind = 'semantic'
            try:
                from embeddings import generate_embedding, cosine_similarity
                qe = generate_embedding(elem['text'])
                cur.execute(
                    "SELECT k.id, ke.embedding FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id"
                )
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
                        kid, score = rng.choice(top)
            except Exception:
                pass

        elif elem.get('type') == 'raw' and elem.get('text'):
            # Custom text du node ComfyUI : on l'ajoute TEL QUEL dans le prompt.
            # Pas de recherche semantique, pas de pioche aleatoire.
            kind = 'raw'
            raw_text = elem['text'].strip()
            if raw_text:
                keywords.append(raw_text)
                debug.append({'keyword': raw_text, 'source': 'raw', 'score': 0})
            continue  # pas de kid a chercher en BDD

        if kid:
            cur.execute("SELECT keyword FROM keywords WHERE id = ?", (kid,))
            row = cur.fetchone()
            if row:
                keywords.append(row['keyword'])
                debug.append({'keyword': row['keyword'], 'source': kind, 'score': round(score, 3)})

    # Random elements : piocher depuis des sections non encore utilisées
    if random_count > 0:
        existing_kw_text = ', '.join(keywords).lower()
        existing_words = [w.strip() for w in existing_kw_text.replace(',', ' ').split() if len(w.strip()) >= 3]
        used_sections = set()
        if existing_words:
            placeholders = ','.join('?' for _ in existing_words)
            try:
                cur.execute(
                    f"SELECT DISTINCT section_id FROM keywords WHERE LOWER(keyword) IN ({placeholders})",
                    existing_words
                )
                used_sections = {r[0] for r in cur.fetchall() if r[0]}
            except Exception:
                pass

        # Charger les candidats, puis choisir en Python (déterministe avec rng)
        # Filtrer par SFW/NSFW
        nsfw_filter = None
        if random_sfw and not random_nsfw:
            nsfw_filter = 0  # SFW uniquement
        elif random_nsfw and not random_sfw:
            nsfw_filter = 1  # NSFW uniquement
        # Si les deux ou aucun, pas de filtre

        if used_sections:
            ph = ','.join('?' for _ in used_sections)
            if nsfw_filter is not None:
                cur.execute(
                    f"SELECT keyword FROM keywords WHERE (section_id NOT IN ({ph}) OR section_id IS NULL) AND nsfw = ?",
                    list(used_sections) + [nsfw_filter]
                )
            else:
                cur.execute(
                    f"SELECT keyword FROM keywords WHERE section_id NOT IN ({ph}) OR section_id IS NULL",
                    list(used_sections)
                )
        else:
            if nsfw_filter is not None:
                cur.execute("SELECT keyword FROM keywords WHERE nsfw = ?", (nsfw_filter,))
            else:
                cur.execute("SELECT keyword FROM keywords")
        candidates = [r[0] for r in cur.fetchall()]
        n = min(random_count, len(candidates))
        rand_keywords = rng.sample(candidates, n) if n > 0 else []
        keywords.extend(rand_keywords)
        for rk in rand_keywords:
            debug.append({'keyword': rk, 'source': 'random', 'score': 0})

    conn.close()
    prompt = ", ".join(keywords) if keywords else ""
    return jsonify({'prompt': prompt, 'count': len(keywords), 'elements': debug, 'debug': debug})


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
