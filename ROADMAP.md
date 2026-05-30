# Roadmap — Elements Picker & Prompt Generator/Enhancer

> Fichier vivant pour noter les idées, fonctionnalités et réflexions.

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
- [ ] Slider de confiance minimale pour la recherche sémantique (dans le générateur)
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
- [ ] Modale de gestion des filtres : liste, modifier, supprimer, recharger
- [x] Recharger un filtre dans la fenêtre gauche → charge ses paramètres dans les filtres
- [ ] Bouton "Tout recharger" → regénère le cache pour tous les filtres
- [x] Pas de limite de filtres par utilisateur
- [x] Les filtres publics sont visibles par tous les membres connectés

### Cache
- [x] À la sauvegarde : exécute la requête → stocke les IDs des mots-clés correspondants dans `filter_cache`
- [x] Le générateur pioche dans le cache → pas d'appel Ollama à chaque génération
- [x] Invalidation du cache après un import de `.md`
- [x] Cache inclut : recherche (+), recherche (-), mots masqués (hidden_kw_ids), NSFW, section

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
- [ ] **Instructions spéciales** (textarea optionnel)
- [ ] **Checkbox Prompt négatif** (Phase 4)

### Actions

- [x] **Bouton Générer** : envoie au LLM → affiche le résultat
- [x] **Bouton Copier** : copie le prompt généré
- [x] **Reset** : bouton ↻ dans l'en-tête

### Prompt Examples (système auto-nourri)

- Chaque prompt généré est automatiquement sauvegardé dans `prompt_examples`
- Les utilisateurs peuvent voir et voter sur les prompts (👍 +1 / 👎 -1)
- Les 5 mieux notés par type sont passés au LLM en few-shot
- L'auteur est affiché → auto-modération
- Modale de consultation des prompts (voir/voter)

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
- [ ] Possibilité de switcher entre plusieurs presets (déjà fonctionnel via dropdown)

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
- [x] Recherche (+) dans tous les champs (keyword, description, section, subsection)
- [x] Recherche négative (-) pour exclure des mots-clés
- [x] Masquage local des mots-clés (👁️) avec compteur et "Réafficher"
- [x] Boutons reset par panneau (remise à zéro)
- [x] Panneaux distincts : coins arrondis, fonds differencies (3 couleurs), gaps transparents
- [ ] Code couleur par section (dans le tableau des mots-clés)
- [ ] Compteur de tokens
- [x] Footer global avec stats (mots-clés, sections, NSFW, prompts générés)
- [x] Modales uniformes : toutes draggables, pas d'alert() natif

---

## 📋 Plan de déploiement (Prompt Generator/Enhancer)

### Phase 1 — Fondations ✅
- [x] Toutes les tâches sont terminées

### Phase 2 — Intégration Elements Picker ✅
- [x] Toutes les tâches sont terminées

### Phase 3 — Communauté & Auto-nourrissant
- [ ] Sauvegarde automatique des prompts générés (`prompt_examples`)
- [ ] Modale de consultation/vote des prompts
- [ ] Endpoint `POST /api/prompts/examples/<id>/vote`
- [ ] Utilisation des 5 mieux notés comme few-shot (remplace les hardcodés)
- [ ] Affichage de l'auteur sur les styles

### Phase 4 — Polish & Bonus
- [ ] Checkbox Prompt négatif
- [ ] Base de prompts négatifs
- [ ] Instructions spéciales dans le prompt système
- [ ] Export du résultat
- [ ] Drag & drop des mots-clés vers le générateur (UI générale)

---

## 🐛 Bugs identifiés

### Backend — app.py

- [ ] **Bug : URLs LLM locales invalides pour les utilisateurs distants** — Résolu avec l'option "Client-side" dans les presets. Quand cochée, l'appel LLM passe par le navigateur (pas le backend), ce qui permet d'utiliser un LLM local. L'utilisateur doit activer CORS sur son serveur LLM (ex: `OLLAMA_ORIGINS=*`).
- [x] **Bug : Mauvaise URL pour le endpoint members** — `fetch(API + '/api/members')` → `/api/api/members` (404). Corrigé en `API + '/members'`.
- [ ] **Bug : Liste des utilisateurs cassée dans le panneau admin** — La fonction `loadAdminUsers()` retourne une erreur ou n'affiche plus correctement la liste (vérifier endpoint `/api/admin/users` et le rendu frontend).
- [x] **Bug : PUT /api/filters/<id> plante (KeyError)** — `SELECT user_id` empêchait d'accéder à `row['name']`. Corrigé avec `SELECT *`.
- [ ] **Bug : Fuite de connexion BDD dans `discord_callback()`** — Deux appels à `get_db()` sans fermer le premier.
- [ ] **Bug : Message d'erreur obsolète** — `import_md()` affiche "Token HF non configuré" alors qu'on utilise Ollama.
- [ ] **Commentaire obsolète** — `_generate_all_embeddings()` dit "embeddings HF" mais c'est Ollama.
- [ ] **Variable inutilisée** — `stats()` et `sections()` récupèrent `user_id` sans l'utiliser.

### Backend — auth.py

- [ ] **Imports inutilisés** — `json`, `Path`, `redirect`, `request`, `jsonify`, `current_app` importés mais jamais utilisés.

### Backend — exporter.py

- [ ] **Export sans filtre utilisateur** — Exporte tous les mots-clés (normal pour base partagée) mais la fonction `export_to_markdown` utilise `SELECT * FROM keywords` sans `ORDER BY` cohérent. Les mots-clés sont exportés dans l'ordre d'insertion, pas par section.

### Frontend — index.html

- [ ] **Potentiel : `filtersBar` déclaré mais plus utilisé** — La variable `filtersBar` est référencée dans `const filtersBar = $('filters-bar')` mais n'est plus utilisée dans le code (remplacée par `document.getElementById('filters-bar')`).
- [ ] **Score header visible en mode texte** — `scoreHeader` est initialisé comme `hidden` mais pourrait être affecté par `loadColWidths` qui applique des largeurs à tous les `<th>` sans vérifier si la colonne est visible.
