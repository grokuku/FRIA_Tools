# Roadmap — Elements Picker & Prompt Generator/Enhancer

> Fichier vivant pour noter les idées, fonctionnalités et réflexions.

## 🚀 État actuel (fin de session)

**Contexte** : Serveur `kw.holaf.fr`, Ollama en Docker sur la même machine.

### ✅ Résolu cette session (bugs majeurs)
- **`sqlite3.Row` n'a pas de `.get()`** — Cause des 500 sur `/api/presets` et `/api/styles`. Fix : helper `_row_get()` + `safeJson()` (frontend).
- **Fuite de connexion BDD** dans `discord_callback()` — 2 appels à `get_db()` sans fermer le 1er.
- **`_admin_required()` défini 2 fois** — La 2ème définition écrasait la 1ère (plus robuste).
- **FK constraint bloquait DELETE styles/presets** — `generated_prompts` référençait la ligne → NULL avant delete.
- **`JSON.parse: unexpected character`** — `await res.json()` sur du HTML d'erreur. Helper `safeJson()` + 10 occurrences protégées.
- **Unreachable code** dans `deleteUser()` / `adminClearDb()` — Code après `return;`.
- **Décalage cache des filtres** — Nombreuses causes (LIMIT 20 sur preview, hidden_ids ignoré, search_neg ignoré, section/nsfw ignoré dans branche sémantique, config non persistée au Save, slider confiance ne refetchait pas l'API).
- **Mots masqués (👁️) non restaurés** au chargement d'un filtre.
- **Message d'erreur obsolète** "Token HF" → "Serveur Ollama inaccessible".
- **Imports inutilisés** dans `auth.py` retirés.
- **Parser ignorait les chiffres romains** avec L, C, D → sections XL+ ignorées.

### ⚠️ À faire au prochain déploiement
1. S'assurer que le serveur pointe vers `/projects/FRIA_Tools` (ou copier le code modifié)
2. Redémarrer le serveur → `_init_db()` applique les migrations
3. Vérifier la console navigateur pour les éventuelles erreurs résiduelles

---

## 🧠 Elements Picker (panneau droit haut)

### Concept
Générer un prompt complet en combinant des **éléments**. Chaque élément est une source de mot-clé :
- **Filtre sauvegardé** → pioche un mot-clé au hasard dans le cache du filtre
- **Texte libre** → recherche sémantique → pioche un mot-clé au hasard

### Interface utilisateur
- [x] Liste d'éléments (lignes), chaque ligne = un élément
- [x] Au début : 1 ligne vide. Quand remplie → une nouvelle ligne vide apparaît
- [x] Chaque ligne : sélecteur de filtre OU champ de texte libre
- [x] Explorateur de filtres avec toggles : "Mes filtres" / "Filtres publics", "SFW" / "NSFW" / "Les deux"
- [x] Deux boutons : "Add saved filter" / "Add semantic filter"
- [x] Texte libre dans une modale (showPrompt) au lieu d'un prompt() natif
- [x] Persistance server-side des éléments sauvegardés dans `users.settings`
- [ ] Slider de confiance minimale pour la recherche sémantique (dans le générateur) — Le slider existe dans le panneau gauche ; prévu aussi dans le générateur
- [x] Bouton "Générer" → pioche aléatoirement dans chaque élément → combine → affiche le prompt
- [x] Zone d'affichage du prompt final + bouton "Copier"
- [x] Génération instantanée (pas d'animation)

### Filtres sauvegardés
- [x] Bouton "Charger" / "Save" / "Save As" dans la barre de filtres (panneau gauche)
  - **Charger** : ouvre l'explorateur → applique la config du filtre dans les filtres de gauche
  - **Save** : visible si un filtre est chargé → met à jour le filtre existant (`PUT /api/filters/<id>`)
  - **Save As** : crée un nouveau filtre (modale classique)
  - **×** : décharge le filtre courant
- [x] Capture tous les paramètres : section, recherche texte, recherche sémantique, NSFW, slider confiance
- [x] Modale de création : nom, catégorie (texte libre), SFW/NSFW, public/privé
- [x] Bouton "Mng" → modale avec rename, delete, rebuild cache (↻)
- [x] Recharger un filtre dans la fenêtre gauche → charge ses paramètres dans les filtres
- [x] **🔴 Bug : Anciens filtres piochent dans la liste globale** — Résolu. Le cache est maintenant correctement regénéré avec tous les filtres. Le bouton ↻ reste disponible comme fallback.
- [ ] Bouton "Tout recharger" → regénère le cache pour tous les filtres
- [x] Pas de limite de filtres par utilisateur
- [x] Les filtres publics sont visibles par tous les membres connectés

### Cache
- [x] À la sauvegarde : exécute la requête → stocke les IDs des mots-clés correspondants dans `filter_cache`
- [x] Le générateur pioche dans le cache → pas d'appel Ollama à chaque génération
- [x] Invalidation du cache après un import de `.md`
- [x] Cache inclut : recherche (+), recherche (-), mots masqués (hidden_kw_ids), NSFW, section, confiance sémantique
- [x] Cache trié par score (branche sémantique) → limité à 500 comme l'API
- [x] hidden_ids appliqués APRÈS la limite (ne remplace pas par des mots hors-champ)
- [x] Texte (+) et exclusion (-) appliqués comme post-filtres sur la branche sémantique (comme l'affichage)

---

## ⚡ Prompt Generator/Enhancer (panneau droit bas)

### Concept
Transformer un prompt brut en un prompt optimisé via un LLM, en combinant plusieurs sources d'entrée et en appliquant un formatage automatique.

### Sources d'entrée (fusionnées avant envoi au LLM)

| Priorité | Source | Déclencheur |
|---|---|---|
| **Haute** | Text box (utilisateur) | Saisie manuelle |
| **Moyenne** | Elements Picker (panneau haut) | Checkbox "Base from Elements Picker" → exécute l'EP, ajoute les résultats |
| **Basse** | Random elements | Checkbox + sélecteur N → pioche N mots-clés depuis des sections non encore utilisées |

Les priorités sont communiquées au LLM pour qu'il garde les choix de l'utilisateur en cas de conflit/doublon.

### Configuration

- [x] **Dropdown Format de sortie** : Texte brut / Markdown / JSON + toggle Brut/Rendu
- [x] **Dropdown Style** : styles prédéfinis, publics ou privés, auteur affiché
- [x] **Dropdown Preset IA** : sélectionne le modèle à utiliser
- [x] **Checkbox "Use Elements Picker"** → exécute l'EP + affiche le résultat dans `gen-output`
- [x] **Checkbox "Add random"** + compteur N → pioche depuis sections inutilisées
- [x] **Système de priorités** : haute (textbox) > moyenne (EP) > basse (random)
- [x] **Few-shot examples** : top 5 depuis `prompt_examples` (vide → Phase 3)
- [ ] **Instructions spéciales** (textarea optionnel) — Le backend accepte déjà `special_instructions`, mais le champ UI n'existe pas
- [ ] **Checkbox Prompt négatif** (Phase 4)

### Actions

- [x] **Bouton Générer** : envoie au LLM → affiche le résultat
- [x] **Bouton Copier** : copie le prompt généré
- [x] **Reset** : bouton ↻ dans l'en-tête

### Prompt Examples (système auto-nourri)

- [ ] Chaque prompt généré est automatiquement sauvegardé dans `prompt_examples`
- [ ] Les utilisateurs peuvent voir et voter sur les prompts (👍 +1 / 👎 -1)
- [ ] Les 5 mieux notés par type sont passés au LLM en few-shot (actuellement : prompt système hardcodé)
- [ ] L'auteur est affiché → auto-modération
- [ ] Modale de consultation des prompts (voir/voter)

### Prompt négatif (Phase 4, basse priorité)

- Base de prompts négatifs prédéfinis ou générés séparément
- Quand coché → pioche un prompt négatif qui correspond au positif généré
- Pas de génération de négatif via LLM (mauvaise expérience constatée)

---

## ⚙️ Presets IA (nouveau panneau de configuration utilisateur)

### Concept
Chaque utilisateur configure ses propres presets de modèles IA (API compatible OpenAI). Les presets sont indépendants par utilisateur.

### Interface

- [x] Panneau de configuration utilisateur
- [x] Dropdown "Moteur" : API compatible OpenAI
- [x] Champs : URL, API Key (chiffrée), Modèle, Nom
- [x] Actions : Sauvegarder / Dupliquer / Effacer
- [x] Possibilité de switcher entre plusieurs presets (déjà fonctionnel via dropdown)

### Sécurité
- API key chiffrée côté serveur avant stockage (Fernet ou équivalent)
- Clé de chiffrement stockée dans les `app_settings` (générée au premier lancement si absente)

---

## 🎨 Styles (prédéfinis)

### Concept
Styles réutilisables ajoutés aux prompts avant envoi au LLM (ex: "Hyper realistic, 1970 vintage photography"). Fonctionnent comme les filtres sauvegardés : public/privé, avec auteur.

### Interface

- [x] Modale de gestion des styles (CRUD) : nom, texte, prompt négatif, public/privé, edit/suppr
- [x] Dropdown dans l'enhancer pour sélectionner un style
- [x] Affichage du nom de l'auteur à côté du nom du style

---

## 🔧 Technique

### Nouvelles tables BDD

| Table | Colonnes |
|---|---|
| `ai_presets` | id, user_id, name, engine, base_url, api_key_encrypted, model, created_at, updated_at |
| `styles` | id, user_id, name, style_text, is_public, created_at, updated_at |
| `prompt_examples` | id, type (sd15/sdxl/…), prompt_text, author_id, rating, created_at |
| `prompt_votes` | id, prompt_example_id, user_id, vote (1/-1), created_at |
| `generated_prompts` | id, user_id, preset_id, prompt_type, input_text, output_text, negative_prompt, style_id, created_at |

### Nouveaux endpoints API

Note : les endpoints `GET /api/prompts/examples` et `POST /api/prompts/examples/<id>/vote` sont implémentés côté serveur mais nécessitent l'UI frontend (Phase 3).

| Méthode | Route | Description |
|---|---|---|
| `GET/POST` | `/api/presets` | Lister / Créer un preset |
| `PUT/DELETE` | `/api/presets/<id>` | Modifier / Supprimer |
| `POST` | `/api/presets/<id>/duplicate` | Dupliquer un preset |
| `GET` | `/api/presets/<id>/models` | Lister les modèles du serveur |
| `GET/POST` | `/api/styles` | Lister / Créer un style |
| `PUT/DELETE` | `/api/styles/<id>` | Modifier / Supprimer |
| `GET` | `/api/prompts/examples` | Lister les prompts d'exemple (filtrés par type, paginés) |
| `POST` | `/api/prompts/examples/<id>/vote` | Voter sur un prompt (+1/-1) |
| `POST` | `/api/enhance` | Générer/améliorer un prompt via LLM |

### Fonctionnement interne

- Le endpoint `/api/enhance` reçoit : text, elements_picker_enabled, random_elements_count, prompt_type, style, special_instructions, preset_id
- Côté serveur : fusionne les sources avec priorités → construit le prompt système + few-shot examples → appelle le LLM → retourne le résultat formaté
- Le LLM est configuré pour retourner le prompt formaté + une éventuelle négation (Phase 4)
- Sauvegarde automatique du prompt généré dans `prompt_examples` après succès

---

## 🎨 UI générale
- [ ] Drag & drop des mots-clés vers le générateur
- [ ] Double-clic sur un mot-clé → ajoute au générateur
- [x] Recherche sémantique (+) avec confiance (slider) — envoie maintenant le vrai % à l'API
- [x] Recherche (+) dans tous les champs (keyword, description, section, subsection)
- [x] Recherche négative (-) pour exclure des mots-clés
- [x] Masquage local des mots-clés (👁️) avec compteur et "Réafficher"
- [x] Boutons reset par panneau (remise à zéro)
- [x] Panneaux distincts : coins arrondis, fonds differencies (3 couleurs), gaps transparents
- [ ] Code couleur par section (dans le tableau des mots-clés)
- [x] Spinner de chargement visible pendant les filtres (dans l'en-tête)
- [x] Barre de filtres sticky (reste visible en scroll)
- [ ] Compteur de tokens
- [x] Footer global avec stats (mots-clés, sections, NSFW, prompts générés)
- [x] Modales uniformes : toutes draggables, pas d'alert() natif

---

## 📋 Plan de déploiement (Prompt Generator/Enhancer)

### Phase 1 — Fondations ✅
- [x] Toutes les tâches sont terminées

### Phase 2 — Intégration Elements Picker ✅
- [x] Toutes les tâches sont terminées

### Phase 3 — Communauté & Auto-nourrissant ⬜ (non commencée)
- [ ] Sauvegarde automatique des prompts générés (`prompt_examples`)
- [ ] Modale de consultation/vote des prompts
- [ ] Endpoint `POST /api/prompts/examples/<id>/vote` (côté serveur OK, UI manquante)
- [ ] Utilisation des 5 mieux notés comme few-shot (remplace les hardcodés)
- [ ] Affichage de l'auteur sur les styles

### Phase 4 — Polish & Bonus ⬜ (non commencée)
- [ ] Checkbox Prompt négatif
- [ ] Base de prompts négatifs
- [ ] Instructions spéciales dans le prompt système (backend OK, UI manquante)
- [ ] Export du résultat
- [ ] Drag & drop des mots-clés vers le générateur (UI générale)

---

## 🐛 Bugs identifiés

### Backend — app.py

- [x] **CRITIQUE : 500 sur GET /api/presets et GET /api/styles** — Résolu. Cause : `sqlite3.Row` n'a pas de méthode `.get()`. Fix : helper `_row_get()` + utilisation de `safeJson()` côté frontend.
- [x] **Bug : URLs LLM locales invalides pour les utilisateurs distants** — Résolu avec l'option "Client-side" dans les presets.
- [x] **Bug : Mauvaise URL pour le endpoint members** — Corrigé.
- [x] **Bug : PUT /api/filters/<id> plante (KeyError)** — Corrigé.
- [x] **Bug : Fuite de connexion BDD dans `discord_callback()`** — Corrigé (2nd `get_db()` supprimé).
- [x] **Bug : Message d'erreur obsolète** — "Token HF" → "Serveur Ollama inaccessible".
- [x] **Commentaire obsolète** — "embeddings HF" → "embeddings Ollama".
- [x] **`_admin_required()` défini 2 fois** — Suppression de la 2ème définition (moins robuste).
- [x] **FK constraint bloquait DELETE styles/presets** — `NULL` des références dans `generated_prompts` avant suppression.
- [ ] **Bug : Liste des utilisateurs cassée dans le panneau admin** — Non vérifié.
- [ ] **Variable inutilisée** — `stats()` et `sections()` récupèrent `user_id` sans l'utiliser.
- [ ] **Colonne `config` pas mise à jour au Save** — Résolu (PUT /api/filters/<id> écrit maintenant la config).
- [ ] **Preview `total` plafonné à 20** — Résolu (COUNT(*) séparé du LIMIT).
- [ ] **Cache sémantique ignorait section/nsfw/hidden_ids/search_neg** — Résolu (pré-filtre SQL + post-filtre).

### Backend — parser.py

- [x] **Parser ignorait les chiffres romains avec L, C, D** — `[IVX]+` → `[IVXLCDM]+` pour supporter XL, LI, etc.

### Backend — auth.py

- [x] **Imports inutilisés** — Supprimés (`json`, `Path`, `redirect`, `request`, `jsonify`, `current_app`).

### Backend — exporter.py

- [ ] **Export sans filtre utilisateur** — Exporte tous les mots-clés (normal pour base partagée) mais la fonction `export_to_markdown` utilise `SELECT * FROM keywords` sans `ORDER BY` cohérent. Les mots-clés sont exportés dans l'ordre d'insertion, pas par section.

### Frontend — index.html

- [ ] **Potentiel : `filtersBar` déclaré mais plus utilisé** — La variable `filtersBar` est référencée dans `const filtersBar = $('filters-bar')` mais n'est plus utilisée dans le code (remplacée par `document.getElementById('filters-bar')`).
- [ ] **Score header visible en mode texte** — `scoreHeader` est initialisé comme `hidden` mais pourrait être affecté par `loadColWidths` qui applique des largeurs à tous les `<th>` sans vérifier si la colonne est visible.
- [x] **Unreachable code dans deleteUser/adminClearDb** — Code après `return;` déplacé dans le callback.
- [x] **`delStyle()` silencieux** — Ajout d'affichage d'erreur.
- [x] **Confidence slider ne refetchait pas l'API** — Maintenant invalide le cache et relance `loadKeywords()` avec le vrai %.
- [x] **Recherche texte (+) et exclusion (-) ignorées avec sémantique** — Appliquées comme post-filtre dans `loadKeywords()` et `_rebuild_filter_cache`.
- [x] **hiddenKWs non restaurés au chargement d'un filtre** — `applyFilterConfig()` restaure maintenant les 👁️.
- [x] **Label "X résultats (Y masqués)" ambigu** — Changé en "X visibles (+ Y masqués)".

---

## 🧩 FR.IA — Extension ComfyUI

### Concept

Pas de nodes complexes. Une **extension légère** qui ajoute un bouton `[FR.IA]` dans la barre de menu de ComfyUI.

```
┌──────────────────────────────────────────────────────────────┐
│ ComfyUI  [File]  [Edit]  [View]  [FR.IA ▾]  [Queue]  [⚙]  │
│                                    │                        │
│                         ┌──────────┴──────────┐             │
│                         │  Open Webpage        │             │
│                         │  Paramètres          │             │
│                         └─────────────────────┘             │
└──────────────────────────────────────────────────────────────┘
```

Les fonctionnalités (Elements Picker, Prompt Enhancer) se font **via le site web** dans un navigateur — l'extension ComfyUI sert juste de pont et de gestion de configuration.

---

### Menu `[FR.IA ▾]`

| Option | Action |
|--------|--------|
| **Open Webpage** | Ouvre `https://kw.holaf.fr` dans un nouvel onglet |
| **Paramètres** | Ouvre une modale dans ComfyUI pour la configuration |

---

### Modale Paramètres

```
┌────────────────────────────────────┐
│ Paramètres FR.IA                   │
│                                    │
│  URL du serveur                    │
│  ┌──────────────────────────────┐  │
│  │ https://kw.holaf.fr          │  │
│  └──────────────────────────────┘  │
│                                    │
│  Clé API                          │
│  ┌──────────────────────────────┐  │
│  │ **************************** │  │
│  └──────────────────────────────┘  │
│                                    │
│  [Sauvegarder]                     │
└────────────────────────────────────┘
```

- **URL du serveur** : défaut `https://kw.holaf.fr`
- **Clé API** : token généré depuis la page de configuration du site web (champ masqué)
- Les paramètres sont persistés dans `localStorage` de ComfyUI

---

### Architecture de l'extension

**3 composants :**

| Composant | Rôle |
|-----------|------|
| **Menu `[FR.IA ▾]`** | Point d'entrée global (ouvrir le site, configurer la clé API) |
| **Node Elements Picker** | Interface interactive pour composer des éléments (filtres, sémantique, random) |
| **Node Prompt Enhancer** | Optimise le prompt via le LLM avec les paramètres de génération |

Les nodes utilisent la clé API stockée par le menu (dans `localStorage`).

---

### Node 1 — `FR.IA Elements Picker`

Interface interactive complète intégrée dans la node ComfyUI (widget JS custom). Pas de paramètres en entrée.

```
┌──────────────────────────────────────┐
│  FR.IA Elements Picker              │
│  [Add saved filter] [Add semantic]   │
│  ┌─ Filtre: "long hair" ──────────┐ │
│  │ └─ [✕]                        │ │
│  ├─ Rech: "flowing dress" ────────┤ │
│  │ └─ [✕]                        │ │
│  └────────────────────────────────┘ │
│  [✔] Add random         [N: 3]      │
│  ┌──────────────────────────────────┐│
│  │ [🔄 Generer]                    ││
│  ├──────────────────────────────────┤│
│  │ Résultat: long hair, ...        ││
│  └──────────────────────────────────┘│
└──────────────────────────────────────┘
```

**Fonctionnalités :** Add saved filter (liste depuis l'API), Add semantic, liste d'éléments avec ✕, Add random + compteur N, bouton Générer, zone résultat.

**Sortie :** `prompt` (STRING)

---

### Node 2 — `FR.IA Prompt Enhancer`

#### Entrées

| Champ | Type | Défaut | Description |
|-------|------|--------|-------------|
| `prompt_source` | STRING | *requis* | Connexion depuis Elements Picker |
| `preset_id` | INT | `0` | ID du preset IA (0 = auto) |
| `style_id` | INT | `0` | ID du style (0 = aucun) |
| `prompt_type` | COMBO | `sdxl` | Types disponibles |
| `output_format` | COMBO | `text` | text / markdown / json |
| `user_text` | STRING | `''` | Texte additionnel (priorité haute) |
| `special_instructions` | STRING | `''` | Instructions spéciales LLM |

L'URL et la clé API sont lues depuis `localStorage` (configurées dans le menu FR.IA).

#### Sorties

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Prompt optimisé |
| `model_used` | STRING | Modèle utilisé |

---

### Site web — Page `/settings`

Nouvelle page sur le site pour gérer la clé API.

```
┌────────────────────────────────────┐
│  Paramètres FR.IA                  │
│  ┌─── Connexion ────────────────┐  │
│  │  Connecté en tant que Holaf   │  │
│  └──────────────────────────────┘  │
│  ┌─── Clé API ─────────────────┐   │
│  │  fr_ia_xxxxxxxxxxxx...xxxx  │   │
│  │  [🔄 Regénérer]  [📋 Copier]│   │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

### Nouveaux endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/auth/token` | Récupérer la clé existante (ou en créer une) |
| `POST` | `/api/auth/token` | Régénérer une nouvelle clé |

### Nouvelle colonne BDD

```python
if "api_token" not in cols_users:
    conn.execute("ALTER TABLE users ADD COLUMN api_token TEXT DEFAULT NULL")
```

### Middleware d'authentification

```python
def _authenticate():
    user_id = _get_current_user_id()
    if user_id: return user_id
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth[7:]
        row = conn.execute("SELECT id FROM users WHERE api_token = ?", (token,)).fetchone()
        if row: return row['id']
    return None
```

### Packaging

```
FR.IA-ComfyUI/
├── __init__.py
├── nodes/
│   ├── __init__.py
│   ├── elements_node.py
│   └── enhance_node.py
├── web/
│   └── js/
│       ├── fria_menu.js
│       └── fria_elements_widget.js
├── README.md
├── requirements.txt
└── LICENSE
```

### Roadmap d'implémentation

| # | Étape | Côté |
|---|-------|------|
| 1 | Migration BDD : colonne `api_token` | Site web |
| 2 | Endpoint `GET/POST /api/auth/token` | Site web |
| 3 | Page `/settings` (UI du token) | Site web |
| 4 | ✅ Middleware auth token | Site web |
| 5 | Menu extension ComfyUI | ComfyUI |
| 6 | Widget Elements Picker | ComfyUI |
| 7 | Node Elements Picker (stub Python) | ComfyUI |
| 8 | Node Prompt Enhancer | ComfyUI |
| 9 | Tests + Déploiement | Les deux |
| 10 | Publication registry | ComfyUI |

**Priorité :** Les étapes 1 à 4 (site web) peuvent être faites en premier. Les étapes 5 à 8 (ComfyUI) peuvent être développées en parallèle avec un token de test ou l'API sans auth.
