/**
 * FR.IA Elements Picker — Custom widget for ComfyUI node.
 *
 * Flux de données :
 *   - "Test generation" : JS appelle l'API → aperçu instantané dans le textarea
 *   - "Run" (workflow) : Python lit _elements_json + _api_config, appelle l'API
 *     lui-même avec le seed → résultat déterministe affiché via onExecuted
 *
 * Les widgets _elements_json et _api_config sont masqués dans l'UI ComfyUI
 * mais sérialisés dans le workflow pour que Python y ait accès.
 */

const STORAGE_KEY = "FRIA_config";

function getConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
}

function getApiUrl() {
    return "https://kw.holaf.fr/api";
}

function getApiKey() {
    return getConfig().apiKey || "";
}

function apiHeaders() {
    const h = { "Content-Type": "application/json" };
    const key = getApiKey();
    if (key) h["Authorization"] = `Bearer ${key}`;
    return h;
}

async function apiCall(method, path, body) {
    const opts = { method, headers: apiHeaders() };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`${getApiUrl()}/${path.replace(/^\//, "")}`, opts);
    if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${txt.substring(0, 200)}`);
    }
    return resp.json();
}

// Cacher un widget ComfyUI : reste dans node.widgets (sérialisé) mais invisible dans l'UI.
// IMPORTANT : ne PAS changer widget.type en "hidden" car ComfyUI le
// désérialiserait à vide. On utilise uniquement widget.hidden = true
// et on réduit sa hauteur à 0.
function hideWidget(node, name) {
    const w = node.widgets?.find(x => x.name === name);
    if (w) {
        w.hidden = true;
        w.computeSize = () => [0, -4]; // hauteur négative = ligne compressée
        return w;
    }
    return null;
}

// Attendre que l'app ComfyUI soit disponible
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    app.registerExtension({
        name: "FR.IA.Elements",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "FRIAElementsNode") return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated?.apply(this, arguments);
                const node = this;

                // ---- Masquer les widgets sérialisés (_elements_json, _api_config) ----
                hideWidget(node, "_elements_json");
                hideWidget(node, "_api_config");

                // Le widget seed est géré nativement par ComfyUI.

                // Stockage local des éléments
                if (!node._friaElements) node._friaElements = [];

                // ---- Sync les widgets sérialisés ----
                function syncElementsWidget() {
                    const w = node.widgets?.find(x => x.name === "_elements_json");
                    if (!w) return;
                    w.value = JSON.stringify({
                        elements: node._friaElements.map(e => {
                            if (e.type === "filter") return { type: "filter", id: e.id, name: e.name || "", author: e.author || "", is_public: !!e.is_public };
                            if (e.type === "text") return { type: "text", text: e.text };
                            return e;
                        }),
                        random_count: randCb.checked ? (parseInt(randN.value) || 3) : 0,
                        random_sfw: sfwCb.checked,
                        random_nsfw: nsfwCb.checked,
                    });
                }

                function syncApiConfigWidget() {
                    const w = node.widgets?.find(x => x.name === "_api_config");
                    if (!w) return;
                    w.value = JSON.stringify({
                        api_url: getApiUrl(),
                        api_key: getApiKey(),
                    });
                }

                // Sync initial
                syncApiConfigWidget();

                // ========================================
                // LAYOUT : flex column, la liste s'étend,
                // le résultat est fixé en bas
                // ========================================

                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%",
                    height: "100%",         // Remplit l'espace alloué par ComfyUI
                    minHeight: "280px",
                    background: "#2a2a2e",
                    borderRadius: "8px",
                    padding: "8px",
                    boxSizing: "border-box",
                    fontSize: "12px",
                    color: "#ccc",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                });

                // ---- Toolbar (hauteur fixe) ----
                const tb = document.createElement("div");
                Object.assign(tb.style, {
                    display: "flex", gap: "4px", marginBottom: "8px",
                    flex: "0 0 auto",
                });

                const mkBtn = (text, primary) => {
                    const b = document.createElement("button");
                    b.textContent = text;
                    Object.assign(b.style, {
                        flex: "1", padding: "4px 8px", borderRadius: "4px",
                        border: primary ? "none" : "1px solid #555",
                        fontSize: "11px", cursor: "pointer",
                        background: primary ? "#6366f1" : "#3a3a3e",
                        color: primary ? "white" : "#ccc",
                        fontWeight: primary ? "600" : "normal",
                    });
                    b.onmouseenter = () => {
                        if (primary) b.style.background = "#5558e8";
                        else b.style.background = "#4a4a4e";
                    };
                    b.onmouseleave = () => {
                        if (primary) b.style.background = "#6366f1";
                        else b.style.background = "#3a3a3e";
                    };
                    return b;
                };

                const addFilterBtn = mkBtn("+ Add saved filter");

                tb.appendChild(addFilterBtn);

                // ---- Liste des éléments (flex: grow, absorbe l'espace) ----
                const listEl = document.createElement("div");
                Object.assign(listEl.style, {
                    flex: "1 1 0",           // Prend tout l'espace dispo
                    minHeight: "40px",       // Hauteur mini pour être utilisable
                    overflowY: "auto",
                    marginBottom: "8px",
                    border: "1px dashed #555",
                    borderRadius: "4px",
                    padding: "4px",
                    fontSize: "11px",
                    color: "#666",
                });

                function renderList() {
                    const items = node._friaElements || [];
                    if (items.length === 0) {
                        listEl.innerHTML = "Aucun élément. Ajoutez des filtres.";
                        listEl.style.color = "#666";
                        return;
                    }
                    listEl.style.color = "#ccc";
                    listEl.innerHTML = "";
                    items.forEach((item, idx) => {
                        const row = document.createElement("div");
                        Object.assign(row.style, {
                            display: "flex", alignItems: "center", gap: "4px",
                            padding: "3px 4px", borderRadius: "3px", marginBottom: "2px",
                            background: item.type === "filter" ? "#2d3748" : "#1a365d",
                            border: "1px solid #555",
                            cursor: "grab",
                        });

                        // Poignée de drag (⠿) + boutons haut/bas
                        const grip = document.createElement("span");
                        grip.textContent = "⠿";
                        Object.assign(grip.style, {
                            cursor: "grab", color: "#666", fontSize: "10px", flexShrink: "0",
                            userSelect: "none", marginRight: "2px",
                        });

                        // Boutons monter/descendre
                        const upBtn = document.createElement("button");
                        upBtn.textContent = "▲";
                        Object.assign(upBtn.style, {
                            background: "none", border: "none", color: "#888", cursor: "pointer",
                            fontSize: "8px", padding: "0", lineHeight: "1", flexShrink: "0",
                        });
                        upBtn.title = "Monter";
                        upBtn.onclick = () => {
                            if (idx > 0) {
                                [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
                                renderList();
                                syncElementsWidget();
                            }
                        };

                        const dnBtn = document.createElement("button");
                        dnBtn.textContent = "▼";
                        Object.assign(dnBtn.style, {
                            background: "none", border: "none", color: "#888", cursor: "pointer",
                            fontSize: "8px", padding: "0", lineHeight: "1", flexShrink: "0",
                        });
                        dnBtn.title = "Descendre";
                        dnBtn.onclick = () => {
                            if (idx < items.length - 1) {
                                [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
                                renderList();
                                syncElementsWidget();
                            }
                        };

                        row.appendChild(grip);
                        row.appendChild(upBtn);
                        row.appendChild(dnBtn);
                        const iconSpan = document.createElement("span");
                        iconSpan.style.cssText = "flex-shrink:0;";
                        iconSpan.textContent = item.type === "filter" ? "🔽" : "🧠";
                        row.appendChild(iconSpan);

                        // Nom (ellipsis si trop long)
                        const label = document.createElement("span");
                        label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                        if (item.type === "filter") {
                            label.textContent = item.name || `Filtre #${item.id}`;
                        } else {
                            label.textContent = item.text || "?";
                        }
                        row.appendChild(label);

                        // Badge auteur + visibilité
                        if (item.type === "filter" && item.author) {
                            const meta = document.createElement("span");
                            meta.style.cssText = "font-size:10px;color:#999;white-space:nowrap;flex-shrink:0;";
                            meta.textContent = `${item.author} ${item.is_public ? "🌐" : "🔒"}`;
                            row.appendChild(meta);
                        } else if (item.type === "filter") {
                            const vis = document.createElement("span");
                            vis.style.cssText = "flex-shrink:0;";
                            vis.textContent = item.is_public ? "🌐" : "🔒";
                            row.appendChild(vis);
                        }

                        // Bouton supprimer
                        const del = document.createElement("button");
                        del.textContent = "✕";
                        Object.assign(del.style, {
                            background: "none", border: "none", color: "#f87171",
                            cursor: "pointer", fontSize: "11px", padding: "0 2px", flexShrink: "0",
                        });
                        del.onclick = () => {
                            items.splice(idx, 1);
                            renderList();
                            syncElementsWidget();
                        };
                        row.appendChild(del);
                        listEl.appendChild(row);
                    });
                }

                // ---- Add saved filter ----
                addFilterBtn.onclick = async () => {
                    try {
                        const [filters, me] = await Promise.all([
                            apiCall("GET", "filters"),
                            apiCall("GET", "auth/me").catch(() => null),
                        ]);
                        const currentUserId = me?.id || null;
                        showFilterPicker(filters, currentUserId, (filter) => {
                            node._friaElements.push({
                                type: "filter",
                                id: filter.id,
                                name: filter.name,
                                author: filter.user_id === currentUserId ? "vous" : (filter.owner_name || filter.user_id?.substring(0,6) || "?"),
                                is_public: !!filter.is_public,
                            });
                            renderList();
                            syncElementsWidget();
                        });
                    } catch (err) {
                        showToast("Erreur", "Impossible de charger les filtres : " + err.message);
                    }
                };

                // ---- Random + SFW/NSFW row (hauteur fixe) ----
                const randRow = document.createElement("div");
                Object.assign(randRow.style, {
                    display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "4px",
                    flex: "0 0 auto",
                });

                const randCb = document.createElement("input");
                randCb.type = "checkbox";
                randCb.checked = false;
                randCb.id = "fria-rand-" + node.id;

                const randN = document.createElement("input");
                randN.type = "number";
                randN.value = "3";
                Object.assign(randN.style, {
                    width: "40px", padding: "2px 4px", borderRadius: "4px",
                    border: "1px solid #555", background: "1a1a1e",
                    color: "#fff", fontSize: "11px", textAlign: "center",
                });
                randN.min = 1;
                randN.max = 20;

                const randLabel = document.createElement("label");
                randLabel.style.fontSize = "11px";
                randLabel.htmlFor = randCb.id;
                randLabel.textContent = "Add random";

                // Séparateur visuel
                const randSep = document.createElement("span");
                randSep.textContent = "|";
                Object.assign(randSep.style, { color: "#555", fontSize: "11px" });

                // ---- SFW / NSFW checkboxes ----
                const sfwCb = document.createElement("input");
                sfwCb.type = "checkbox";
                sfwCb.checked = true;
                sfwCb.id = "fria-sfw-" + node.id;
                const sfwLabel = document.createElement("label");
                sfwLabel.style.fontSize = "11px";
                sfwLabel.htmlFor = sfwCb.id;
                sfwLabel.textContent = "SFW";
                sfwLabel.style.color = "#4ade80";

                const nsfwCb = document.createElement("input");
                nsfwCb.type = "checkbox";
                nsfwCb.checked = false;
                nsfwCb.id = "fria-nsfw-" + node.id;
                const nsfwLabel = document.createElement("label");
                nsfwLabel.style.fontSize = "11px";
                nsfwLabel.htmlFor = nsfwCb.id;
                nsfwLabel.textContent = "NSFW";
                nsfwLabel.style.color = "#f87171";

                randRow.appendChild(randCb);
                randRow.appendChild(randLabel);
                randRow.appendChild(document.createTextNode(" N:"));
                randRow.appendChild(randN);
                randRow.appendChild(randSep);
                randRow.appendChild(sfwCb);
                randRow.appendChild(sfwLabel);
                randRow.appendChild(nsfwCb);
                randRow.appendChild(nsfwLabel);

                // Validation : au moins un des deux doit être coché
                function validateNsfwCheckboxes() {
                    if (!sfwCb.checked && !nsfwCb.checked) {
                        sfwCb.checked = true; // Forcer au moins SFW
                    }
                }
                sfwCb.onchange = () => { validateNsfwCheckboxes(); syncElementsWidget(); };
                nsfwCb.onchange = () => { validateNsfwCheckboxes(); syncElementsWidget(); };
                randCb.onchange = () => { syncElementsWidget(); };
                randN.onchange = () => { syncElementsWidget(); };
                randN.oninput = () => { syncElementsWidget(); };

                // ---- Test generation button (hauteur fixe) ----
                const genBtn = mkBtn("🔄  Test generation", true);
                genBtn.style.width = "100%";
                genBtn.style.padding = "6px";
                genBtn.style.marginBottom = "8px";
                genBtn.style.flex = "0 0 auto";

                genBtn.onclick = () => triggerGenerate(node);

                // ---- triggerGenerate ----
                function triggerGenerate(n) {
                    const elements = n._friaElements || [];

                    if (elements.length === 0 && !randCb.checked) {
                        result.value = "Ajoutez au moins un élément ou activez Add random.";
                        return;
                    }

                    // Lire le seed depuis le widget ComfyUI
                    const sw = n.widgets?.find(w => w.name === "seed");
                    const seed = sw ? parseInt(sw.value) || 0 : 0;

                    // Construire le payload
                    const payload = { elements: [] };
                    if (seed > 0) payload.seed = seed;

                    elements.forEach(e => {
                        if (e.type === "filter") payload.elements.push({ type: "filter", id: e.id });
                        else if (e.type === "text") payload.elements.push({ type: "text", text: e.text });
                    });

                    if (randCb.checked) {
                        payload.random_count = parseInt(randN.value) || 3;
                        payload.random_sfw = sfwCb.checked;
                        payload.random_nsfw = nsfwCb.checked;
                    }

                    result.value = "Génération en cours...";

                    apiCall("POST", "generate", payload).then(data => {
                        const prompt = data.prompt || "";
                        if (node._resultArea) node._resultArea.value = prompt;
                        syncElementsWidget();
                        syncApiConfigWidget();
                    }).catch(err => {
                        if (node._resultArea) node._resultArea.value = "Erreur : " + err.message;
                    });
                }

                // ---- Result area (hauteur fixe, calée en bas, pas de resize) ----
                const result = document.createElement("textarea");
                Object.assign(result.style, {
                    width: "100%",
                    height: "54px",            // Hauteur fixe
                    minHeight: "54px",
                    maxHeight: "54px",
                    borderRadius: "4px",
                    border: "1px solid #555",
                    padding: "4px",
                    background: "#1a1a1e",
                    color: "#fff",
                    fontSize: "11px",
                    resize: "none",            // PAS de resize
                    boxSizing: "border-box",
                    flex: "0 0 auto",          // Ne s'étend pas, fixé en bas
                });
                result.placeholder = "Résultat...";
                result.readOnly = true;

                // ---- Assemble ----
                container.appendChild(tb);        // fixe
                container.appendChild(listEl);    // flex: grow
                container.appendChild(randRow);   // fixe
                container.appendChild(genBtn);    // fixe
                container.appendChild(result);     // fixe en bas

                // Intégrer dans le layout ComfyUI via addDOMWidget
                const domWidget = node.addDOMWidget("elements_ui", "custom", container, {
                    getValue: () => "",
                    setValue: (v) => {},
                });
                domWidget.options = domWidget.options || {};
                domWidget.options.height = 300;

                // ---- Taille minimum de la node ----
                const MIN_WIDTH = 360;

                // Intercepter le resize pour imposer un minimum
                const origOnResize = node.onResize;
                node.onResize = function (size) {
                    if (origOnResize) origOnResize.call(this, size);
                    if (size[0] < MIN_WIDTH) size[0] = MIN_WIDTH;
                };

                // Appliquer la taille initiale
                requestAnimationFrame(() => {
                    if (node.size) {
                        if (node.size[0] < MIN_WIDTH) {
                            node.setSize([MIN_WIDTH, node.size[1]]);
                        }
                    }
                });

                // ---- Persistance workflow (sauvegarde/chargement) ----
                // ComfyUI charge les valeurs des widgets APRÈS onNodeCreated.
                // On stocke la fonction de restauration sur l'instance du node
                // pour pouvoir l'appeler depuis loadedGraphNode ou afterConfigureGraph.
                // En fallback, on tente aussi périodiquement.

                function restoreFromWidgets(n) {
                    const ej = n.widgets?.find(w => w.name === "_elements_json");
                    if (!ej || !ej.value || ej.value === "{}" || ej.value === "") return false;
                    try {
                        const data = JSON.parse(ej.value);
                        if (data.elements && Array.isArray(data.elements) && data.elements.length > 0 && n._friaElements.length === 0) {
                            n._friaElements = data.elements.map(e => {
                                if (e.type === "filter") {
                                    return {
                                        type: "filter",
                                        id: e.id,
                                        name: e.name || `Filtre #${e.id}`,
                                        author: e.author || "?",
                                        is_public: !!e.is_public,
                                    };
                                }
                                return e; // text elements sont complets
                            });
                            renderList();
                        }
                        if (data.random_sfw !== undefined) sfwCb.checked = !!data.random_sfw;
                        if (data.random_nsfw !== undefined) nsfwCb.checked = !!data.random_nsfw;
                        if (data.random_count > 0) {
                            randCb.checked = true;
                            randN.value = data.random_count;
                        }
                        return true; // Succès
                    } catch (err) {
                        console.warn("[FR.IA] Impossible de restaurer les éléments :", err);
                        return false;
                    }
                }

                // Stocker sur l'instance pour que les hooks d'extension puissent l'appeler
                node._friaRestore = restoreFromWidgets.bind(null, node);

                // Fallback : tente de restaurer périodiquement (pour F5 et cas où les hooks ne marchent pas)
                let restoreAttempts = 0;
                function delayedRestore() {
                    if (restoreFromWidgets(node)) return;
                    restoreAttempts++;
                    if (restoreAttempts < 20) {
                        setTimeout(delayedRestore, 300);
                    }
                }
                setTimeout(delayedRestore, 100);

                // Stocker les refs
                node._resultArea = result;
                node._domWidget = domWidget;

                // ---- onExecuted SUR L'INSTANCE (pas le prototype !) ----
                // LiteGraph met this.onExecuted = null dans son constructeur,
                // ce qui MASQUE tout override sur nodeType.prototype.
                // On doit donc écraser la propriété directement sur l'instance.
                const origExec = node.onExecuted; // null (mis par le constructeur)
                node.onExecuted = function (output) {
                    if (origExec) origExec.call(this, output);

                    // ComfyUI passe le résultat differemment selon la version :
                    //   Nouveau frontend : detail.output = { elements: ["text"] }
                    //   Ancien frontend : output = { elements: "text" } ou ["text"]
                    let text = null;
                    if (output && typeof output === 'object') {
                        if (output.output !== undefined) {
                            const out = output.output;
                            if (typeof out === 'object' && !Array.isArray(out) && out.elements !== undefined) text = out.elements;
                            else if (Array.isArray(out) && out.length > 0) text = out[0];
                            else if (typeof out === 'string') text = out;
                        }
                        if (text === null && output.elements !== undefined) text = output.elements;
                        if (text === null && Array.isArray(output) && output.length > 0) text = output[0];
                        // ComfyUI sérialise souvent les sorties avec des clés numériques : {"0": "text"}
                        if (text === null) {
                            for (const key of Object.keys(output)) {
                                if (/^\d+$/.test(key)) { text = output[key]; break; }
                            }
                        }
                    }
                    if (text === null && typeof output === 'string') text = output;

                    if (text !== null && text !== undefined) {
                        const str = Array.isArray(text) ? text.join("") : String(text);
                        console.log("[FR.IA] onExecuted result:", str.substring(0, 80));
                        if (node._resultArea) {
                            node._resultArea.value = str;
                        }
                    } else if (output) {
                        console.log("[FR.IA] onExecuted: format inconnu:", JSON.stringify(output).substring(0, 200));
                    }
                };

                // Sync initial
                syncElementsWidget();
                syncApiConfigWidget();

                return r;
            };
        },

        // Hook appelé APRÈS que ComfyUI a restauré les widgets depuis le workflow
        async loadedGraphNode(node) {
            if (node._friaRestore) {
                setTimeout(() => node._friaRestore(), 0);
            }
        },

        // Écouteur d'événements API global (la méthode la plus fiable)
        async setup() {
            // API singleton : ancien frontend (window.app.api) ou nouveau (window.comfyAPI.api)
            const api = window.app?.api || window.comfyAPI?.api;
            if (!api) return;

            api.addEventListener("executed", ({ detail }) => {
                if (!detail?.node || !detail?.output) return;
                
                // Trouver le nœud dans le graph
                const node = window.app.graph.getNodeById(detail.node);
                if (!node || node.type !== "FRIAElementsNode" || !node._resultArea) return;

                const output = detail.output;
                let text = null;

                // Extraction robuste du texte
                if (output.elements !== undefined) text = output.elements;
                else if (Array.isArray(output) && output.length > 0) text = output[0];
                else if (typeof output === 'string') text = output;
                else if (output.output) { // Format nested
                    const o = output.output;
                    if (o.elements !== undefined) text = o.elements;
                    else if (Array.isArray(o) && o.length > 0) text = o[0];
                }
                // ComfyUI sérialise souvent avec clés numériques : {"0": "text"}
                if (text === null && typeof output === 'object') {
                    for (const key of Object.keys(output)) {
                        if (/^\d+$/.test(key)) { text = output[key]; break; }
                    }
                }

                if (text !== null && text !== undefined) {
                    const str = Array.isArray(text) ? text.join("") : String(text);
                    node._resultArea.value = str;
                    console.log("[FR.IA] WebSocket executed update:", str.substring(0, 50));
                }
            });
        }
    });
})();

// ========================
// Utilitaires : modales et toots
// ========================

function showFilterPicker(filters, currentUserId, onSelect) {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "99999",
        background: "rgba(0,0,0,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
    });

    const modal = document.createElement("div");
    Object.assign(modal.style, {
        background: "#2a2a2e", borderRadius: "12px", padding: "16px",
        width: "380px", maxHeight: "70vh", overflowY: "auto",
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
    });

    const mine = currentUserId
        ? filters.filter(f => f.user_id === currentUserId && !f.is_public)
        : filters.filter(f => f.user_id && !f.is_public);
    const pub = filters.filter(f => f.is_public);

    let html = `<h3 style="margin:0 0 12px; font-size:14px; color:#fff;">Choisir un filtre</h3>`;

    if (mine.length > 0) {
        html += `<p style="margin:8px 0 4px; font-size:11px; color:#888;">Mes filtres</p>`;
        mine.forEach(f => {
            html += `<div onclick="window._friaPickFilter(${f.id})" style="padding:6px 8px; cursor:pointer; border-radius:4px; font-size:12px; color:#ccc; background:#3a3a3e; margin-bottom:2px;" onmouseenter="this.style.background='#4a4a4e'" onmouseleave="this.style.background='#3a3a3e'">${f.name} ${f.nsfw ? '🔞' : ''}</div>`;
        });
    }
    if (pub.length > 0) {
        html += `<p style="margin:8px 0 4px; font-size:11px; color:#888;">Filtres publics</p>`;
        pub.forEach(f => {
            html += `<div onclick="window._friaPickFilter(${f.id})" style="padding:6px 8px; cursor:pointer; border-radius:4px; font-size:12px; color:#ccc; background:#3a3a3e; margin-bottom:2px;" onmouseenter="this.style.background='#4a4a4e'" onmouseleave="this.style.background='#3a3a3e'">${f.name} ${f.nsfw ? '🔞' : ''} <span style="color:#888;font-size:10px;">par ${f.user_id?.substring(0,6) || '?'}</span></div>`;
        });
    }

    if (filters.length === 0) {
        html += `<p style="font-size:12px; color:#666;">Aucun filtre disponible.</p>`;
    }

    html += `<div style="margin-top:12px; text-align:right;">
        <button id="fria-picker-cancel" style="padding:6px 12px; border-radius:4px; border:1px solid #555; background:transparent; color:#ccc; cursor:pointer; font-size:12px;">Fermer</button>
    </div>`;

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const pickerData = filters;
    window._friaPickFilter = (id) => {
        const f = pickerData.find(x => x.id === id);
        if (f && onSelect) onSelect(f);
        overlay.remove();
        delete window._friaPickFilter;
    };

    document.getElementById("fria-picker-cancel").onclick = () => {
        overlay.remove();
        delete window._friaPickFilter;
    };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function showPrompt(title, msg, placeholder, cb) {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "99999",
        background: "rgba(0,0,0,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
    });

    const modal = document.createElement("div");
    Object.assign(modal.style, {
        background: "#2a2a2e", borderRadius: "12px", padding: "16px",
        width: "340px", boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
    });

    modal.innerHTML = `
        <h3 style="margin:0 0 8px; font-size:14px; color:#fff;">${title}</h3>
        <p style="margin:0 0 12px; font-size:12px; color:#888;">${msg}</p>
        <input id="fria-prompt-input" type="text" placeholder="${placeholder || ''}"
               style="width:100%; padding:8px; border-radius:6px; border:1px solid #555;
                      background:#1a1a1e; color:#fff; font-size:13px; box-sizing:border-box;">
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
            <button id="fria-prompt-cancel" style="padding:6px 12px; border-radius:4px; border:1px solid #555; background:transparent; color:#ccc; cursor:pointer; font-size:12px;">Annuler</button>
            <button id="fria-prompt-ok" style="padding:6px 12px; border-radius:4px; border:none; background:#6366f1; color:white; cursor:pointer; font-size:12px; font-weight:600;">OK</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const input = document.getElementById("fria-prompt-input");
    setTimeout(() => input.focus(), 50);

    const close = (result) => {
        overlay.remove();
        if (cb && result !== null) cb(result);
    };

    document.getElementById("fria-prompt-ok").onclick = () => close(input.value.trim());
    document.getElementById("fria-prompt-cancel").onclick = () => close(null);
    input.onkeydown = (e) => { if (e.key === "Enter") close(input.value.trim()); };
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
}

function showToast(title, msg) {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", bottom: "20px", right: "20px", zIndex: "99999",
        background: "#2a2a2e", borderRadius: "8px", padding: "12px 16px",
        border: "1px solid #555", maxWidth: "350px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    });
    overlay.innerHTML = `
        <strong style="font-size:12px; color:#f87171;">${title}</strong>
        <p style="margin:4px 0 0; font-size:11px; color:#ccc;">${msg}</p>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 4000);
}