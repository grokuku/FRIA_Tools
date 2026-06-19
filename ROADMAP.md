# Roadmap — FR.IA Helper

> Fichier vivant pour noter les idées, fonctionnalités et réflexions.

---

## 🔍 Audit complet du code — Rapport de bugs (20/06/2026)

> Analyse exhaustive de tous les fichiers du projet (backend, frontend, ComfyUI).
> Aucune correction appliquée — rapport uniquement.

### 🔴 Bugs critiques (runtime errors)

| # | Fichier | Bug | Impact |
|---|---------|-----|-------|
| **C1** | `backend/routes/enhance.py` | `_prepare_validation_pass()` référence la variable `critique_prompt` qui n'existe pas dans la fonction. Devrait être `user_content` (défini plus haut comme `current_output`). | **NameError** au runtime dès qu'une passe de validation Ideogram 4 est déclenchée. Le debug de validation plante, mais la requête LLM elle-même est déjà construite avant le crash — donc l'erreur se produit à la construction du dict de debug, cassant l'appel de validation. |
| **C2** | `backend/routes/keywords.py` | `list_subsections()` (ligne ~499) utilise `FROM keywords` **sans alias `k`**, mais `_privacy_filter()` retourne une clause avec `k.privacy_status`. SQLite lève `no such column: k.privacy_status`. | **500 silencieux** — le frontend `loadSubsections()` a un `catch {}` qui avale l'erreur. Les sous-sections ne se chargent jamais (dropdown vide). |
| **C3** | `backend/routes/keywords.py` | `check_keyword_duplicates()` (ligne ~667) utilise `FROM keywords` **sans alias `k`** dans la requête de vérification exacte, mais `_privacy_filter()` retourne `k.privacy_status`. | **500** lors de la vérification de doublons exacts. La branche sémantique (qui utilise `FROM keywords k`) fonctionne, mais la branche exacte plante. |

### 🟠 Bugs majeurs (sécurité / logique)

| # | Fichier | Bug | Impact |
|---|---------|-----|-------|
| **M1** | `backend/routes/enhance.py` | Recherche sémantique des EP elements dans `_prepare_enhance()` : `SELECT k.keyword, ke.embedding FROM keywords k JOIN keyword_embeddings ke ...` **sans `_privacy_filter`**. Charge TOUS les keywords, y compris privés d'autres utilisateurs. | **Fuite de privacy** — un keyword privé d'un autre user peut finir dans le prompt généré. |
| **M2** | `backend/routes/generate.py` | Recherche sémantique dans `generate_prompt()` : `SELECT k.id, ke.embedding FROM keywords k JOIN keyword_embeddings ke ...` **sans `_privacy_filter`**. Même problème que M1. | **Fuite de privacy** — un keyword privé peut être pioché aléatoirement dans le prompt. |
| **M3** | `backend/routes/enhance.py` | `keywords_llm_process()` : la requête `/models` pour détecter `max_context` envoie `headers=llm_config.get('headers', {})` mais `llm_config` n'a **pas de clé `headers`** (seulement `base_url` et `api_key`). Le header d'auth est manquant. | `/models` échoue pour les APIs qui requièrent une auth. `max_context` tombe toujours sur le fallback heuristique (peu fiable). |
| **M4** | `backend/routes/export.py` | Code orphelin en fin de fichier : `result['output'] = corrected` et `return result` après le `return send_file(...)` de `export_md()`. Variables `result` et `corrected` non définies. Code unreachable mais parasite. | Pas d'erreur runtime (unreachable), mais code mort confus qui provient visiblement d'un copier-coller d'une fonction de validation. |
| **M5** | `backend/routes/enhance.py` | `_prepare_enhance()` ouvre **6 connexions DB séparées** (`conn = get_db()` / `conn.close()`) sans `try/finally`. Si une exception se produit entre `get_db()` et `close()`, la connexion fuit. | **Fuite de connexions** SQLite possible sous charge d'erreur. SQLite a un pool limité. |
| **M6** | `backend/routes/enhance.py` | `repeat_penalty` (param Ollama) et `frequency_penalty` (param OpenAI) sont envoyés **simultanément** dans `llm_request`. | Comportement imprévisible selon le backend LLM : OpenAI ignore `repeat_penalty`, Ollama peut ignorer `frequency_penalty`. Pas un crash mais résultats incohérents. |

### 🟡 Bugs mineurs (code quality / performance)

| # | Fichier | Bug | Impact |
|---|---------|-----|-------|
| **L1** | `backend/routes/keywords.py` | `bulk_import_keywords()` appelle `_regenerate_keyword_embedding()` **pour chaque keyword** individuellement. | Très lent pour les imports en masse (1 appel API embedding par keyword). Devrait batcher. |
| **L2** | `backend/routes/keywords.py` | `scan_keyword_duplicates()` : comparaison sémantique **O(n²)** — compare chaque paire de keywords. | Bloque pour les grandes bases (timeout probable au-delà de ~5000 keywords). |
| **L3** | `backend/routes/enhance.py` | `_load_enhance_session()` et `_update_enhance_session()` : le `except ValueError: raise` capture TOUTES les `ValueError`, y compris celle de `strptime` si le format `expires_at` est corrompu. | Message d'erreur confus si le format de date est invalide (au lieu de "Session expirée"). |
| **L4** | `backend/routes/enhance.py` | `_prepare_enhance()` : `random.choice()` et `ORDER BY RANDOM()` pour les EP elements et random keywords **ignorent le seed**. `/api/generate` utilise `rng = random.Random(seed)` mais pas `/api/enhance`. | Non-déterminisme : le même seed ne produit pas le même prompt. *(Déjà noté dans la roadmap, confirmé.)* |
| **L5** | `frontend/js/app-core.js` | `filtersBar` toujours déclaré (`const filtersBar = $('filters-bar')`) bien que la roadmap le marque comme résolu. | Code mort — variable inutilisée. **La roadmap est inexacte** sur ce point (marqué `[x]` mais le code est toujours là). |
| **L6** | `frontend/js/app-filters.js` | `_loadApiKeySettings()` défini mais jamais appelé (c'est `loadApiKeySettings()` qui est appelé, qui appelle `loadApiKey()`). | Code mort. *(Déjà noté dans la roadmap.)* |
| **L7** | `frontend/js/app-admin.js` | `copyEnhanceOutput()` utilise `document.execCommand('copy')` (déprécié). | Ne fonctionne plus sur certains navigateurs modernes. Devrait utiliser `navigator.clipboard.writeText()`. |
| **L8** | `backend/routes/import_export.py` | `import_md()` : variables `delete_after` et `tmp` peuvent être non définies si une exception se produit avant leur assignation. Le `finally` les référence dans un `try/except` qui avale l'erreur. | Erreur silencieuse dans le `finally`, pas de crash mais masquage potentiel d'erreurs. |
| **L9** | `backend/routes/enhance.py` | `_prepare_enhance()` : le check de doublon pour les keywords dans `_create_keyword()` (keywords.py:117) est **global** (tous les keywords, y compris privés d'autres users). | Un user ne peut pas créer un keyword qui matche le keyword privé d'un autre user, même s'il ne le voit pas. |
| **L10** | `FRIA_ComfyUI/README.md` | Contradiction : `git clone ... FRIA_Tools` mais l'avertissement dit `FRIA_Keywords`. La roadmap dit de corriger mais le README n'a pas été mis à jour. | Confusion pour les utilisateurs. Le bon nom est `FRIA_Tools` (le repo s'appelle ainsi). |
| **L11** | `backend/exporter.py` | `[:100]` dans le footer tronque la liste des catégories au milieu d'un titre. | Export markdown avec footer coupé. *(Déjà noté dans la roadmap.)* |

### ⚠️ Inexactitudes de la roadmap vs code actuel

| Point | Roadmap dit | Code actuel | Correction |
|------|------------|-------------|------------|
| `filtersBar` supprimé | `[x]` (résolu) | Toujours présent dans `app-core.js:17` | **À décocher** — le code mort est toujours là |
| README ComfyUI corrigé | Note dit "corriger l'avertissement obsolète FRIA_Keywords" | README toujours contradictoire (`git clone ... FRIA_Tools` vs `⚠️ Le nom du dossier doit être FRIA_Keywords`) | **Toujours en attente** |
| Seed ignoré dans `/api/enhance` | `[ ]` non résolu | Confirmé : `random.choice()` et `ORDER BY RANDOM()` toujours utilisés | Roadmap correcte ✅ |
| `_loadApiKeySettings()` | `[ ]` non résolu | Confirmé : toujours défini, jamais appelé | Roadmap correcte ✅ |
| `loadColWidths` colonnes cachées | `[ ]` non résolu | Confirmé : applique largeurs à tous les `<th>` y compris `score-header` hidden | Roadmap correcte ✅ |
| Variables `cur`/`cur2`/`conn`/`conn2` | `[ ]` non résolu | Confirmé : `_prepare_enhance` a 6 `get_db()`, `_finish_enhance_pass1` utilise `conn2` | Roadmap correcte ✅ |
| Troncature `exporter.py` | `[ ]` non résolu | Confirmé : `[:100]` toujours présent | Roadmap correcte ✅ |

### 📊 Résumé

| Sévérité | Count | Nouveaux vs connus |
|-----------|-------|-------------------|
| 🔴 Critique (crash) | 3 | 3 nouveaux (C1, C2, C3) |
| 🟠 Majeur | 6 | 4 nouveaux (M1, M2, M3, M4), 2 connus (M5, M6) |
| 🟡 Mineur | 11 | 3 nouveaux (L7, L8, L9), 8 connus |
| ⚠️ Roadmap inexacte | 2 | `filtersBar` + README |
| **Total nouveaux** | **10** | |

---

## 🚀 Session en cours (19/06/2026)

### ✅ Blobby Companion — Intégration complète
- **Intégration** : personnage interactif 100% Canvas 2D qui vit sur le canvas ComfyUI.
- **Activation** : via menu FR.IA > "Activer Blobby" avec badge ON/OFF + option "💬 Chat" visible seulement quand Blobby est actif.
- **Clic droit** plus utilisé — tout se fait depuis le menu FR.IA.

### ✅ Chat Blobby
- **Modale de discussion** flottante, déplaçable, redimensionnable (`resize: both`), avec persistance position/taille.
- **Slider de transparence** dans l'en-tête (10-100%), persisté.
- **Historique** sauvegardé dans `localStorage.FRIA_config.blobbyData.chatHistory` (50 derniers messages).
- **Barre de contexte** en bas : estime les tokens (`~XXX tokens | YYYY max`) avec code couleur selon le ratio.
- **Caractère Groot-like** : Blobby ne répond que "Blobby" avec variations expressives.
- **Humeur influencée** : le prompt LLM inclut l'humeur actuelle (happy/surprised/sleepy).
- **Provider LLM** configurable dans les paramètres (dropdown).
- **Sync serveur** vers backend FR.IA avec debounce 2s + indicateur visuel ⬤ (vert/jaune/rouge).

### ✅ Paramètres Blobby (3 onglets)
- **Général** : choix du provider LLM + slider FPS animation (0-165).
- **Caractère** : textarea éditable pour la personnalité, reset au défaut.
- **Apparence** :
  - Particules (10-120)
  - Transparences : Corps (%), Cerveau (%)
  - Yeux : Hauteur, Écartement, Taille
  - Bouche : Hauteur, Taille
  - Cerveau : Taille
  - Couleurs par humeur : 4 color pickers (😊 Heureux, 😮 Surpris, 😴 Endormi, 😐 Neutre)
- Modale déplaçable et redimensionnable.

### ✅ Physique et rendu
- **Collision avec les nœuds** : les titres des nœuds sont inclus dans la bounding box (`getNodeBounds()` utilise `LiteGraph.NODE_TITLE_HEIGHT`).
- **Framerate-indépendant** : toutes les animations (position, amortissement, bouche, organes) utilisent `deltaTime * 60`.
- **Performance** : `setInterval(33ms)` + `setDirty(false, true)` — pas de conflit avec le rAF de ComfyUI.
- **Apparence** : toutes les propriétés visuelles sont configurables via localStorage.

### ✅ Filtres — Bug privacy_status
- **Problème** : `_rebuild_filter_cache()` utilisait `privacy_status = 'public'` en dur, ignorant les mots-clés privés (`'private'`) et en attente (`'public_pending'`).
- **Fix** : passage de `user_id` à `_rebuild_filter_cache()`, utilisation de `_privacy_filter(user_id)` pour les trois appels (POST, PUT, refresh).

### ✅ Bulk Import — Nouveautés
- **Onglets** : modale avec 2 onglets (Import / Génération IA).
- **Import** : checkbox "Convertir via LLM" + dropdown provider + niveau NSFW (SFW/Sexy/Érotique/Porno).
- **Génération IA** : textarea d'instructions + dropdown provider + niveau NSFW → résultat parsé en tableau éditable dans l'onglet Import.
- **LLM instruction stricte** : format `keyword | description | section | subsection | nsfw(0/1)` imposé, pas de texte hors-format.
- **Persistance choix** : provider et niveau NSFW sauvegardés dans `FRIA_config`.

### ✅ Scan des doublons
- **Timeout 60s supprimé** : plus de limite arbitraire.
- **Bouton Annuler** : barre de progression avec bouton "✕ Annuler", annulation propre via `AbortController`.
- **Résultats scrollables** : modale dédiée large (700px) avec `overflow-y: auto`.

### ✅ API — Améliorations
- **`/api/keywords/llm-process`** : nouvel endpoint simple pour les appels LLM (bulk import / chat).
- **Retourne `max_context`** : détecté via API `/models` du provider, fallback par nom de modèle, défaut 4096.
- **`/api/settings`** : les données Blobby sont mergées avec les settings existants pour ne pas les écraser.

### ✅ Normalisation des données : `prompt_type` → `template_id` (migration radicale)
- **Problème** : `prompt_type` était utilisé à la fois comme catégorie (slug texte) et comme identifiant fonctionnel, ce qui créait de la confusion et des bugs de persistance (renommer un template cassait les workflows).
- **Solution** : suppression pure et simple du champ `prompt_type` partout. Chaque template est désormais identifié par son `id` entier unique.
- **BDD** :
  - `prompt_templates.prompt_type` → supprimé
  - `prompt_templates.name` → reste l'affichage humain
  - `generated_prompts.prompt_type` → `generated_prompts.template_id` (FK INTEGER)
  - `prompt_examples.type` → `prompt_examples.template_id` (FK INTEGER)
  - Contrainte `UNIQUE(user_id, prompt_type, output_format)` → supprimée (l'`id` est l'unique identifiant)
  - Migrations avec `DROP/CREATE/INSERT` pour les tables existantes
  - Le `output_format` est conservé dans la table (utilisé pour validation future)
- **Backend** :
  - `enhance.py` `_prepare_enhance()` reçoit `template_id` (INT), résout le template par `id` via `WHERE id = ? AND (is_public OR is_default OR user_id)`, lit `output_format` du template
  - Alias `prompt_type` conservé temporairement (cast en INT) pour rétrocompatibilité, à retirer après migration
  - Branche "Ideogram 4" dédiée supprimée du code, le format JSON est maintenant piloté par le `output_format` du template
  - Templates par défaut : 1 par type (`SDXL`, `Flux`, etc. pour `output_format='text'`), `Ideogram 4` pour `output_format='json'`
  - Fonctions `_default_format_for_type()` / `_DEFAULT_FORMAT_BY_TYPE` supprimées
  - Fonction `_migrate_templates_to_english()` supprimée (migration manuelle faite)
- **Frontend site web** :
  - Dropdown `enhance-type` utilise `t.id` comme valeur
  - `doEnhance()` envoie `template_id` au lieu de `prompt_type`
  - Stats membre (`/api/members/<id>`) utilisent le `name` du template via jointure
- **Nodes Python ComfyUI** :
  - `enhance_node.py`, `prep_node.py`, `ideogram4_node.py`, `ideogram_prep_node.py` : `prompt_type` STRING → `template_id` INT
  - Conversion défensive contre `''` (ComfyUI peut envoyer une string vide pour un INT)
- **Widgets JS ComfyUI** :
  - 4 widgets réécrits (`fria_enhance_widget.js`, `fria_prep_widget.js`, `fria_ideogram4_widget.js`, `fria_ideogram_prep_widget.js`)
  - Pattern commun : `Promise.all` pour attendre les listes, flag `_friaRestored` pour éviter la sync prématurée, callback natif appelé après `w.value = val` pour propager au graph
  - `ResizeObserver` retiré (causait un bug de grid collapse au release de la souris), remplacé par `gridTemplateColumns = "1fr 1fr"` forcé
  - Dropdown Template peuplé avec `item.id` (INT)
  - Payload envoie `template_id` (pas `prompt_type`)
- **Vérifications** : syntaxe Python + JS : OK

### ✅ Bug "Dropdown Template non synchronisé avec le widget natif" — RÉSOLU
- **Symptôme initial** : après sélection d'un template autre que SDXL, le backend recevait `prompt_type='sdxl'` (premier template de la liste). F5 = retour à SDXL.
- **Cause racine** : le widget natif STRING `prompt_type` n'était pas synchronisé avec le dropdown DOM, ou la valeur était écrasée.
- **Fix appliqué** :
  - Remplacement `prompt_type` STRING → `template_id` INT dans les nodes Python
  - Dropdown DOM peuplé avec `item.id`
  - `syncNativeWidgets()` appelle `widget.callback(val)` après `w.value = val` pour propager au graph ComfyUI
  - `restoreFromNativeWidgets()` lit le widget natif comme un INT (gère le cas 0)
  - Flag `_friaRestored` empêche la sync prématurée pendant le chargement
  - `Promise.all` pour attendre toutes les listes avant la première sync
  - Le widget natif est correctement sérialisé dans le workflow JSON
- **Bénéfice** : plus de bug de retour à SDXL, le template choisi est conservé après F5.

### ✅ Bug "Refactoring massif — découpage du code" — RÉSOLU
- **`frontend/index.html`** : 3917 → 757 lignes. CSS extrait → `css/app.css` (469 lignes). JS extrait → `js/app.js` (2691 lignes).
- **`frontend/js/app.js`** : 2691 lignes découpées en 4 modules : `app-core.js` (317), `app-keywords.js` (415), `app-filters.js` (1134), `app-admin.js` (826).
- **`backend/app.py`** : 3871 → 61 lignes. Routes découpées en 14 modules dans `backend/routes/`.
- **`backend/extensions.py`** : création app Flask + constantes partagées (22 lignes).
- **`backend/context.py`** : imports partagés pour les modules routes (43 lignes).
- **`frontend/beta.html`** supprimé — plus de synchro à maintenir.
- Bugs d'imports résolus : `_login_required` via `from context import *` + `__all__`, `helpers.py` imports manquants, `from routes.helpers import *` n'importe pas les underscore.

### ✅ Interface — onglets + relooking — RÉSOLU
- **Header renommé** : "FR-I.A Helper" avec 4 onglets : Prompt Helper, Style, Template, Keywords Manager.
- **Boutons filtres** (Charger/Save As/Gérer) : toolbar colorée (indigo/emerald/violet) avec badge, déplacée dans un encadré à droite sous la recherche sémantique.
- **Paramètres** allégée : Provider LLM + Compte (styles et templates déplacés vers onglets dédiés).

### ✅ Onglet Styles — interface deux colonnes — RÉSOLU
- **Colonne gauche** : liste des styles (nom, auteur, 🌐/🔒), clic = édition, boutons 📋 Cloner / 🗑 Supprimer.
- **Colonne droite** : édition plein écran, textareas ×3 hauteur + resize vertical + persistance hauteurs.
- **Bouton Export** ajouté (📥 format texte).
- **Bouton "+ Add Style"** ajouté en haut de la liste.
- Admin peut éditer/supprimer les styles sans propriétaire. Non-admin peut cloner les styles publics.
- **Modale de gestion des styles du prompt generator supprimée** : l'éditeur fullscreen dans l'onglet Style remplace la modale. Le bouton "Styles" du prompt generator et la modale associée ont été retirés.

### ✅ Onglet Templates — refonte complète — RÉSOLU
- **Colonne gauche** : liste normalisée comme les styles (nom, auteur, 🌐/🔒, 📋 Cloner, 🗑 Supprimer).
- **Colonne droite** : nom full width, Instructions + Exemples en deux sous-colonnes.
- **Le nom du template est son affichage humain** — `prompt_type` n'est plus utilisé comme identifiant (voir section de normalisation).
- **Dropdown `enhance-type` dynamique** : peuplé depuis les templates disponibles (utilise `id` comme valeur).
- **Format (text/md/json) + Public** descendus au-dessus du bouton Sauvegarder.
- **Bouton "+ Add Template"** ajouté en haut de la liste.
- **Admin** peut éditer/supprimer tous les templates. Propriété par utilisateur.
- **DB templates** : `name`, `is_public` ajoutés en migrations.
- **`prompt_type` supprimé** de la table (migration appliquée).

### ✅ Validation format LLM — ré-évaluée
- La roadmap originale prévoyait un auto-fix selon le format de sortie. Maintenant que le format est piloté par le `output_format` du template directement (pas de branche hardcodée par type), cette tâche est moins urgente.
- Le `output_format` est dans le payload de la réponse debug et peut être utilisé par les nodes ComfyUI (Ideogram Parse) pour validation.
- À reconsidérer : un endpoint de validation côté backend.

### ✅ Templates — dropdown dynamique dans les nodes ComfyUI — RÉSOLU
- **Dropdown Template** ajouté dans les 4 nodes ComfyUI (Enhancer, Prep, Ideogram Builder, Ideogram Prep).
- **Chargement lazy** : templates fetchés depuis `/api/prompts/templates` au `mousedown` (avec cache TTL 15s).
- **Widget natif** : `template_id` (INT) piloté par le dropdown DOM (caché).
- **Backend** :
  - Résolution template par `id` uniquement.
  - `template_id` (INT) requis, pas de fallback.
  - Erreur 400 explicite si template non trouvé ou inaccessible.
- **Resize** : `node.onResize` met à jour la largeur du container ; `gridTemplateColumns = "1fr 1fr"` forcé pour éviter l'effondrement. Pas de `ResizeObserver` (causait un bug de grid collapse).

### ✅ Sécurité — code review audit — RÉSOLU/PARTIEL
- **M8** : `is_admin()` retournait `True` on error (fail open) → corrigé en `return False` (fail secure).
- **M9** : `AbortSignal.timeout()` fallback pour navigateurs anciens (utilise `AbortController` + `setTimeout` si non disponible).
- **H3** : `_init_db()` était appelé à chaque connexion via `get_db()`. Maintenant appelé une seule fois au démarrage dans `app.py` (après les imports des routes, pour éviter les imports circulaires).

### ⚠️ Sécurité — non corrigé (changements majeurs)
- **H2** : Encryption key stockée dans la BDD. Migrer vers une variable d'environnement (casserait les clés existantes — migration des données nécessaire).
- **H4** : CORS wide open pour `/api/*`. Restreindre aux origines connues.
- **H5** : API key dans `localStorage`. Refactor architectural majeur.
- **H6** : `conn.close()` sans `finally` dans plusieurs routes. Refactor lourd.
- **M1** : Bbox detection fragile (heuristique `max(bbox) <= 1000`).
- **M4** : `_rebuild_filter_cache` charge tous les embeddings.
- **M6** : `_prepare_enhance` ouvre 2 connexions au lieu d'1.

---

## 🚀 État actuel (mi-2026)

**Contexte** : Serveur `kw.holaf.fr` (backend Flask + Discord OAuth). Le projet utilise **2 instances Ollama distinctes** + DeepSeek — voir section [Architecture Ollama](#-architecture-ollama--split-llm--embeddings) plus bas.

### ✅ Résolu cette session (normalisation `template_id`)

- **Suppression de `prompt_type`** dans 3 tables BDD (prompt_templates, generated_prompts, prompt_examples) avec migration `DROP/CREATE/INSERT` pour les données existantes.
- **Renommage `template_id` (INT)** dans 4 nodes Python ComfyUI avec conversion défensive contre string vide.
- **Réécriture de 4 widgets JS ComfyUI** : flag `_friaRestored`, callback natif, `Promise.all`, suppression de `ResizeObserver`, dropdowns peuplés avec `item.id`.
- **Backend `_prepare_enhance`** : résolution par `id`, suppression de `type_formats`/`format_instruction` mort, suppression de `_default_format_for_type`.
- **Templates par défaut** : insertion directe avec `name` (ex: "SDXL", "SDXL Markdown", "Ideogram 4") et `output_format` correspondant.
- **Aliases temporaires** : `prompt_type` (STRING) est encore accepté comme alias dans `_prepare_enhance` (cast en INT) pour rétro-compatibilité — à retirer après migration des nodes des utilisateurs.

### ✅ Résolu cette session (bugs template ComfyUI)

- **Bouton "Styles" du prompt generator et modale associée supprimés** : l'éditeur fullscreen dans l'onglet Style remplace la modale.
- **Bouton "+ Add Style" / "+ Add Template"** ajoutés en haut des listes.
- **Bug resize dropdown Template** : après release de la souris, le grid s'effondrait en 1 colonne. Fix : suppression du `ResizeObserver` buggé, forçage de `gridTemplateColumns = "1fr 1fr"`.
- **Bug string vide au RUN** : le widget natif INT recevait `''` et plantait avec `invalid literal for int()`. Fix : conversion défensive dans les 4 nodes Python + garantie que les selects ne sont jamais vides dans les widgets JS.

### ✅ Résolu cette session (audit backend)

- **`_init_db()` appelé une fois au démarrage** : retiré de `get_db()`, déplacé dans `app.py` après les imports des routes (pour éviter les imports circulaires).
- **`is_admin()` fail secure** : `return True` → `return False` on exception.
- **`AbortSignal.timeout()` fallback** dans `fria_menu.js` pour navigateurs anciens.
- **Debug button** : `document.write` + interpolation remplacés par `createElement` + `textContent` (prévention XSS).

### ✅ Résolu cette session (refactoring massif du code)

- **Découpage frontend** : `index.html` 3917 → 757 lignes. JS en 4 modules (`app-core.js`, `app-keywords.js`, `app-filters.js`, `app-admin.js`).
- **Découpage backend** : `app.py` 3871 → 61 lignes. Routes en 14 modules dans `backend/routes/`.
- **Bugs d'imports** : `_login_required` via `from context import *` + `__all__`, `helpers.py` imports manquants.

### ✅ Résolu (sessions précédentes)

- **`sqlite3.Row` n'a pas de `.get()`** — helper `_row_get()` + `safeJson()` côté frontend.
- **Fuite de connexion BDD** dans `discord_callback()`.
- **`_admin_required()` défini 2 fois** — la 2ème définition écrasait la 1ère.
- **FK constraint bloquait DELETE styles/presets** — `generated_prompts` référençait la ligne → NULL avant delete.
- **`JSON.parse: unexpected character`** — `await res.json()` sur du HTML d'erreur. Helper `safeJson()`.
- **Unreachable code** dans `deleteUser()` / `adminClearDb()`.
- **Décalage cache des filtres** (LIMIT 20, hidden_ids ignorés, etc.).
- **Mots masqués (👁️) non restaurés** au chargement d'un filtre.
- **Recherche sémantique dans `/api/enhance` silencieusement cassée** — fix SELECT avec embedding.
- **Filtre union → simple laisse `filter_type='union'` en BDD**.
- **Discord OAuth** : `SECRET_KEY` fixé, `DISCORD_REDIRECT_URI` aligné avec Discord Dev Portal.
- **Migration serveur cloud** : `getApiUrl()` lit `localStorage.FRIA_config.serverUrl`.
- **Terminal FR.IA** : panel flottant singleton via menu FR.IA, WebSocket `/fr_ia/terminal`, PTY serveur, xterm.js.
- **Qwen → Qwen-Image** : documentation mise à jour.

### ✅ Résolu cette session (audit code review 6 fichiers)

- **H1, M2** : widgets Ideogram utilisaient `t.prompt_type` (champ inexistant) — corrigé pour utiliser `t.id` (INT).
- **M7** : `loadTemplates` appelé à chaque `mousedown` sans cache — corrigé avec `refreshTemplatesIfStale` et `_cache.tmpl` TTL.
- **L3** : debug button `document.write` interpolation → `createElement` + `textContent`.

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
- [x] Capture tous les paramètres : section, recherche texte, recherche sémantique, NSFW, slider confiance
- [x] Modale de création : nom, catégorie (texte libre), SFW/NSFW, public/privé
- [x] Bouton "Mng" → modale avec rename, delete, rebuild cache (↻)
- [x] Recharger un filtre dans la fenêtre gauche → charge ses paramètres dans les filtres
- [x] Cache correctement regénéré avec tous les filtres (bug "Anciens filtres piochent dans la liste globale" résolu)
- [ ] Bouton "Tout recharger" → regénère le cache pour tous les filtres
- [x] Pas de limite de filtres par utilisateur
- [x] Les filtres publics sont visibles par tous les membres connectés

### Cache
- [x] À la sauvegarde : exécute la requête → stocke les IDs des mots-clés correspondants dans `filter_cache`
- [x] Le générateur pioche dans le cache → pas d'appel Ollama à chaque génération
- [x] Invalidation du cache après un import de `.md`
- [x] Cache inclut : recherche (+), recherche (-), mots masqués (hidden_kw_ids), NSFW, section, confiance sémantique
- [x] Cache trié par score (branche sémantique) → limité à 500 comme l'API
- [x] hidden_ids appliqués APRÈS la limite
- [x] Texte (+) et exclusion (-) appliqués comme post-filtres

---

## ⚡ Prompt Generator/Enhancer (panneau droit bas)

### Concept
Transformer un prompt brut en un prompt optimisé via un LLM, en combinant plusieurs sources d'entrée.

### Sources d'entrée (fusionnées avant envoi au LLM)

| Priorité | Source | Déclencheur |
|---|---|---|
| **Haute** | Text box (utilisateur) | Saisie manuelle |
| **Moyenne** | Elements Picker (panneau haut) | Checkbox "Base from Elements Picker" |
| **Basse** | Random elements | Checkbox + sélecteur N |

### Configuration
- [x] **Dropdown Template** : peuplé dynamiquement depuis `/api/prompts/templates` (utilise `id` comme valeur, `name` comme affichage)
- [x] **Dropdown Style** : peuplé depuis `/api/styles`
- [x] **Dropdown Preset IA** : peuplé depuis `/api/presets`
- [x] **Checkbox "Use Elements Picker"** → exécute l'EP + affiche le résultat dans `gen-output`
- [x] **Checkbox "Add random"** + compteur N
- [x] **Système de priorités** : haute (textbox) > moyenne (EP) > basse (random)
- [x] **Few-shot examples** : lus depuis `examples` du template
- [x] **Instructions spéciales** : textarea dans le payload (UI à vérifier)
- [ ] **Checkbox Prompt négatif**

> **Note** : le dropdown "Format" (text/markdown/json) a été retiré du panneau enhance. Le format est désormais déterminé par l'`output_format` du template sélectionné. L'éditeur de templates garde le choix `output_format` pour surcharger par type.

### Actions
- [x] **Bouton Générer** : envoie au LLM → affiche le résultat
- [x] **Bouton Copier** : copie le prompt généré
- [x] **Reset** : bouton ↻ dans l'en-tête

### Prompt Examples (système auto-nourri) — RE-ÉVALUATION
- L'API `/api/prompts/examples` et `/vote` existent mais ne sont plus utilisées (les templates remplissent ce rôle).
- À nettoyer : code mort dans `enhance.py` (déjà fait dans cette session).
- Le système de votes peut être réintroduit plus tard si besoin (Phase 7).

---

## ⚙️ Presets IA (panneau de configuration utilisateur)

### Concept
Chaque utilisateur configure ses propres presets de modèles IA (API compatible OpenAI). Les presets sont indépendants par utilisateur.

### Interface
- [x] Panneau de configuration utilisateur
- [x] Dropdown "Moteur" : API compatible OpenAI
- [x] Champs : URL, API Key (chiffrée), Modèle, Nom
- [x] Actions : Sauvegarder / Dupliquer / Effacer
- [x] Possibilité de switcher entre plusieurs presets

### Sécurité
- [x] API key chiffrée côté serveur avant stockage (Fernet)
- [ ] Clé de chiffrement dans une variable d'environnement (H2 code review)
- [x] Migration : clé générée au premier lancement si absente

---

## 🎨 Styles (prédéfinis)

### Concept
Styles réutilisables ajoutés aux prompts avant envoi au LLM (ex: "Hyper realistic, 1970 vintage photography"). Fonctionnent comme les filtres sauvegardés : public/privé, avec auteur.

### Interface
- [x] Onglet "Style" fullscreen (2 colonnes : liste à gauche, édition à droite)
- [x] Dropdown "Style" dans l'enhancer pour sélectionner un style
- [x] Affichage du nom de l'auteur à côté du nom du style
- [x] Bouton "Add Style" en haut de la liste

---

## 🧩 Architecture Ollama (split LLM / Embeddings)

### Vue d'ensemble

```
FR.IA-keywords backend (Flask, kw.holaf.fr)
    │
    ├── /api/enhance/prompts, /api/ideogram/prep, etc.
    │      │
    │      ├─► Ollama Cloud (abonnement) ──► LLM chat (gpt-oss, deepseek-v4, qwen3.5, ...)
    │      └─► DeepSeek API (abonnement) ──► backup LLM
    │
    └── /api/search/semantic, /api/embeddings/build
           │
           └─► Ollama CPU distant (dédié) ──► modèle embeddings (nomic-embed-text, ...)
```

### Variables d'environnement

| Var | Usage | Défaut |
|---|---|---|
| `OLLAMA_URL` | Endpoint Ollama pour les **embeddings** | `http://localhost:11434` |
| `OLLAMA_MODEL` | Modèle embeddings | `nomic-embed-text` |
| `OLLAMA_URL_LLM` | Endpoint Ollama Cloud pour les **LLM** | `https://ollama.com` |
| `OLLAMA_MODEL_LLM` | Modèle LLM par défaut | (configuré dans Presets) |
| `DEEPSEEK_API_KEY` | Clé DeepSeek (backup LLM) | vide |
| `DEEPSEEK_URL` | Endpoint DeepSeek | `https://api.deepseek.com/v1` |

> **Note** : Les URLs sont surchargeables dynamiquement via la table `app_settings` (colonnes `ollama_url`, `ollama_model`). Le split LLM/Embeddings n'est **pas encore implémenté** dans `app.py`. TODO : ajouter `OLLAMA_URL_LLM` distinct dans le panneau Presets.

---

## 🔧 Technique

### Tables BDD (état actuel, après normalisation `template_id`)

| Table | Colonnes clés |
|---|---|
| `ai_presets` | id, user_id, name, engine, base_url, api_key_encrypted, model, is_global, is_client_side |
| `styles` | id, user_id, name, style_text, negative_prompt, is_public |
| `prompt_templates` | **id**, user_id, **name**, **output_format**, system_prompt, examples, is_default, is_public |
| `prompt_examples` | id, **template_id** (FK), prompt_text, author_id, rating |
| `generated_prompts` | id, user_id, preset_id, **template_id** (FK), input_text, output_text, style_id, model_used |
| `filter_cache` | filter_id, keyword_id |
| `enhance_sessions` | id, user_id, state, payload_json, expires_at |

### Endpoints API

| Méthode | Route | Description |
|---|---|---|
| `GET/POST` | `/api/presets` | Lister / Créer un preset |
| `PUT/DELETE` | `/api/presets/<id>` | Modifier / Supprimer |
| `POST` | `/api/presets/<id>/duplicate` | Dupliquer un preset |
| `GET` | `/api/presets/<id>/models` | Lister les modèles du serveur |
| `GET/POST` | `/api/styles` | Lister / Créer un style |
| `PUT/DELETE` | `/api/styles/<id>` | Modifier / Supprimer |
| `GET/POST` | `/api/prompts/templates` | Lister / Créer un template |
| `PUT/DELETE` | `/api/prompts/templates/<id>` | Modifier / Supprimer |
| `GET` | `/api/prompts/templates/defaults` | Lister les templates par défaut |
| `GET` | `/api/enhance` | Générer/améliorer un prompt via LLM (streaming ndjson) |
| `POST` | `/api/enhance/prompts` | Variante découplée (3 strings prêtes pour un node LLM externe) |
| `POST` | `/api/ideogram/prep` | Préparer un appel LLM pour Ideogram 4 |
| `POST` | `/api/ideogram/parse` | Parser/valider la réponse LLM Ideogram 4 |

### Payload `/api/enhance`

```json
{
  "text": "...",
  "seed": 42,
  "template_id": 3,        // ID du template (INTEGER, requis)
  "preset_id": 1,           // ID du preset IA (optionnel, fallback = premier preset user/global)
  "style_id": 5,            // ID du style (optionnel)
  "style_text": "...",
  "special_instructions": "...",
  "ep_elements": [...],
  "random_count": 0,
  "width": 1024,            // pour Ideogram 4
  "height": 1024
}
```

### Initialisation BDD

`_init_db()` est appelé **une fois** au démarrage de l'app dans `app.py` (après les imports de routes, pour éviter les imports circulaires). Plus jamais dans `get_db()` — ça évitait de refaire les migrations et CREATE TABLE à chaque requête.

---

## 🎨 UI générale
- [ ] Drag & drop des mots-clés vers le générateur
- [ ] Double-clic sur un mot-clé → ajoute au générateur
- [x] Recherche sémantique (+) avec confiance (slider)
- [x] Recherche (+) dans tous les champs (keyword, description, section, subsection)
- [x] Recherche négative (-) pour exclure des mots-clés
- [x] Masquage local des mots-clés (👁️) avec compteur et "Réafficher"
- [x] Boutons reset par panneau (remise à zéro)
- [x] Panneaux distincts : coins arrondis, fonds differencies (3 couleurs), gaps transparents
- [ ] Code couleur par section (dans le tableau des mots-clés)
- [x] Spinner de chargement visible pendant les filtres
- [x] Barre de filtres sticky (reste visible en scroll)
- [ ] Compteur de tokens
- [x] Footer global avec stats
- [x] Modales uniformes : toutes draggables, pas d'alert() natif
- [x] Modales redimensionnables : poignées 8 directions (coins + bords) sur la modale settings

---

## 👥 Gestion des membres
- [x] Liste des membres avec avatar, nom, rôle
- [x] Clic sur un membre → détail avec :
  - [x] Grande photo (256px)
  - [x] Stats : nombre de filtres, nombre de prompts
  - [x] Favoris : type de prompt préféré, style préféré
  - [x] Historique : 15 derniers prompts (texte complet)
- [x] Endpoint API dédié : `GET /api/members/<user_id>`

### Phases complétées

#### Phase 1 — Fondations ✅
- [x] Toutes les tâches sont terminées

#### Phase 2 — Intégration Elements Picker ✅
- [x] Toutes les tâches sont terminées

#### Phase 3 — Templates personnalisables ✅ TERMINÉE
- [x] Table BDD `prompt_templates` avec `id`, `user_id`, `name`, `output_format`, `system_prompt`, `examples`, `is_default`, `is_public`
- [x] Templates par défaut (SDXL, SD1.5, Flux, Anima, Qwen-Image, Liste, Ideogram 4)
- [x] API CRUD `/api/prompts/templates`
- [x] Résolution dans `/api/enhance` par `template_id` (depuis la normalisation)
- [x] UI onglet "Templates" 2 colonnes (instructions + exemples)
- [x] Édition du prompt système (textarea)
- [x] Sauvegarde en template personnel
- [x] Reset vers le template par défaut
- [x] Export du template en JSON (📥 Exporter)
- [x] Paramètres enhance persistés : template_id, preset_id, style_id
- [x] Bouton "+ Add Template" en haut de la liste

#### Phase 4 — Polish & Bonus (en cours)
- [x] **Suppression de `prompt_type` (juin 2026)** — voir section de normalisation
- [x] **Ideogram 4 : backend support** (juin 2026) — Branche dédiée dans `_prepare_enhance` qui formate l'entrée en sections nommées (GENERAL DESCRIPTION + ELEMENTS TO PLACE + IMAGE DIMENSIONS + STYLE) au lieu du format avec priorités. Champs `width` et `height`. Bbox obligatoire dans le template.
- [x] **Ideogram 4 : nodes ComfyUI** (juin 2026) — `FRIAIdeogram4Node` (builder avec bouton Generate + preview) et `FRIAIdeogramPrepNode` (découplé, 3 strings).
- [x] **Ideogram 4 : node preview** — `FRIAIdeogram4Node` rend un preview visuel des bboxes (PIL + canvas).
- [ ] Checkbox Prompt négatif
- [ ] Base de prompts négatifs
- [x] Instructions spéciales dans le prompt système (backend OK, UI à vérifier)
- [ ] Export du résultat
- [ ] Drag & drop des mots-clés vers le générateur (UI générale)

#### Phase 5 — Audit (juin 2026)
Code review complet, classé par priorité :

**🟠 Majeurs (en cours de traitement) :**
- [x] **Seed ComfyUI ignoré dans `/api/enhance`** — `random.choice()` et `ORDER BY RANDOM()` ignorent le seed envoyé. Cohérence à faire avec `/api/generate` qui utilise `rng = random.Random(seed)`. *À traiter*.
- [ ] **`loadColWidths()` redimensionne les colonnes cachées** — applique la largeur à TOUS les `<th>`, y compris `score-header` qui est `hidden` en mode texte. *À corriger*.
- [x] **`user_id` inutilisé dans 4 endpoints** — `list_keywords()`, `list_sections()`, `stats()`, `presets()`. Pas de bug mais fausse l'intent. *À nettoyer*.

**🟡 Mineurs (nettoyage) :**
- [ ] **Code mort : `_loadApiKeySettings()` jamais appelé** — Garder `loadApiKeySettings()` (appelé) et supprimer la version `_loadApiKeySettings()` (jamais appelée). *À faire*.
- [x] **Code mort dans `enhance_prompt`** — `format_instruction`, query `prompt_examples` supprimés. *Fait*.
- [ ] **Bug n°11 : variables `cur`/`cur2`/`conn`/`conn2` multiples dans `enhance_prompt`** — Renommer en `_db_ep`, `_db_rand`, `_db_template`. *À faire*.
- [ ] **`var filtersBar` déclaré mais plus utilisé** dans `app-core.js`. *À supprimer.* (Code toujours présent ligne 17)
- [ ] **Troncature inesthétique dans `exporter.py`** — Le `[:100]` coupe la liste concaténée des catégories au milieu d'un titre. *À corriger*.
- [ ] **README ComfyUI : nom de dossier contradictoire** — `git clone ... FRIA_Tools` mais l'avertissement dit `FRIA_Keywords`. *À corriger*.

**⚠️ Points d'attention :**
- [x] **Vérifier persistance des paramètres enhance** — L'API `/api/settings` existe, le frontend appelle PUT après chaque changement.
- [x] **UI `special_instructions`** — Backend OK, UI existe dans le panneau enhance.
- [x] **Système `prompt_examples` (votes)** — Code mort nettoyé.
- [x] **Page `/settings` ComfyUI** — C'est un onglet "Compte" dans la modale Paramètres.

**🔴 Hauts (à planifier) :**
- [ ] **H2** : Encryption key en BDD. Migrer vers env var.
- [ ] **H4** : CORS wide open. Restreindre.
- [ ] **H5** : API key dans `localStorage`. Refactor.
- [ ] **H6** : `conn.close()` sans `finally`.

#### Phase 6 — Frontend (à planifier)
- [ ] Drag & drop des mots-clés vers le générateur
- [ ] Double-clic sur un mot-clé → ajoute au générateur
- [ ] Code couleur par section
- [ ] Compteur de tokens
- [ ] Bouton "Tout recharger" → regénère le cache pour tous les filtres
- [ ] Slider de confiance minimale dans le générateur (panneau droit)

#### Phase 7 — Community & Management

##### Feature Requests
- [ ] Page `/features` listant les demandes de fonctionnalités des utilisateurs
- [ ] Système de vote (👍/👎)
- [ ] Statuts : "proposée", "en cours", "faite", "refusée"
- [ ] Filtrer par statut, tri par votes/popularité
- [ ] Suggestion automatique : dédoublonnage
- [ ] Notification quand une feature change de statut

##### User Prompts
- [ ] Page `/prompts` : bibliothèque de prompts partagés
- [ ] Formulaire d'ajout : titre, prompt, type, tags
- [ ] Édition par l'auteur
- [ ] Recherche de doublons (LLM semantic similarity)
- [ ] Système de rating
- [ ] Filtres par type/note/tag/auteur
- [ ] Modération : signaler, cacher, supprimer
- [ ] Export vers le générateur

---

## 🐛 Bugs identifiés

### Backend — enhance.py

- [x] **CRITIQUE : 500 sur GET /api/presets et GET /api/styles** — Résolu. Cause : `sqlite3.Row` n'a pas de méthode `.get()`. Fix : helper `_row_get()`.
- [x] **CRITIQUE : GET /api/filters plante pour les filtres union** — Résolu. Fix : `conn.close()` déplacé après la boucle for.
- [x] **CRITIQUE : Recherche sémantique dans `/api/enhance` silencieusement cassée** — Résolu. Fix : `SELECT k.keyword, ke.embedding` + `r['embedding']`.
- [x] **CRITIQUE : Filtre union → simple laisse `filter_type='union'` en BDD** — Résolu. Fix : ajouter un `else` pour repasser en `'simple'`.
- [x] **Bug : URLs LLM locales invalides pour les utilisateurs distants** — Résolu avec l'option "Client-side".
- [x] **Bug : Mauvaise URL pour le endpoint members** — Corrigé.
- [x] **Bug : PUT /api/filters/<id> plante (KeyError)** — Corrigé.
- [x] **Bug : Fuite de connexion BDD dans `discord_callback()`** — Corrigé.
- [x] **Bug : Message d'erreur obsolète** — "Token HF" → "Serveur Ollama inaccessible".
- [x] **Commentaire obsolète** — "embeddings HF" → "embeddings Ollama".
- [x] **`_admin_required()` défini 2 fois** — Suppression de la 2ème définition.
- [x] **FK constraint bloquait DELETE styles/presets** — `NULL` des références avant suppression.
- [x] **Variable inutilisée** — `stats()`, `sections()`, `list_keywords()`, `presets()` calculent `user_id` sans l'utiliser.
- [x] **Colonne `config` pas mise à jour au Save** — Résolu.
- [x] **Preview `total` plafonné à 20** — Résolu (COUNT(*) séparé du LIMIT).
- [x] **Cache sémantique ignorait section/nsfw/hidden_ids/search_neg** — Résolu.
- [ ] **Seed ComfyUI ignoré dans `/api/enhance`** — `random.choice()` et `ORDER BY RANDOM()` ignorent le seed.
- [x] **Code mort dans `enhance_prompt`** — `format_instruction` et query `prompt_examples` supprimés.
- [x] **`prompt_type` STRING reçu comme `''` au RUN** — Conversion défensive dans les 4 nodes Python + dropdowns JS jamais vides.
- [x] **Widget natif `prompt_type` non synchronisé avec dropdown DOM** — Remplacé par `template_id` (INT) avec callback + flag `_friaRestored` + `Promise.all`.
- [x] **Dropdown Template revient à SDXL après F5** — Résolu par `template_id` INT + callback + restoration.
- [x] **`_init_db()` appelé à chaque connexion** — Déplacé dans `app.py`, appelé une fois au démarrage.
- [x] **Import circulaire `_init_db` dans `extensions.py`** — Déplacé dans `app.py` après les imports de routes.
- [x] **`is_admin()` fail open** — `return False` on exception (fail secure).
- [x] **F2 _do_enhance thread** — `setConfig(url=, model=)` au lieu de (url=, model=).

### Backend — parser.py
- [x] **Parser ignorait les chiffres romains avec L, C, D** — Fix : `[IVXLCDM]+`.

### Backend — auth.py
- [x] **Imports inutilisés** — Supprimés.

### Backend — exporter.py
- [x] **Export sans `ORDER BY` cohérent** — Résolu (c'était juste une note de roadmap obsolète).
- [ ] **Troncature inesthétique du footer** — `[:100]` coupe la liste concaténée.

### Frontend — index.html
- [ ] **Potentiel : `filtersBar` déclaré mais plus utilisé** — Toujours présent dans `app-core.js:17`. *À supprimer.* (Roadmap disait [x] mais code toujours là)
- [ ] **Score header visible en mode texte** — `scoreHeader` est initialisé comme `hidden` mais affecté par `loadColWidths` qui applique des largeurs à tous les `<th>`.
- [x] **Unreachable code dans deleteUser/adminClearDb** — Code après `return;` déplacé dans le callback.
- [x] **`delStyle()` silencieux** — Ajout d'affichage d'erreur.
- [x] **Confidence slider ne refetchait pas l'API** — Maintenant invalide le cache.
- [x] **Recherche texte (+) et exclusion (-) ignorées avec sémantique** — Post-filtres.
- [x] **hiddenKWs non restaurés au chargement d'un filtre** — Restaurés.
- [x] **Label "X résultats (Y masqués)" ambigu** — Changé.
- [ ] **Code mort : `_loadApiKeySettings()` jamais appelé** — À supprimer.

### Frontend — ComfyUI widgets
- [x] **Bug dropdown Template** — `template_id` INT, callback, `Promise.all`, flag `_friaRestored`.
- [x] **Grid collapse au release de la souris** — `ResizeObserver` retiré, `gridTemplateColumns = "1fr 1fr"` forcé.
- [x] **Templates Ideogram 4 utilisaient `t.prompt_type`** — Remplacé par `t.id`.
- [x] **Cache TTL pour templates** — `refreshTemplatesIfStale` ajouté.
- [x] **Debug button XSS** — `textContent` au lieu de `document.write` interpolation.

---

## 🧩 FR.IA — Extension ComfyUI

### Concept

Extension légère qui ajoute un bouton `[FR.IA]` dans la barre de menu de ComfyUI.

### Menu `[FR.IA ▾]`

| Option | Action |
|--------|--------|
| **Open Webpage** | Ouvre `https://kw.holaf.fr` dans un nouvel onglet |
| **Paramètres** | Ouvre la modale de configuration |

### Modale Paramètres

- **URL du serveur** : défaut `https://kw.holaf.fr`, configuré via menu FR.IA → Compte
- **Clé API** : token Bearer généré depuis `/api/auth/token`

### Architecture

| Composant | Rôle | Statut |
|-----------|------|--------|
| **Menu `[FR.IA ▾]`** | Point d'entrée global | ✅ |
| **Node Elements Picker** | Composer des éléments (filtres, sémantique, random) | ✅ |
| **Node Prompt Enhancer** | Optimise via LLM cloud | ✅ |
| **Node Prompt Prep** | Prépare 3 strings pour un LLM externe | ✅ |
| **Node Ideogram 4 Builder** | Génère un JSON Ideogram 4 | ✅ |
| **Node Ideogram Prep** | Prépare 3 strings pour Ideogram 4 | ✅ |
| **Node Ideogram Parse** | Parse la réponse LLM Ideogram 4 | ✅ |
| **Node Diagnostic** | Debug DOM widget | ✅ |
| **Panel Terminal** | Accès shell via WebSocket | ✅ |

### Nœuds ComfyUI — pattern commun (post-normalisation `template_id`)

Tous les nœuds sauf Diagnostic et Ideogram Parse utilisent le pattern suivant :
- **Widget natif `template_id`** (INT) caché, piloté par le DOM.
- **Widget natif `style_id`** (INT) caché, piloté par le DOM.
- **Widget natif `preset_id`** (INT) caché, piloté par le DOM (sauf Prep et Ideogram Prep qui n'ont pas de preset).
- **Widgets JS** : dropdowns peuplés depuis `/api/prompts/templates`, `/api/styles`, `/api/presets`.
- **Sync** : `widget.value = val` puis `widget.callback(val)` pour propager au graph.
- **Restore** : flag `_friaRestored` + `Promise.all` pour les chargements.
- **Resize** : `node.onResize` met à jour la largeur du container, `gridTemplateColumns = "1fr 1fr"` forcé.
- **Conversion défensive côté Python** : `int(val) if val != "" else 0` pour les INT.

### Fichiers de l'extension

```
FR.IA-ComfyUI/
├── __init__.py
├── nodes/
│   ├── __init__.py
│   ├── _credentials.py          # lecture fria_credentials.json
│   ├── elements_node.py         # Elements Picker
│   ├── enhance_node.py          # Prompt Enhancer (cloud)
│   ├── prep_node.py             # Prompt Prep (decoupled)
│   ├── ideogram4_node.py        # Ideogram 4 Builder
│   ├── ideogram_prep_node.py    # Ideogram Prep (decoupled)
│   ├── ideogram_parse_node.py   # Ideogram Parse + preview bboxes
│   ├── diagnostic_node.py       # Diagnostic
│   ├── terminal.py              # PTY serveur pour /fr_ia/terminal
│   └── update_manager.py        # Mise à jour du repo
├── web/
│   └── js/
│       ├── fria_menu.js
│       ├── fria_elements_widget.js
│       ├── fria_enhance_widget.js
│       ├── fria_prep_widget.js
│       ├── fria_ideogram4_widget.js
│       ├── fria_ideogram_prep_widget.js
│       ├── fria_terminal_widget.js
│       ├── xterm.js              # bundle UMD
│       └── xterm-addon-fit.js    # bundle UMD
├── pyproject.toml
├── README.md
└── requirements.txt
```

### Roadmap d'implémentation

| # | Étape | Statut |
|---|-------|--------|
| 1-4 | Site web : auth token, BDD, UI | ✅ |
| 5-6 | Menu + Widget Elements Picker | ✅ |
| 7 | Node Elements Picker | ✅ |
| 8 | Node Prompt Enhancer | ✅ |
| 8b | Nodes Prompt Prep + Ideogram 4 Builder + Ideogram Prep + Parse | ✅ |
| 9 | Tests + Déploiement | ✅ (déployé, utilisateurs testent) |
| 10 | Publication registry | ⬜ |

### Notes de packaging

- Le nom du dossier doit être **`FRIA_Tools`** (le nom du repo GitHub) pour que Python importe `FRIA_ComfyUI` correctement. Le README doit refléter cette consigne (corriger l'avertissement obsolète "FRIA_Keywords").

### Site web — Onglet "Compte" dans la modale Paramètres

- Endpoint `/api/auth/token` (GET/POST) pour récupérer/régénérer la clé API.
- Colonne `users.api_token` ajoutée en migration.
- Middleware `_authenticate_via_token()` lit le header `Authorization: Bearer <token>`.

### Checklist migration serveur cloud (référence)

1. Copier `.env` complet (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, SECRET_KEY fixe, GUILD_ID optionnel)
2. Vérifier alignement exact `DISCORD_REDIRECT_URI` ↔ Redirects sur Discord Dev Portal
3. Si reverse-proxy HTTPS : ajouter `ProxyFix` à `extensions.py`
4. Pull du repo + restart extension ComfyUI → `web/js/*` rechargés
5. Côté user : menu **FR.IA → Compte** → mettre la nouvelle `URL du serveur` + clé API + vider cache navigateur
6. Tester login Discord + génération d'un node Ideogram4

---

## 📝 Notes de session

- Les commits se font par l'utilisateur, pas l'assistant.
- Convention : un commit = un changement logique.
- Le serveur de prod est sur `/projects/FRIA_Tools` (cloud), pas `FR.IA-keywords/`.
- Le frontend web est servi par Flask depuis `frontend/`.
- Le frontend ComfyUI est servi par ComfyUI depuis `web/js/` (extension `FRIA_ComfyUI`).
