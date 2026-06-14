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

### ✅ Résolu session récente (modales, templates, membres)
- **Filtre count retiré** de la liste des membres (visible uniquement dans le détail)
- **Prompts complets** dans le détail membre (plus de troncature 120 caractères)
- **Modales uniformisées** : toutes les modales ont le même pattern (header draggable, ✕ close, overflow hidden, position relative)
- **Paramètres enhance persistés** : preset, type, format, style sauvegardés côté serveur par utilisateur via `/api/settings`
- **Qwen → Qwen-Image** : documentation et exemples mis à jour pour le modèle de génération d'images (20B MMDiT)
- **Templates refactor** : interface deux colonnes (instructions à gauche, exemples à droite), bouton export JSON, checkbox supprimée

### ✅ Résolu cette session (audit + 3 bugs critiques)
- **Audit complet du code** : ~8700 lignes parcourues, 12 bugs identifiés (3 critiques, 3 majeurs, 6 mineurs)
- **🔴 Bug critique #1 : `GET /api/filters` plante pour les filtres union** — `conn.close()` était appelé avant `cur2 = conn.cursor()` dans la branche `filter_type=='union'`. Fix : `conn.close()` déplacé après la boucle.
- **🔴 Bug critique #2 : Recherche sémantique dans `/api/enhance` silencieusement cassée** — La requête `SELECT k.keyword` n'incluait pas l'embedding, donc `r[1]` n'existait pas → try/except avalait l'erreur → les éléments `type=text` de l'EP étaient **ignorés**. Fix : `SELECT k.keyword, ke.embedding` + `r['embedding']`.
- **🔴 Bug critique #3 : Filtre union → simple laisse `filter_type='union'` en BDD** — Le PUT ne remettait `filter_type='simple'` que si `union_member_ids` était absent. Fix : ajouter un `else` pour repasser en `'simple'` quand `data.get('filter_type') != 'union'`.

### ⚠️ À faire au prochain déploiement
1. S'assurer que le serveur pointe vers `/projects/FRIA_Tools` (ou copier le code modifié)
2. Redémarrer le serveur → `_init_db()` applique les migrations
3. Vérifier la console navigateur pour les éventuelles erreurs résiduelles

### ✅ Résolu cette session — FR.IA Terminal (panel flottant)
- **Concept** : panel flottant singleton (pas une node) accessible via le menu FR.IA → 💻 Terminal (2ème item, juste après "Open Webpage"). Adapté depuis CUI-Holaf-Utils/holaf_terminal.js (Holaf, 2025).
- **Pas de mot de passe** : la route WebSocket `/fr_ia/terminal` est ouverte à quiconque peut atteindre le serveur. Usage local uniquement, bandeau d'avertissement rouge toujours visible.
- **Persistance** : taille / position / fullscreen / thème xterm / font-size sauvegardés dans `localStorage.fria_terminal_settings` (debounce 200ms).
- **Singleton** : un seul panel existe, exposé sur `window.friaTerminal` (callback menu via `window.friaTerminal.toggle()`).
- **Pas de conflit avec CUI-Holaf-Utils** : préfixe `/fr_ia/terminal` (vs `/holaf/terminal`), nom global `friaTerminal` (vs `holafTerminal`). xterm.js + xterm-addon-fit.js sont copiés dans `web/js/` mais réutilisent `window.Terminal`/`window.FitAddon` si Holaf les a déjà chargés.
- **Pas de node ComfyUI** : choix utilisateur de ne pas avoir de node draggable — uniquement un panel via le menu.
- **Fichiers** : `FRIA_ComfyUI/terminal.py` (backend PTY), `web/js/fria_terminal_widget.js` (panel singleton + persistance), `web/js/xterm.js` + `xterm-addon-fit.js` (bundles UMD copiés).

### ✅ Résolu cette session (migration serveur cloud + Discord OAuth)
- **Contexte** : déplacement du serveur backend de `kw.holaf.fr` vers une machine cloud.
- **Discord OAuth — placeholder `votre_client_id_ici` dans l'URL** : le `.env` sur le cloud était absent ou incomplet, `DISCORD_CLIENT_ID` non défini. Fix : créer le `.env` avec les 4 variables (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, GUILD_ID optionnel).
- **Discord OAuth — `mismatching_state: CSRF Warning! State not equal in request and response`** : `SECRET_KEY` non défini dans `.env` → `app.py` tombe sur `os.urandom(24).hex()` qui régénère un secret différent à chaque redémarrage, invalidant le `state` posé en session au moment du callback. Fix : ajouter `SECRET_KEY=<token_hex(32)>` dans `.env`, secret fixe et persistant.
- **Discord OAuth — `redirect_uri OAuth2 non valide`** : URL du `.env` pas alignée avec celle déclarée sur https://discord.com/developers/applications (discord compare strictement protocole + domaine + chemin + port). Fix : ajouter `DISCORD_REDIRECT_URI=https://<nouveau-domaine>/api/auth/discord/callback` dans `.env` et la même URL dans les Redirects Discord. **Note pour plus tard** : si reverse-proxy HTTPS devant Flask, ajouter `from werkzeug.middleware.proxy_fix import ProxyFix; app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)` pour que `request.url_root` reflète bien le HTTPS.
- **Widgets ComfyUI — styles/presets KO après migration** : `fria_ideogram4_widget.js`, `fria_enhance_widget.js`, `fria_elements_widget.js` avaient `getApiUrl = () => "https://kw.holaf.fr/api"` en dur. Le node Python envoyait ses requêtes vers l'ancien serveur, le DOM widget chargeait les presets/styles depuis le mauvais backend. Fix : `getApiUrl()` lit maintenant `localStorage.FRIA_config.serverUrl` (configuré via menu FR.IA → Compte) avec fallback kw.holaf.fr, cohérent avec `fria_menu.js` qui lisait déjà la config. Commit `249218e` — `feat(widgets): make API URL configurable via localStorage`.

### 📋 Checklist migration serveur cloud (à suivre la prochaine fois)
1. Copier `.env` complet sur le nouveau serveur (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI aligné avec Discord, SECRET_KEY fixe, GUILD_ID optionnel)
2. Vérifier alignement exact `DISCORD_REDIRECT_URI` ↔ Redirects sur Discord Dev Portal
3. Si reverse-proxy HTTPS : ajouter `ProxyFix` (sinon `request.url_root` = `http://...` au lieu de `https://...`)
4. Pull du repo + restart extension ComfyUI → `web/js/*` rechargés
5. Côté user dans ComfyUI : menu **FR.IA → Compte** → mettre la nouvelle `URL du serveur` (sans `/api` final, ajouté auto) + clé API + vider cache navigateur (`Ctrl+Shift+R`)
6. Tester login Discord + génération d'un node Ideogram4 (vérifier que presets/styles viennent du bon backend)

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
- [ ] Les 5 mieux notés par type sont passés au LLM en few-shot (actuellement : prompt système hardcodé — bientôt remplacé par les templates personnalisables)
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
| `prompt_templates` | id, user_id NULL=global, prompt_type, output_format, system_prompt TEXT, examples TEXT JSON, is_default BOOLEAN, created_at, updated_at |

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
- [x] Modales uniformes : toutes draggables, pas d'alert() natif, même pattern graphique
- [x] Modales redimensionnables : poignées 8 directions (coins + bords) sur la modale settings

## 👥 Gestion des membres
- [x] Liste des membres avec avatar, nom, rôle
- [x] Clic sur un membre → détail avec :
  - [x] Grande photo (256px)
  - [x] Stats : nombre de filtres, nombre de prompts
  - [x] Favoris : type de prompt préféré, style préféré
  - [x] Historique : 15 derniers prompts (texte complet)
- [x] Endpoint API dédié : `GET /api/members/<user_id>`

### Phase 1 — Fondations ✅
- [x] Toutes les tâches sont terminées

### Phase 2 — Intégration Elements Picker ✅
- [x] Toutes les tâches sont terminées

### Phase 3 — Templates personnalisables ✅ TERMINÉE
- [x] **Nouvelle table BDD** `prompt_templates` : id, user_id, prompt_type, output_format, system_prompt TEXT, examples JSON, is_default BOOLEAN, created_at, updated_at
- [x] **Migration BDD** : création de la table
- [x] **Templates par défaut** : un pour chaque combinaison (type × format) avec :
  - [x] Rôle / explication générique du LLM
  - [x] Doc spécifique pour construire le prompt (SDXL, SD1.5, Flux, Anima, Qwen-Image, Liste)
  - [x] Explication du format de sortie attendu
  - [x] 3 exemples par template
  - [x] Consignes : préserver le style, pas de texte hors-prompt, etc.
- [x] **API CRUD** `/api/prompts/templates` : GET (liste), POST (créer), PUT (modifier), DELETE
- [x] **Résolution dans `/api/enhance`** : chercher template user → template global → template par type → template par défaut
- [x] **UI de personnalisation sur le site** :
  - [x] Onglet "Templates" dans la config IA
  - [x] Sélecteur type × format → charge le template
  - [x] Édition du prompt système (textarea)
  - [x] Gestion des exemples (ajouter/supprimer liste)
  - [x] Sauvegarde en template personnel
  - [x] Reset vers le template par défaut
  - [x] Export du template en JSON (📥 Exporter)
- [x] **Paramètres enhance persistés** : preset, type, format, style sauvegardés côté serveur par utilisateur

### Phase 4 — Polish & Bonus ⬜ (non commencée)
- [x] **Simplification des prompts : format de sortie = type de prompt** (juin 2026) — Le dropdown "Format" (text/markdown/json) a été retiré du panneau enhance et de la node ComfyUI Enhance. Le format est désormais déterminé par `prompt_type` (via `_default_format_for_type()` dans `app.py`). L'éditeur de templates garde le choix `output_format` pour surcharger par type.
- [x] **Ideogram 4 : backend support** (juin 2026) — Nouveau type `ideogram4` dans `_DEFAULT_FORMAT_BY_TYPE` (→ json). Template système par défaut dans `_init_db()` avec le schéma JSON complet de la doc Ideogram 4 (key ordering strict, format bbox [y_min,x_min,y_max,x_max] en coords 0-1000, palette #RRGGBB uppercase). Champs `width` et `height` ajoutés à `/api/enhance`. Branche dédiée dans `enhance_prompt` qui formate l'entrée en sections nommées (GENERAL DESCRIPTION + ELEMENTS TO PLACE + IMAGE DIMENSIONS + STYLE) au lieu du format avec priorités. Bump `templates_version` → 4.
- [x] **Ideogram 4 : bboxes obligatoires** (juin 2026) — Mise à jour du template système Ideogram 4 pour rendre `bbox` **obligatoire** pour chaque élément listé (et non plus "OPTIONAL"). Ajout de tables de référence par aspect ratio (1:1, 16:9, 9:16) avec les zones bbox classiques (centre, coins, bandes). Renforcement des instructions : "the user wants to SEE where each element is placed" et "even a rough guess is better than no bbox". Bump `templates_version` → 4.
- [ ] **Ideogram 4 : node ComfyUI dédiée** — Widget DOM custom avec : seed, style, width, height, description générale, 4 éléments séparés. Bouton "Generate" qui appelle `/api/enhance` avec `prompt_type=ideogram4`.
- [ ] **Ideogram 4 : node preview** — Affiche le template de l'image (rectangle avec ratio width:height) + bounding boxes dessinées à partir du JSON, avec le texte de chaque `desc` affiché dans la boîte. Pass-through de `prompt` pour chainage.
- [ ] Checkbox Prompt négatif
- [ ] Base de prompts négatifs
- [ ] Instructions spéciales dans le prompt système (backend OK, UI manquante)
- [ ] Export du résultat
- [ ] Drag & drop des mots-clés vers le générateur (UI générale)

### Phase 5 — Audit (juin 2026) ⬜ (à planifier)
Bugs identifiés lors de l'audit, classés par priorité :

**🟠 Majeurs (à planifier) :**
- [ ] **Seed ComfyUI ignoré dans `/api/enhance`** — `random.choice()` (RNG global) + `ORDER BY RANDOM()` (SQLite RNG) ignorent le `seed` envoyé par la node. Cohérence à faire avec `/api/generate` qui utilise `rng = random.Random(seed)`.
- [ ] **`loadColWidths()` redimensionne les colonnes cachées** — La fonction applique la largeur à TOUS les `<th>`, y compris `score-header` qui est `hidden` en mode texte. Conséquence : espace fantôme quand on passe du sémantique au texte.
- [ ] **`user_id` inutilisé dans 4 endpoints** — `list_keywords()`, `list_sections()`, `stats()`, `presets()`. Pas de bug, mais fausse l'intent (filtre user-side annoncé) et déclenche les linters.

**🟡 Mineurs (nettoyage) :**
- [ ] **Code mort : `_loadApiKeySettings()` jamais appelé** — Garder `loadApiKeySettings()` (appelé) et supprimer la version `_loadApiKeySettings()`.
- [ ] **Code mort dans `enhance_prompt`** — `format_instruction` (ligne 2191) calculé mais inutilisé ; query `prompt_examples` (lignes 2194-2199) écrasée par le système de templates.
- [ ] **Bug n°11 : variables `cur`/`cur2`/`conn`/`conn2` multiples dans `enhance_prompt`** — Renommer en `_db_ep`, `_db_rand`, `_db_template` etc. pour clarifier la portée.
- [ ] **Troncature inesthétique dans `exporter.py`** — Le footer tronque la liste des catégories concaténées à 100 caractères, au milieu d'un titre.
- [ ] **README ComfyUI : nom de dossier contradictoire** — `git clone ... FRIA_Tools` mais l'avertissement dit `FRIA_Keywords`. Incohérent.

**⚠️ Points d'attention :**
- [ ] **Vérifier persistance des paramètres enhance** — L'API `/api/settings` existe et stocke en BDD, mais à vérifier que le frontend appelle bien PUT après chaque changement de preset/type/format/style.
- [ ] **UI `special_instructions`** — Annoncée comme "backend OK, UI manquante" : confirmé, juste un `<textarea>` à ajouter dans le panneau enhance.
- [ ] **Système `prompt_examples` (votes)** — L'API existe mais toute l'UI est absente. Le code de vote dans `enhance_prompt` n'est plus utilisé (remplacé par les templates). À nettoyer ou à implémenter l'UI.
- [ ] **Page `/settings` ComfyUI** — La roadmap ComfyUI annonce une "page `/settings`" mais en réalité c'est un onglet "Compte" dans la modale Paramètres. Pas de route `/settings` dans `app.py`.

### Phase 6 — Frontend (UI générale, à planifier)
- [ ] Drag & drop des mots-clés vers le générateur
- [ ] Double-clic sur un mot-clé → ajoute au générateur
- [ ] Code couleur par section (dans le tableau des mots-clés)
- [ ] Compteur de tokens
- [ ] Bouton "Tout recharger" → regénère le cache pour tous les filtres
- [ ] Slider de confiance minimale dans le générateur (panneau droit)

### Phase 7 — Community & Management

#### Feature Requests
- [ ] Page `/features` listant les demandes de fonctionnalités des utilisateurs
- [ ] Système de vote (👍/👎) sur chaque feature request
- [ ] Statuts : "proposée", "en cours", "faite", "refusée"
- [ ] Filtrer par statut, tri par votes/popularité
- [ ] Suggestion automatique : à la saisie, chercher si une feature similaire existe déjà
- [ ] Notification quand une feature change de statut

#### User Prompts
- [ ] Page `/prompts` : bibliothèque de prompts partagés par les utilisateurs
- [ ] Formulaire d'ajout : titre, prompt texte, type (SDXL/Flux/Ideogram4...), tags libres
- [ ] Édition : l'auteur peut modifier son prompt après publication
- [ ] Recherche de doublons : avant validation, comparer le nouveau prompt à la base via LLM (similarité sémantique) et afficher les prompts proches existants
- [ ] Système de rating (👍/👎) comme les feature requests
- [ ] Filtres : par type, par note minimale, par tag, par auteur
- [ ] Modération : signaler un prompt inapproprié, les admins peuvent cacher/supprimer
- [ ] Export d'un prompt vers le générateur (clic → charge dans l'enhancer)

#### Technique
- [ ] Nouvelles tables BDD : `feature_requests` (id, user_id, title, description, status, created_at), `feature_votes` (id, feature_id, user_id, vote), `user_prompts` (id, user_id, title, prompt_text, prompt_type, tags, rating, created_at), `prompt_ratings` (id, prompt_id, user_id, vote)
- [ ] Nouveaux endpoints API : CRUD feature requests + votes, CRUD user prompts + ratings, dédoublonnage LLM (`POST /api/prompts/detect-duplicates`)
- [ ] Middleware admin pour la modération

---

## 🐛 Bugs identifiés

### Backend — app.py

- [x] **CRITIQUE : 500 sur GET /api/presets et GET /api/styles** — Résolu. Cause : `sqlite3.Row` n'a pas de méthode `.get()`. Fix : helper `_row_get()` + utilisation de `safeJson()` côté frontend.
- [x] **CRITIQUE : GET /api/filters plante si l'utilisateur a un filtre union** — Résolu (audit 2026-06). Cause : `conn.close()` appelé avant `cur2 = conn.cursor()` dans la branche `filter_type=='union'`. Fix : `conn.close()` déplacé après la boucle for.
- [x] **CRITIQUE : Recherche sémantique dans `/api/enhance` silencieusement cassée** — Résolu (audit 2026-06). Cause : la requête `SELECT k.keyword` n'incluait pas l'embedding, donc `r[1]` n'existait pas → try/except avalait l'erreur → éléments `type=text` EP ignorés. Fix : `SELECT k.keyword, ke.embedding` + `r['embedding']`.
- [x] **CRITIQUE : Filtre union → simple laisse `filter_type='union'` en BDD** — Résolu (audit 2026-06). Cause : le PUT ne remettait `filter_type='simple'` que si `union_member_ids` était absent. Fix : ajouter un `else` pour repasser en `'simple'`.
- [x] **Bug : URLs LLM locales invalides pour les utilisateurs distants** — Résolu avec l'option "Client-side" dans les presets.
- [x] **Bug : Mauvaise URL pour le endpoint members** — Corrigé.
- [x] **Bug : PUT /api/filters/<id> plante (KeyError)** — Corrigé.
- [x] **Bug : Fuite de connexion BDD dans `discord_callback()`** — Corrigé (2nd `get_db()` supprimé).
- [x] **Bug : Message d'erreur obsolète** — "Token HF" → "Serveur Ollama inaccessible".
- [x] **Commentaire obsolète** — "embeddings HF" → "embeddings Ollama".
- [x] **`_admin_required()` défini 2 fois** — Suppression de la 2ème définition (moins robuste).
- [x] **FK constraint bloquait DELETE styles/presets** — `NULL` des références dans `generated_prompts` avant suppression.
- [x] **Variable inutilisée** — `stats()`, `sections()`, `list_keywords()`, `presets()` calculent `user_id` sans l'utiliser. (Audit 2026-06 : confirmé sur 4 endpoints, à nettoyer.)
- [x] **Colonne `config` pas mise à jour au Save** — Résolu (PUT /api/filters/<id> écrit maintenant la config).
- [x] **Preview `total` plafonné à 20** — Résolu (COUNT(*) séparé du LIMIT).
- [x] **Cache sémantique ignorait section/nsfw/hidden_ids/search_neg** — Résolu (pré-filtre SQL + post-filtre).
- [ ] **Seed ComfyUI ignoré dans `/api/enhance`** — `random.choice()` (RNG global) + `ORDER BY RANDOM()` (SQLite RNG) ignorent le `seed`. Cohérence à faire avec `/api/generate`. (Audit 2026-06)
- [ ] **Code mort dans `enhance_prompt`** — `format_instruction` (ligne 2191) et query `prompt_examples` (lignes 2194-2199) ne sont plus utilisés. (Audit 2026-06)

### Backend — parser.py

- [x] **Parser ignorait les chiffres romains avec L, C, D** — `[IVX]+` → `[IVXLCDM]+` pour supporter XL, LI, etc.

### Backend — auth.py

- [x] **Imports inutilisés** — Supprimés (`json`, `Path`, `redirect`, `request`, `jsonify`, `current_app`).

### Backend — exporter.py

- [x] **Export sans `ORDER BY` cohérent** — La roadmap indiquait "exporte dans l'ordre d'insertion". En fait, `export_to_markdown` a bien `ORDER BY section_id, subsection_id, id` (ligne 13). Résolu, c'était juste une note de roadmap obsolète.
- [ ] **Troncature inesthétique du footer** — Le `[:100]` coupe la liste concaténée des catégories au milieu d'un titre. (Audit 2026-06, mineur)

### Frontend — index.html

- [x] **Potentiel : `filtersBar` déclaré mais plus utilisé** — La variable `filtersBar` est référencée dans `const filtersBar = $('filters-bar')` mais n'est plus utilisée dans le code (remplacée par `document.getElementById('filters-bar')`). Confirmé (audit 2026-06), peut être supprimée.
- [ ] **Score header visible en mode texte** — `scoreHeader` est initialisé comme `hidden` mais pourrait être affecté par `loadColWidths` qui applique des largeurs à tous les `<th>` sans vérifier si la colonne est visible. (Audit 2026-06, à corriger en Phase 5)
- [x] **Unreachable code dans deleteUser/adminClearDb** — Code après `return;` déplacé dans le callback.
- [x] **`delStyle()` silencieux** — Ajout d'affichage d'erreur.
- [x] **Confidence slider ne refetchait pas l'API** — Maintenant invalide le cache et relance `loadKeywords()` avec le vrai %.
- [x] **Recherche texte (+) et exclusion (-) ignorées avec sémantique** — Appliquées comme post-filtre dans `loadKeywords()` et `_rebuild_filter_cache`.
- [x] **hiddenKWs non restaurés au chargement d'un filtre** — `applyFilterConfig()` restaure maintenant les 👁️.
- [x] **Label "X résultats (Y masqués)" ambigu** — Changé en "X visibles (+ Y masqués)".
- [ ] **Code mort : `_loadApiKeySettings()` jamais appelé** — Garder `loadApiKeySettings()` (ligne 1601, appelé), supprimer `_loadApiKeySettings()` (ligne 1605, jamais appelé). (Audit 2026-06, mineur)

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

### Site web — Onglet "Compte" dans la modale Paramètres

**Note (audit 2026-06) :** La roadmap initiale parlait d'une "page `/settings`" dédiée. En fait, c'est implémenté comme un onglet "Compte" dans la modale Paramètres de `index.html` (ligne 668). Pas de route `/settings` dans `app.py` — l'utilisateur accède via le bouton "Paramètres" du header. Le code backend (`/api/auth/token`) est bien en place, seule l'UI a été intégrée différemment.

```
┌────────────────────────────────────┐
│  Paramètres FR.IA  [Compte]         │
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

| # | Étape | Côté | Statut |
|---|-------|------|--------|
| 1 | Migration BDD : colonne `api_token` | Site web | ✅ |
| 2 | Endpoint `GET/POST /api/auth/token` | Site web | ✅ |
| 3 | UI du token (onglet Compte dans modale Paramètres) | Site web | ✅ |
| 4 | ✅ Middleware auth token | Site web | ✅ |
| 5 | Menu extension ComfyUI | ComfyUI | ✅ |
| 6 | Widget Elements Picker | ComfyUI | ✅ |
| 7 | Node Elements Picker (stub Python) | ComfyUI | ✅ |
| 8 | Node Prompt Enhancer | ComfyUI | ✅ |
| 9 | Tests + Déploiement | Les deux | ⏳ |
| 10 | Publication registry | ComfyUI | ⬜ |

**Note (audit 2026-06) :** Le `README.md` de ComfyUI contient une instruction contradictoire :
- Commande : `git clone ... FRIA_Tools` → dossier `FRIA_Tools`
- Avertissement : "Le nom du dossier doit être **`FRIA_Keywords`**"
Pour que Python importe `FRIA_ComfyUI`, le dossier parent doit s'appeler **comme le repo GitHub** (`FRIA_Tools`). L'avertissement est faux. À corriger dans le README.

**Priorité :** Les étapes 1 à 4 (site web) peuvent être faites en premier. Les étapes 5 à 8 (ComfyUI) peuvent être développées en parallèle avec un token de test ou l'API sans auth.
