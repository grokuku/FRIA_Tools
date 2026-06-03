# FR.IA-keywords — Règles du projet

## Conventions générales

### Ne pas compiler dans le dossier source
- Les builds, `__pycache__/`, `*.pyc`, `node_modules/` ne doivent jamais atterrir dans les sources.
- Le `.gitignore` actuel couvre déjà `__pycache__/`, `*.pyc`, `keywords.db`, `.env`.

### Pas de fichiers de données dans les sources
- La base SQLite (`keywords.db`) ne doit pas être stockée dans le dépôt.
- Les fichiers d'import temporaires (`__tmp_import.md`) sont déjà ignorés.
- Les fichiers de configuration locale (`.env`, tokens) ne doivent pas être commités.

### Objectif : dossier source propre
- Le dépôt doit pouvoir être copié-collé directement sur un serveur de test sans trier/supprimer des fichiers.
- Tout fichier généré automatiquement doit être dans `.gitignore` ou produit ailleurs.

## Architecture du projet

```
FR.IA-keywords/
├── backend/          # Serveur Flask (app.py, auth.py, parser.py, etc.)
├── frontend/         # Interface web (index.html, beta.html)
├── FRIA_ComfyUI/     # Extension ComfyUI (nodes, web/)
├── web/js/           # Widgets JS pour ComfyUI
├── AGENTS.md         # Règles du projet
└── ROADMAP.md        # Roadmap et état d'avancement
```

## Filtres

- Les **filtres simples** stockent leur config dans `saved_filters.config` (JSON avec section, subsection, search_text, etc.)
- Les **filtres composés (union)** sont marqués `filter_type='union'` et référencent leurs membres via la table `filter_unions`.
- Le cache de chaque filtre est dans `filter_cache` — regénéré via `_rebuild_filter_cache()`.
- Un **filtre union** merge les caches de ses membres (déduplication automatique par PRIMARY KEY).

## Conventions de code

### Backend (Python/Flask)
- Fonctions helpers préfixées par `_` (ex: `_rebuild_filter_cache`, `_row_get`).
- Les endpoints API sont regroupés par domaine (`/api/filters`, `/api/presets`, etc.).
- Les migrations BDD se font dans `_init_db()` via `ALTER TABLE ... ADD COLUMN` ou `CREATE TABLE IF NOT EXISTS`.
- Utiliser `_login_required()` pour protéger les endpoints.
- Utiliser `get_db()` avec `sqlite3.Row` — ne pas oublier de `conn.close()`.

### Frontend (HTML/JS natif)
- Utiliser `const $ = id => document.getElementById(id)` pour les refs DOM.
- Les fonctions async utilisent `try/catch` systématique.
- L'API base URL est dans la constante `API` (configurée dynamiquement).
- `safeJson(res)` pour gérer les réponses non-JSON.
- `showModal(titre, message, type)` pour les notifications.
- `showConfirm(titre, message, callback)` pour les confirmations.
- `showPrompt(titre, label, placeholder, callback)` pour les saisies.

## Workflow Git
- Les commits et push sont faits par l'utilisateur, pas par l'assistant.
- Sauf demande explicite de l'utilisateur en cas de besoin (rare).
- Commits atomiques : un changement logique par commit.
- Suivre le format existant des messages de commit.
