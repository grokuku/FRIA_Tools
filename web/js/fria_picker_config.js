/**
 * FR.IA Picker Config — Composant réutilisable pour dropdown avec configuration modale.
 *
 * Remplace un <select> standard par :
 *   [ ⚙️ ] [ ▼ dropdown sélection... ]
 *
 * Le ⚙️ ouvre une modale 2 colonnes (Tous les items ↔ Shortlist).
 * L'utilisateur choisit quels items apparaissent dans le dropdown.
 * Si la shortlist est vide → le dropdown affiche tout.
 * Si la shortlist a >1 item → le dropdown propose "🎲 Random".
 *
 * La shortlist est stockée dans un widget STRING natif (sérialisé dans le workflow).
 */
(function() {
    // ── Etat global de la modale (singleton) ──

    /**
     * Configure un dropdown avec bouton config.
     * @param {Object} opts
     * @param {HTMLSelectElement} opts.select - Le <select> existant
     * @param {Object} opts.node - Le node ComfyUI
     * @param {string} opts.widgetName - Nom du widget natif pour la valeur sélectionnée (ex: 'style_id')
     * @param {string} opts.listWidgetName - Nom du widget natif STRING pour la shortlist JSON (ex: 'style_shortlist')
     * @param {string} opts.apiPath - Chemin API relatif (ex: 'styles')
     * @param {string} opts.label - Texte du label
     * @param {string} opts.placeholder - Texte du placeholder
     * @param {string} opts.idField - Champ ID dans l'objet item (défaut: 'id')
     * @param {string} opts.nameField - Champ nom (défaut: 'name')
     * @param {string} opts.authorField - Champ auteur (défaut: 'owner_name')
     * @param {string} opts.descField - Champ description (défaut: undefined)
     * @param {Function} opts.fetchItems - Fonction async pour fetcher les items
     * @param {Function} opts.onSelect - Callback quand la sélection change (selectedId, shortlist)
     */
    function setupPickerConfig(opts) {
        var select = opts.select;
        var node = opts.node;
        var widgetName = opts.widgetName;
        var listWidgetName = opts.listWidgetName;
        var apiPath = opts.apiPath;
        var label = opts.label || 'Picker';
        var placeholder = opts.placeholder || '-- Select --';
        var idField = opts.idField || 'id';
        var nameField = opts.nameField || 'name';
        var authorField = opts.authorField || 'owner_name';
        var descField = opts.descField;
        var fetchItems = opts.fetchItems;
        var onSelect = opts.onSelect;

        // ── Widget natif pour la shortlist ──
        var shortlistWidget = node.widgets?.find(function(w) { return w.name === listWidgetName; });

        // Helper : lire la shortlist depuis le widget natif
        function getShortlist() {
            try {
                if (shortlistWidget && shortlistWidget.value) {
                    var parsed = JSON.parse(shortlistWidget.value);
                    if (Array.isArray(parsed)) return parsed;
                }
            } catch(e) {}
            return [];
        }

        // Helper : écrire la shortlist dans le widget natif
        function setShortlist(arr) {
            var json = JSON.stringify(arr);
            if (shortlistWidget) {
                shortlistWidget.value = json;
                if (shortlistWidget.callback) shortlistWidget.callback(json);
            }
        }

        // ── Container pour le bouton ──
        var pickerRow = document.createElement('div');
        Object.assign(pickerRow.style, {
            display: 'flex', gap: '4px', alignItems: 'center', width: '100%',
        });

        // Bouton ⚙️ (config)
        var configBtn = document.createElement('button');
        configBtn.textContent = '\u2699';
        Object.assign(configBtn.style, {
            width: '28px', height: '22px', flexShrink: '0',
            padding: '0', borderRadius: '4px',
            border: '1px solid #555', background: '#3a3a3e', color: '#ccc',
            fontSize: '13px', cursor: 'pointer', lineHeight: '1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        configBtn.title = 'Configurer la shortlist';
        configBtn.onmouseenter = function() { configBtn.style.borderColor = '#777'; };
        configBtn.onmouseleave = function() { configBtn.style.borderColor = '#555'; };

        // Style du select : prendre toute la largeur restante
        select.style.flex = '1';

        // Insérer le bouton avant le select
        pickerRow.appendChild(configBtn);
        select.parentNode.insertBefore(pickerRow, select);
        pickerRow.appendChild(select);

        // ── Peupler le dropdown ──
        var _allItems = [];

        function populateDropdown(items, shortlist) {
            // Sauvegarder la valeur courante
            var currentVal = select.value;
            select.innerHTML = '';

            var list = shortlist && shortlist.length > 0
                ? items.filter(function(item) { return shortlist.indexOf(String(item[idField])) >= 0 || shortlist.indexOf(item[idField]) >= 0; })
                : items;

            // Option placebo
            var opt0 = document.createElement('option');
            opt0.value = '0';
            opt0.textContent = placeholder;
            select.appendChild(opt0);

            // Option random si shortlist > 1
            if (list.length > 1) {
                var randOpt = document.createElement('option');
                randOpt.value = '_random';
                randOpt.textContent = '\ud83c\udfb2 Random';
                select.appendChild(randOpt);
            }

            // Items
            list.forEach(function(item) {
                var o = document.createElement('option');
                o.value = String(item[idField]);
                o.textContent = item[nameField] || ('Item ' + item[idField]);
                select.appendChild(o);
            });

            // Restaurer si possible
            if ([...select.options].some(function(o) { return o.value === currentVal; })) {
                select.value = currentVal;
            } else {
                select.value = '0';
            }
        }

        // ── Initialisation des items ──
        async function initItems() {
            try {
                _allItems = await fetchItems(apiPath);
            } catch(e) {
                _allItems = [];
            }
            select._friaPickerItems = _allItems;
            var shortlist = getShortlist();
            populateDropdown(_allItems, shortlist);
        }

        // ── Refresh ──
        select._friaRefreshItems = function() {
            initItems();
        };

        // ── Ouverture de la modale ──
        configBtn.onclick = function() {
            openPickerModal({
                allItems: _allItems,
                currentShortlist: getShortlist(),
                idField: idField,
                nameField: nameField,
                authorField: authorField,
                descField: descField,
                label: label,
                onSave: function(newShortlist) {
                    setShortlist(newShortlist);
                    populateDropdown(_allItems, newShortlist);
                    if (onSelect) onSelect(select.value, newShortlist);
                }
            });
        };

        // ── Sauvegarder la référence pour le restore ──
        select._friaPickerShortlistWidget = shortlistWidget;
        select._friaPickerGetShortlist = getShortlist;
        select._friaPickerSetShortlist = setShortlist;
        select._friaPickerPopulate = populateDropdown;
        select._friaPickerItems = _allItems;
        select._friaPickerInit = initItems;

        return {
            init: initItems,
            getShortlist: getShortlist,
            setShortlist: setShortlist,
            populate: populateDropdown,
            refresh: initItems,
        };
    }

    // ── Modale 2 colonnes (singleton) ──
    function openPickerModal(opts) {
        var allItems = opts.allItems || [];
        var currentShortlist = opts.currentShortlist || [];
        var idField = opts.idField || 'id';
        var nameField = opts.nameField || 'name';
        var authorField = opts.authorField || 'owner_name';
        var descField = opts.descField;
        var label = opts.label || 'Picker';
        var onSave = opts.onSave || function() {};

        // Convertir la shortlist en Set pour lookup rapide
        var shortlistSet = new Set(currentShortlist.map(function(id) { return String(id); }));

        // Créer la modale (une seule instance)
        var modal = document.getElementById('fria-picker-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'fria-picker-modal';
            Object.assign(modal.style, {
                display: 'none', position: 'fixed', zIndex: '99999',
                left: '0', top: '0', width: '100%', height: '100%',
                background: 'rgba(0,0,0,0.6)',
                justifyContent: 'center', alignItems: 'center',
                fontFamily: 'sans-serif', fontSize: '13px',
            });
            modal.innerHTML =
                '<div style="background:#2a2a2e;border-radius:10px;width:640px;max-width:92vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden;">' +
                    '<div style="padding:10px 16px;border-bottom:1px solid #444;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
                        '<span id="fria-picker-title" style="color:#eee;font-weight:600;font-size:14px;"></span>' +
                        '<span id="fria-picker-close" style="color:#888;cursor:pointer;font-size:20px;line-height:1;">&times;</span>' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;padding:8px 12px;flex:1;min-height:300px;overflow:hidden;">' +
                        // Colonne gauche : tous les items
                        '<div style="display:flex;flex-direction:column;overflow:hidden;">' +
                            '<div style="font-size:10px;color:#888;margin-bottom:4px;">Tous les ' + label.toLowerCase() + 's</div>' +
                            '<input id="fria-picker-left-search" type="text" placeholder="Mot-cl\u00e9..." style="width:100%;padding:3px 6px;border-radius:4px;border:1px solid #555;background:#1a1a1e;color:#ccc;font-size:11px;box-sizing:border-box;outline:none;margin-bottom:4px;">' +
                            '<select id="fria-picker-left-author" style="width:100%;padding:2px 4px;border-radius:4px;border:1px solid #555;background:#1a1a1e;color:#bbb;font-size:10px;margin-bottom:4px;outline:none;">' +
                                '<option value="">Tous les auteurs</option>' +
                            '</select>' +
                            '<div id="fria-picker-left-list" style="flex:1;overflow-y:auto;border:1px solid #444;border-radius:4px;padding:2px;background:#1a1a1e;"></div>' +
                        '</div>' +
                        // Boutons centraux
                        '<div style="display:flex;flex-direction:column;justify-content:center;gap:8px;padding:4px;">' +
                            '<button id="fria-picker-to-right" title="D\u00e9placer vers la droite" style="padding:4px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:14px;line-height:1;">\u2192</button>' +
                            '<button id="fria-picker-to-left" title="D\u00e9placer vers la gauche" style="padding:4px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:14px;line-height:1;">\u2190</button>' +
                        '</div>' +
                        // Colonne droite : shortlist
                        '<div style="display:flex;flex-direction:column;overflow:hidden;">' +
                            '<div style="font-size:10px;color:#888;margin-bottom:4px;">Dans le dropdown</div>' +
                            '<input id="fria-picker-right-search" type="text" placeholder="Mot-cl\u00e9..." style="width:100%;padding:3px 6px;border-radius:4px;border:1px solid #555;background:#1a1a1e;color:#ccc;font-size:11px;box-sizing:border-box;outline:none;margin-bottom:4px;">' +
                            '<select id="fria-picker-right-author" style="width:100%;padding:2px 4px;border-radius:4px;border:1px solid #555;background:#1a1a1e;color:#bbb;font-size:10px;margin-bottom:4px;outline:none;">' +
                                '<option value="">Tous les auteurs</option>' +
                            '</select>' +
                            '<div id="fria-picker-right-list" style="flex:1;overflow-y:auto;border:1px solid #444;border-radius:4px;padding:2px;background:#1a1a1e;"></div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="padding:8px 16px;border-top:1px solid #444;display:flex;justify-content:flex-end;gap:6px;flex-shrink:0;">' +
                        '<button id="fria-picker-cancel" style="padding:4px 12px;border-radius:4px;border:1px solid #555;background:transparent;color:#888;cursor:pointer;font-size:11px;">Annuler</button>' +
                        '<button id="fria-picker-save" style="padding:4px 16px;border-radius:4px;border:none;background:#6366f1;color:white;cursor:pointer;font-size:11px;font-weight:600;">Valider</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(modal);

            // Events
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeModal();
            });
            document.getElementById('fria-picker-close').onclick = closeModal;
            document.getElementById('fria-picker-cancel').onclick = closeModal;
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal.style.display !== 'none') closeModal();
            });

            // Recherche et auteur
            document.getElementById('fria-picker-left-search').addEventListener('input', renderLists);
            document.getElementById('fria-picker-right-search').addEventListener('input', renderLists);
            document.getElementById('fria-picker-left-author').addEventListener('change', renderLists);
            document.getElementById('fria-picker-right-author').addEventListener('change', renderLists);

            // Boutons de transfert
            document.getElementById('fria-picker-to-right').onclick = function() { transferSelected('left', 'right'); };
            document.getElementById('fria-picker-to-left').onclick = function() { transferSelected('right', 'left'); };

            // Sauvegarde
            document.getElementById('fria-picker-save').onclick = function() {
                var result = Array.from(shortlistSet);
                onSave(result);
                closeModal();
            };

            // Stocker les données dans la modale
            modal._friaPickerData = {};
        }

        // ── Helper pour fermer ──
        function closeModal() {
            modal.style.display = 'none';
        }

        // ── Rendu des listes ──
        var _cachedAllItems = allItems;
        var _cachedIdField = idField;
        var _cachedNameField = nameField;
        var _cachedAuthorField = authorField;
        var _cachedDescField = descField;

        function renderLists() {
            var leftSearch = document.getElementById('fria-picker-left-search').value.toLowerCase().trim();
            var rightSearch = document.getElementById('fria-picker-right-search').value.toLowerCase().trim();
            var leftAuthor = document.getElementById('fria-picker-left-author').value;
            var rightAuthor = document.getElementById('fria-picker-right-author').value;

            var leftList = document.getElementById('fria-picker-left-list');
            var rightList = document.getElementById('fria-picker-right-list');

            // Filtrer gauche : items PAS dans la shortlist
            var leftItems = _cachedAllItems.filter(function(item) {
                var id = String(item[_cachedIdField]);
                if (shortlistSet.has(id)) return false;
                if (leftSearch && !(_cachedNameField && (item[_cachedNameField] || '').toLowerCase().includes(leftSearch)) && !(_cachedDescField && (item[_cachedDescField] || '').toLowerCase().includes(leftSearch))) return false;
                if (leftAuthor && (item[_cachedAuthorField] || '') !== leftAuthor) return false;
                return true;
            });

            // Filtrer droite : items DANS la shortlist
            var rightItems = _cachedAllItems.filter(function(item) {
                var id = String(item[_cachedIdField]);
                if (!shortlistSet.has(id)) return false;
                if (rightSearch && !(_cachedNameField && (item[_cachedNameField] || '').toLowerCase().includes(rightSearch)) && !(_cachedDescField && (item[_cachedDescField] || '').toLowerCase().includes(rightSearch))) return false;
                if (rightAuthor && (item[_cachedAuthorField] || '') !== rightAuthor) return false;
                return true;
            });

            renderList(leftList, leftItems, 'left');
            renderList(rightList, rightItems, 'right');

            // Mise à jour des compteurs
            var leftLabel = document.getElementById('fria-picker-left-label');
            var rightLabel = document.getElementById('fria-picker-right-label');
            if (leftLabel) leftLabel.textContent = 'Tous les ' + label.toLowerCase() + 's (' + leftItems.length + ')';
            if (rightLabel) rightLabel.textContent = 'Dans le dropdown (' + rightItems.length + ')';
        }

        // ── Rendu d'une liste ──
        function renderList(container, items, side) {
            container.innerHTML = '';
            if (items.length === 0) {
                var empty = document.createElement('div');
                empty.textContent = 'Aucun';
                Object.assign(empty.style, { padding: '12px', textAlign: 'center', color: '#666', fontSize: '11px' });
                container.appendChild(empty);
                return;
            }
            items.forEach(function(item) {
                var div = document.createElement('div');
                var itemId = String(item[_cachedIdField]);

                // Highlight si sélectionné
                div.dataset.id = itemId;
                div.dataset.side = side;

                Object.assign(div.style, {
                    padding: '5px 6px', margin: '1px 0', borderRadius: '4px',
                    cursor: 'pointer', fontSize: '11px',
                    border: '1px solid transparent',
                    background: (_selected.has(side + ':' + itemId)) ? '#4a4a6e' : 'transparent',
                    color: '#ddd',
                });
                div.onmouseenter = function() {
                    if (!_selected.has(side + ':' + itemId)) div.style.background = '#3a3a3e';
                };
                div.onmouseleave = function() {
                    if (!_selected.has(side + ':' + itemId)) div.style.background = 'transparent';
                };

                // Nom
                var nameSpan = document.createElement('div');
                nameSpan.textContent = item[_cachedNameField] || ('Item ' + itemId);
                Object.assign(nameSpan.style, { fontWeight: '600', color: '#eee', marginBottom: '1px' });
                div.appendChild(nameSpan);

                // Auteur
                if (item[_cachedAuthorField]) {
                    var authorSpan = document.createElement('div');
                    authorSpan.textContent = item[_cachedAuthorField];
                    Object.assign(authorSpan.style, { color: '#888', fontSize: '10px' });
                    div.appendChild(authorSpan);
                }

                // Description preview
                if (_cachedDescField && item[_cachedDescField]) {
                    var descSpan = document.createElement('div');
                    var desc = item[_cachedDescField];
                    if (typeof desc === 'string') {
                        descSpan.textContent = desc.substring(0, 60) + (desc.length > 60 ? '...' : '');
                    } else {
                        descSpan.textContent = String(desc).substring(0, 60);
                    }
                    Object.assign(descSpan.style, { color: '#777', fontSize: '10px', fontStyle: 'italic', marginTop: '1px' });
                    div.appendChild(descSpan);
                }

                // Click pour sélection
                div.onclick = function(e) {
                    var key = side + ':' + itemId;
                    if (e.shiftKey) {
                        // Shift+click : sélection de plage
                        var siblings = Array.from(container.children);
                        var idx = siblings.indexOf(div);
                        // Trouver le dernier élément cliqué
                        var lastClicked = siblings.findIndex(function(s) {
                            return _selected.has(side + ':' + s.dataset.id);
                        });
                        if (lastClicked >= 0 && lastClicked !== idx) {
                            var start = Math.min(lastClicked, idx);
                            var end = Math.max(lastClicked, idx);
                            for (var i = start; i <= end; i++) {
                                var sid = siblings[i].dataset.id;
                                if (sid) _selected.add(side + ':' + sid);
                            }
                        } else {
                            _selected.add(key);
                        }
                    } else if (e.ctrlKey || e.metaKey) {
                        // Ctrl+click : toggle
                        if (_selected.has(key)) {
                            _selected.delete(key);
                        } else {
                            _selected.add(key);
                        }
                    } else {
                        // Click simple : remplacer la sélection
                        _selected.clear();
                        _selected.add(key);
                    }
                    // Re-rendre les deux listes
                    renderLists();
                };

                container.appendChild(div);
            });
        }

        // ── Transfert de sélection ──
        function transferSelected(fromSide, toSide) {
            // Collecter les IDs sélectionnés dans fromSide
            var toMove = [];
            _selected.forEach(function(key) {
                if (key.startsWith(fromSide + ':')) {
                    toMove.push(key.split(':')[1]);
                }
            });

            if (toMove.length === 0) return;

            if (fromSide === 'left') {
                // Déplacer de gauche vers droite = ajouter à la shortlist
                toMove.forEach(function(id) { shortlistSet.add(id); });
            } else {
                // Déplacer de droite vers gauche = retirer de la shortlist
                toMove.forEach(function(id) { shortlistSet.delete(id); });
            }

            // Reset sélection
            _selected.clear();

            // Re-rendre
            renderLists();
        }

        // ── Sélection ──
        var _selected = new Set();

        // ── Peupler les dropdowns d'auteurs ──
        function populateAuthorFilters() {
            var authors = new Set();
            _cachedAllItems.forEach(function(item) {
                if (item[_cachedAuthorField]) authors.add(item[_cachedAuthorField]);
            });
            var sorted = Array.from(authors).sort();
            ['fria-picker-left-author', 'fria-picker-right-author'].forEach(function(id) {
                var sel = document.getElementById(id);
                var currentVal = sel.value;
                sel.innerHTML = '<option value="">Tous les auteurs</option>';
                sorted.forEach(function(a) {
                    var o = document.createElement('option');
                    o.value = a;
                    o.textContent = a;
                    sel.appendChild(o);
                });
                if ([...sel.options].some(function(o) { return o.value === currentVal; })) {
                    sel.value = currentVal;
                }
            });
        }

        // ── Initialisation ──
        document.getElementById('fria-picker-title').textContent = 'Choisir les ' + label.toLowerCase() + 's du dropdown';
        populateAuthorFilters();
        _selected.clear();

        // Rendu initial
        // S'assurer que les shortlist items sont dans le Set
        currentShortlist.forEach(function(id) { shortlistSet.add(String(id)); });
        _cachedAllItems = allItems;
        _cachedIdField = idField;
        _cachedNameField = nameField;
        _cachedAuthorField = authorField;
        _cachedDescField = descField;
        renderLists();

        // Reset champs recherche
        document.getElementById('fria-picker-left-search').value = '';
        document.getElementById('fria-picker-right-search').value = '';

        // Afficher
        modal.style.display = 'flex';
        setTimeout(function() { document.getElementById('fria-picker-left-search').focus(); }, 100);
    }

    // ── Exposer ──
    window.FRIA = window.FRIA || {};
    window.FRIA.PickerConfig = {
        setup: setupPickerConfig,
        openModal: openPickerModal,
    };
})();
