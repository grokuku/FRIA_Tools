/**
 * FR.IA Elements Picker — Custom widget for ComfyUI node.
 * Renders an interactive UI inside the node :
 *   - Add saved filter / Add semantic buttons
 *   - List of elements with remove (✕)
 *   - Add random checkbox + count
 *   - Generate button + preview area
 *   - Calls API with Bearer token from localStorage
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

                // Widget caché pour la sortie
                this._resultWidget = this.addWidget("hidden", "_result", "", () => {});

                // Le widget seed est géré nativement par ComfyUI (avec control_after_generate).
                // On NE PASSE PAS de callback personnalisé — le seed est lu au moment
                // de la génération via triggerGenerate.
                // L'ancien code écrasait le callback par défaut de ComfyUI, ce qui
                // cassait le comportement "randomize" / "increment" du seed.

                // Stockage local des éléments
                if (!this._friaElements) this._friaElements = [];

                // ---- UI Container ----
                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%", minHeight: "280px",
                    background: "#2a2a2e", borderRadius: "8px",
                    padding: "8px", boxSizing: "border-box",
                    fontSize: "12px", color: "#ccc",
                });

                // ---- Toolbar ----
                const tb = document.createElement("div");
                Object.assign(tb.style, { display: "flex", gap: "4px", marginBottom: "8px" });

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
                const addSemBtn = mkBtn("+ Add semantic");
                tb.appendChild(addFilterBtn);
                tb.appendChild(addSemBtn);

                // ---- Liste des éléments ----
                const listEl = document.createElement("div");
                Object.assign(listEl.style, {
                    minHeight: "60px", maxHeight: "120px", overflowY: "auto",
                    marginBottom: "8px", border: "1px dashed #555",
                    borderRadius: "4px", padding: "4px", fontSize: "11px", color: "#666",
                });

                function renderList() {
                    const items = node._friaElements || [];
                    if (items.length === 0) {
                        listEl.innerHTML = "Aucun élément. Ajoutez des filtres ou une recherche sémantique.";
                        listEl.style.color = "#666";
                        return;
                    }
                    listEl.style.color = "#ccc";
                    listEl.innerHTML = "";
                    items.forEach((item, idx) => {
                        const row = document.createElement("div");
                        Object.assign(row.style, {
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "3px 4px", borderRadius: "3px", marginBottom: "2px",
                            background: item.type === "filter" ? "#2d3748" : "#1a365d",
                            border: "1px solid #555",
                        });
                        const label = document.createElement("span");
                        label.style.flex = "1";
                        if (item.type === "filter") {
                            label.textContent = `🔽 ${item.name || `Filtre #${item.id}`}`;
                        } else {
                            label.textContent = `🧠 ${item.text || "?"}`;
                        }

                        const del = document.createElement("button");
                        del.textContent = "✕";
                        Object.assign(del.style, {
                            background: "none", border: "none", color: "#f87171",
                            cursor: "pointer", fontSize: "11px", padding: "0 4px",
                        });
                        del.onclick = () => {
                            items.splice(idx, 1);
                            renderList();
                            // Mettre à jour le widget résultat si vide
                            if (items.length === 0 && node._resultWidget) {
                                node._resultWidget.value = "";
                            }
                        };

                        row.appendChild(label);
                        row.appendChild(del);
                        listEl.appendChild(row);
                    });
                }

                // ---- Add saved filter ----
                addFilterBtn.onclick = async () => {
                    try {
                        const filters = await apiCall("GET", "filters");
                        showFilterPicker(filters, (filter) => {
                            node._friaElements.push({
                                type: "filter",
                                id: filter.id,
                                name: filter.name,
                            });
                            renderList();
                        });
                    } catch (err) {
                        showToast("Erreur", "Impossible de charger les filtres : " + err.message);
                    }
                };

                // ---- Add semantic ----
                addSemBtn.onclick = () => {
                    showPrompt("Recherche sémantique", "Entrez votre recherche :", "", (text) => {
                        if (text && text.trim()) {
                            node._friaElements.push({
                                type: "text",
                                text: text.trim(),
                            });
                            renderList();
                        }
                    });
                };

                // ---- Random row ----
                const randRow = document.createElement("div");
                Object.assign(randRow.style, {
                    display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px",
                });

                const randCb = document.createElement("input");
                randCb.type = "checkbox";
                randCb.checked = false;

                const randN = document.createElement("input");
                randN.type = "number";
                randN.value = "3";
                Object.assign(randN.style, {
                    width: "40px", padding: "2px 4px", borderRadius: "4px",
                    border: "1px solid #555", background: "#1a1a1e",
                    color: "#fff", fontSize: "11px", textAlign: "center",
                });
                randN.min = 0;
                randN.max = 20;

                const randLabel = document.createElement("label");
                randLabel.style.fontSize = "11px";
                randLabel.textContent = "Add random";

                randRow.appendChild(randCb);
                randRow.appendChild(randLabel);
                randRow.appendChild(document.createTextNode(" N:"));
                randRow.appendChild(randN);

                // ---- Generate button ----
                const genBtn = mkBtn("🔄  Générer", true);
                genBtn.style.width = "100%";
                genBtn.style.padding = "6px";
                genBtn.style.marginBottom = "8px";

                genBtn.onclick = () => triggerGenerate(node);

                // ---- triggerGenerate : appelle l'API avec le seed courant ----
                function triggerGenerate(n) {
                    const elements = n._friaElements || [];
                    // Utiliser la référence directe plutôt que getElementById (plus fiable)
                    const resultArea = result;

                    if (elements.length === 0 && !randCb.checked) {
                        resultArea.value = "Ajoutez au moins un élément ou activez Add random.";
                        return;
                    }

                    // Lire le seed depuis le widget ComfyUI
                    const sw = n.widgets?.find(w => w.name === "seed");
                    const seed = sw ? parseInt(sw.value) || 0 : 0;

                    // Construire le payload (seed=0 = aléatoire, seed>0 = déterministe)
                    const payload = { elements: [] };
                    if (seed > 0) payload.seed = seed;

                    elements.forEach(e => {
                        if (e.type === "filter") payload.elements.push({ type: "filter", id: e.id });
                        else if (e.type === "text") payload.elements.push({ type: "text", text: e.text });
                    });

                    if (randCb.checked) {
                        payload.random_count = parseInt(randN.value) || 3;
                    }

                    resultArea.value = "Génération en cours...";

                    apiCall("POST", "generate", payload).then(data => {
                        const prompt = data.prompt || "";
                        resultArea.value = prompt;
                        if (n._resultWidget) {
                            n._resultWidget.value = prompt;
                        }
                    }).catch(err => {
                        resultArea.value = "Erreur : " + err.message;
                    });
                }

                // ---- Result area ----
                const result = document.createElement("textarea");
                // Plus besoin d'y accéder par ID — on utilise la référence directe
                // result.id n'est plus nécessaire
                Object.assign(result.style, {
                    width: "100%", minHeight: "50px", borderRadius: "4px",
                    border: "1px solid #555", padding: "4px",
                    background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "vertical", boxSizing: "border-box",
                });
                result.placeholder = "Résultat...";
                result.readOnly = true;

                // ---- Assemble ----
                container.appendChild(tb);
                container.appendChild(listEl);
                container.appendChild(randRow);
                container.appendChild(genBtn);
                container.appendChild(result);

                // Utiliser addDOMWidget pour cohabiter avec les widgets standard (seed, etc.)
                // ComfyUI alloue automatiquement l'espace et gère le rendu
                const domWidget = node.addDOMWidget("elements_ui", "custom", container, {
                    getValue: () => "",
                    setValue: (v) => {},
                    // Hauteur explicite pour que ComfyUI alloue l'espace correct
                });
                domWidget.options = domWidget.options || {};
                domWidget.options.height = 340;

                return r;
            };
        }
    });
})();

// ========================
// Utilitaires : modales et toasts
// ========================

function showFilterPicker(filters, onSelect) {
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

    let html = `<h3 style="margin:0 0 12px; font-size:14px; color:#fff;">Choisir un filtre</h3>`;

    const mine = filters.filter(f => f.user_id && !f.is_public);
    const pub = filters.filter(f => f.is_public);

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

    // Callback global pour les clics sur les filtres
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
