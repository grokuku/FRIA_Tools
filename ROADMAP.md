# Roadmap — Prompt Generator & Prompt Enhancer

> Fichier vivant pour noter les idées, fonctionnalités et réflexions.

---

## 🧠 Prompt Generator (panneau droit haut)

### Concept
Générer un prompt complet en combinant des **éléments**. Chaque élément est une source de mot-clé :
- **Filtre sauvegardé** → pioche un mot-clé au hasard dans le cache du filtre
- **Texte libre** → recherche sémantique → pioche un mot-clé au hasard

### Interface utilisateur
- [ ] Liste d'éléments (lignes), chaque ligne = un élément
- [ ] Au début : 1 ligne vide. Quand remplie → une nouvelle ligne vide apparaît
- [ ] Chaque ligne : sélecteur de filtre OU champ de texte libre
- [ ] Explorateur de filtres avec toggles : "Mes filtres" / "Filtres publics", "SFW" / "NSFW" / "Les deux"
- [ ] Slider de confiance minimale pour la recherche sémantique
- [ ] Bouton "Générer" → pioche aléatoirement dans chaque élément → combine → affiche le prompt
- [ ] Zone d'affichage du prompt final + bouton "Copier"
- [ ] Génération instantanée (pas d'animation)

### Filtres sauvegardés
- [ ] Bouton "Save filter" dans la barre de filtres (panneau gauche)
- [ ] Capture tous les paramètres : section, recherche texte, recherche sémantique, NSFW, slider confiance
- [ ] Modale de création : nom, catégorie (texte libre), SFW/NSFW, public/privé
- [ ] Modale de gestion des filtres : liste, modifier, supprimer, recharger
- [ ] Recharger un filtre dans la fenêtre gauche → charge ses paramètres dans les filtres
- [ ] Bouton "Tout recharger" → regénère le cache pour tous les filtres
- [ ] Pas de limite de filtres par utilisateur
- [ ] Les filtres publics sont visibles par tous les membres connectés

### Cache
- [ ] À la sauvegarde : exécute la requête → stocke les IDs des mots-clés correspondants dans `filter_cache`
- [ ] Le générateur pioche dans le cache → pas d'appel Ollama à chaque génération
- [ ] Invalidation du cache après un import de `.md`

---

## ⚡ Prompt Enhancer (panneau droit bas)

### Idées (à développer)
- [ ] Zone de texte pour coller un prompt
- [ ] Suggestion de mots-clés manquants (via Ollama)
- [ ] Nettoyage (doublons, espaces, formatage)
- [ ] Traduction anglais/français
- [ ] Détection de conflits ("long hair" + "short hair")
- [ ] Optimisation syntaxe Danbooru
- [ ] Suggestion NSFW
- [ ] Analyse longueur du prompt

---

## 🎨 UI générale
- [ ] Drag & drop des mots-clés vers le générateur
- [ ] Double-clic sur un mot-clé → ajoute au générateur
- [ ] Code couleur par section
- [ ] Compteur de tokens

---

## 🔧 Technique

### Tables BDD à créer
- `saved_filters` : id, user_id, name, category, nsfw, is_public, config (JSON), created_at, updated_at
- `filter_cache` : filter_id, keyword_id

### Endpoints API
- `GET /api/filters` — liste les filtres
- `POST /api/filters` — créer un filtre
- `PUT /api/filters/<id>` — modifier
- `DELETE /api/filters/<id>` — supprimer
- `POST /api/filters/<id>/refresh` — regénérer le cache
- `POST /api/filters/refresh-all` — regénérer tous les caches
- `POST /api/generate` — générer un prompt depuis une liste d'éléments

### Fonctionnement
- Prompt Generator = frontend + API (pas de LLM)
- Prompt Enhancer = pourrait utiliser Ollama pour les suggestions (future)
- Table `saved_prompts` (future) pour l'historique
- Export .txt / .csv (future)

---

## 🐛 Bugs identifiés

### Backend — app.py

- [ ] **Bug : Mauvaise URL pour le endpoint members** — `frontend/index.html:671` utilise `fetch(API + '/api/members')` mais `API = '/api'`, donc l'appel part sur `/api/api/members` (404). Doit être `API + '/members'`.
- [ ] **Bug : Fuite de connexion BDD dans `discord_callback()`** — Deux appels à `get_db()` sans fermer le premier. Le premier `conn` (lignes ~248-270) n'est jamais fermé, le second `conn` (ligne ~273) écrase la variable. La première connexion reste ouverte.
- [ ] **Bug : Message d'erreur obsolète** — `import_md()` ligne ~631 affiche "Token HF non configuré. Définissez HF_TOKEN." alors qu'on utilise Ollama maintenant.
- [ ] **Commentaire obsolète** — `_generate_all_embeddings()` dit "Génère et stocke les embeddings HF" mais c'est Ollama.
- [ ] **Variable inutilisée** — `stats()` et `sections()` récupèrent `user_id = _get_current_user_id()` mais ne l'utilisent pas (normal, base partagée).

### Backend — auth.py

- [ ] **Imports inutilisés** — `json`, `Path`, `redirect`, `request`, `jsonify`, `current_app` importés mais jamais utilisés.

### Backend — exporter.py

- [ ] **Export sans filtre utilisateur** — Exporte tous les mots-clés (normal pour base partagée) mais la fonction `export_to_markdown` utilise `SELECT * FROM keywords` sans `ORDER BY` cohérent. Les mots-clés sont exportés dans l'ordre d'insertion, pas par section.

### Frontend — index.html

- [ ] **Bug : Liste des membres inaccessible via le bouton** — À cause du double `/api` dans l'URL, les membres normaux reçoivent une 404 au lieu d'une 403 (voir plus haut).
- [ ] **Potentiel : `filtersBar` déclaré mais plus utilisé** — La variable `filtersBar` est référencée dans `const filtersBar = $('filters-bar')` mais n'est plus utilisée dans le code (remplacée par `document.getElementById('filters-bar')`).
- [ ] **Score header visible en mode texte** — `scoreHeader` est initialisé comme `hidden` mais pourrait être affecté par `loadColWidths` qui applique des largeurs à tous les `<th>` sans vérifier si la colonne est visible.
