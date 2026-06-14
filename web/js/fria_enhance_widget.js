/**
 * FR.IA Prompt Enhancer — Custom DOM widget for ComfyUI node FRIAEnhanceNode.
 *
 * Le DOM widget pilote les widgets natifs (prompt_type, preset_id, style_id)
 * qui sont serialises par ComfyUI. Pas de widget STRING _api_config cache
 * (qui causait des bugs d'index et des fuites de cle API dans les workflows
 * exportes). L'api_key est lue depuis
 * ComfyUI/user/default/fria_credentials.json cote Python.
 *
 * Le DOM widget :
 *   - Dropdown Preset IA (peuple depuis /api/presets) → set widget preset_id
 *   - Dropdown Type (valeurs fixes) → set widget prompt_type
 *   - Dropdown Style (peuple depuis /api/styles) → set widget style_id
 *   - Bouton "Test enhance" (optionnel, peut etre reactive ulterieurement)
 */
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    app.registerExtension({
        name: "FR.IA.Enhance",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "FRIAEnhanceNode") return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated?.apply(this, arguments);
                const node = this;

                // ---- Cacher les widgets natifs pilotés par le DOM ----
                const hideWidget = (n, name) => {
                    const w = n.widgets?.find(x => x.name === name);
                    if (w) {
                        w.hidden = true;
                        w.computeSize = () => [0, -4];
                        if (w.inputEl) w.inputEl.style.display = "none";
                        if (w.parentEl) w.parentEl.style.display = "none";
                    }
                };
                ["prompt_type", "preset_id", "style_id"].forEach(n => hideWidget(node, n));

                // ---- Supprimer les sockets d'entrée des widgets pilotés ----
                for (const inputName of ["prompt_type", "preset_id", "style_id"]) {
                    const slot = node.findInputSlot?.(inputName);
                    if (slot !== undefined && slot !== -1) {
                        node.removeInput(slot);
                    }
                }

                // ---- Helpers API ----
                const getApiUrl = () => {
                    try {
                        const cfg = JSON.parse(localStorage.getItem("FRIA_config") || "{}");
                        const base = (cfg.serverUrl || "https://kw.holaf.fr").replace(/\/+$/, "");
                        return base + "/api";
                    } catch {
                        return "https://kw.holaf.fr/api";
                    }
                };
                const getApiKey = () => {
                    try { return JSON.parse(localStorage.getItem("FRIA_config") || "{}").apiKey || ""; }
                    catch { return ""; }
                };
                const apiHeaders = () => {
                    const h = { "Content-Type": "application/json" };
                    const key = getApiKey();
                    if (key) h["Authorization"] = `Bearer ${key}`;
                    return h;
                };
                const apiGet = async (path) => {
                    const resp = await fetch(`${getApiUrl()}/${path.replace(/^\//, "")}`, { headers: apiHeaders() });
                    if (!resp.ok) return [];
                    return resp.json().catch(() => []);
                };

                // ---- Sync des widgets natifs ----
                function syncNativeWidgets() {
                    const set = (name, val) => {
                        const w = node.widgets?.find(x => x.name === name);
                        if (w) w.value = val;
                    };
                    set("prompt_type", typeSelect.value);
                    set("preset_id", parseInt(presetSelect.value) || 0);
                    set("style_id", parseInt(styleSelect.value) || 0);
                }

                // ---- Restauration depuis widgets natifs (au rechargement) ----
                function restoreFromNativeWidgets() {
                    const ptw = node.widgets?.find(x => x.name === "prompt_type");
                    const pw = node.widgets?.find(x => x.name === "preset_id");
                    const sw = node.widgets?.find(x => x.name === "style_id");
                    if (ptw && ptw.value) {
                        if ([...typeSelect.options].some(o => o.value === ptw.value)) {
                            typeSelect.value = ptw.value;
                        }
                    }
                    if (pw && pw.value > 0 && [...presetSelect.options].some(o => o.value === String(pw.value))) {
                        presetSelect.value = String(pw.value);
                    }
                    if (sw && sw.value > 0 && [...styleSelect.options].some(o => o.value === String(sw.value))) {
                        styleSelect.value = String(sw.value);
                    }
                }

                // ---- Cache de rafraîchissement ----
                const _cache = (window.__FRIA_cache = window.__FRIA_cache || { presets: 0, styles: 0 });
                const CACHE_TTL = 15000;

                async function populateSelect(select, apiPath, labelKey, valKey, placeholder) {
                    select.innerHTML = `<option value="0">${placeholder}</option>`;
                    try {
                        const items = await apiGet(apiPath);
                        if (Array.isArray(items)) {
                            items.forEach(item => {
                                const o = document.createElement("option");
                                o.value = item[valKey || "id"];
                                o.textContent = item[labelKey || "name"];
                                select.appendChild(o);
                            });
                        }
                    } catch {}
                }

                async function refreshIfStale(select, apiPath, cacheKey) {
                    const now = Date.now();
                    if (now - (_cache[cacheKey] || 0) < CACHE_TTL) return;
                    _cache[cacheKey] = now;
                    const oldVal = select.value;
                    await populateSelect(select, apiPath, "name", "id", select.options[0]?.textContent || "--");
                    if ([...select.options].some(o => o.value === oldVal)) select.value = oldVal;
                }

                // ---- Container (flex column) ----
                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%", padding: "8px", boxSizing: "border-box",
                    background: "#2a2a2e", borderRadius: "8px",
                    display: "flex", flexDirection: "column", gap: "6px",
                    fontSize: "12px", color: "#ccc", overflow: "hidden",
                });

                const mkLabel = (text) => {
                    const l = document.createElement("label");
                    l.textContent = text;
                    l.style.cssText = "font-size:10px;color:#888;display:block;margin-bottom:2px;";
                    return l;
                };

                // ---- Grille 2x2 (Preset + Type, Style sur la 4eme case) ----
                const grid = document.createElement("div");
                Object.assign(grid.style, {
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px",
                });
                const selectStyle = {
                    width: "100%", padding: "3px 6px", borderRadius: "4px",
                    border: "1px solid #555", background: "#3a3a3e",
                    color: "#ccc", fontSize: "11px", cursor: "pointer",
                };

                // Preset IA (top-left)
                const presetDiv = document.createElement("div");
                const presetRow = document.createElement("div");
                Object.assign(presetRow.style, { display: "flex", gap: "4px", alignItems: "center" });
                const presetSelect = document.createElement("select");
                Object.assign(presetSelect.style, selectStyle);
                presetSelect.style.flex = "1";
                presetSelect.onchange = syncNativeWidgets;
                presetSelect.addEventListener("mousedown", () => refreshIfStale(presetSelect, "presets", "presets"));
                const presetRefreshBtn = document.createElement("button");
                presetRefreshBtn.textContent = "↻";
                Object.assign(presetRefreshBtn.style, {
                    padding: "2px 5px", fontSize: "10px", cursor: "pointer",
                    border: "1px solid #555", borderRadius: "3px",
                    background: "#3a3a3e", color: "#aaa", flex: "0 0 auto",
                });
                presetRefreshBtn.title = "Rafraîchir la liste des presets";
                presetRefreshBtn.onclick = () => { _cache.presets = 0; refreshIfStale(presetSelect, "presets", "presets"); };
                presetDiv.appendChild(mkLabel("Preset IA"));
                presetRow.appendChild(presetSelect);
                presetRow.appendChild(presetRefreshBtn);
                presetDiv.appendChild(presetRow);
                grid.appendChild(presetDiv);

                // Template (top-right)
                const typeDiv = document.createElement("div");
                const typeSelect = document.createElement("select");
                Object.assign(typeSelect.style, selectStyle);
                typeSelect.onchange = syncNativeWidgets;
                typeDiv.appendChild(mkLabel("Template"));
                typeDiv.appendChild(typeSelect);
                grid.appendChild(typeDiv);

                async function loadEnhanceTemplates() {
                    const current = typeSelect.value;
                    typeSelect.innerHTML = '<option value="">-- Chargement --</option>';
                    try {
                        const items = await apiGet("prompts/templates");
                        if (!Array.isArray(items) || items.length === 0) {
                            typeSelect.innerHTML = '<option value="">-- Template --</option>';
                            return;
                        }
                        const pw = node.widgets?.find(x => x.name === "prompt_type");
                        typeSelect.innerHTML = '';
                        items.forEach(t => {
                            const o = document.createElement("option");
                            o.value = t.prompt_type;
                            o.textContent = t.name || t.prompt_type;
                            typeSelect.appendChild(o);
                        });
                        if (current && [...typeSelect.options].some(o => o.value === current)) {
                            typeSelect.value = current;
                        } else if (pw && pw.value && [...typeSelect.options].some(o => o.value === pw.value)) {
                            typeSelect.value = pw.value;
                        }
                    } catch {
                        typeSelect.innerHTML = '<option value="">-- Template --</option>';
                    }
                }
                typeSelect.addEventListener("mousedown", loadEnhanceTemplates);

                // Style (bottom-left, prend toute la largeur)
                const styleDiv = document.createElement("div");
                const styleRow = document.createElement("div");
                Object.assign(styleRow.style, { display: "flex", gap: "4px", alignItems: "center" });
                const styleSelect = document.createElement("select");
                Object.assign(styleSelect.style, selectStyle);
                styleSelect.style.flex = "1";
                styleSelect.onchange = syncNativeWidgets;
                styleSelect.addEventListener("mousedown", () => refreshIfStale(styleSelect, "styles", "styles"));
                const styleRefreshBtn = document.createElement("button");
                styleRefreshBtn.textContent = "↻";
                Object.assign(styleRefreshBtn.style, {
                    padding: "2px 5px", fontSize: "10px", cursor: "pointer",
                    border: "1px solid #555", borderRadius: "3px",
                    background: "#3a3a3e", color: "#aaa", flex: "0 0 auto",
                });
                styleRefreshBtn.title = "Rafraîchir la liste des styles";
                styleRefreshBtn.onclick = () => { _cache.styles = 0; refreshIfStale(styleSelect, "styles", "styles"); };
                styleDiv.appendChild(mkLabel("Style"));
                styleRow.appendChild(styleSelect);
                styleRow.appendChild(styleRefreshBtn);
                styleDiv.appendChild(styleRow);
                styleDiv.style.gridColumn = "1 / -1";
                grid.appendChild(styleDiv);

                container.appendChild(grid);

                // ---- Bouton Test Enhance ----
                const enhanceBtn = document.createElement("button");
                enhanceBtn.textContent = "🔄  Test enhance";
                Object.assign(enhanceBtn.style, {
                    width: "100%", padding: "6px", borderRadius: "4px",
                    border: "none", background: "#6366f1", color: "white",
                    fontSize: "11px", fontWeight: "600", cursor: "pointer",
                });
                enhanceBtn.onmouseenter = () => enhanceBtn.style.background = "#5558e8";
                enhanceBtn.onmouseleave = () => enhanceBtn.style.background = "#6366f1";
                container.appendChild(enhanceBtn);

                // ---- Textarea résultat ----
                const resultTextarea = document.createElement("textarea");
                Object.assign(resultTextarea.style, {
                    width: "100%",
                    height: "120px", minHeight: "80px", maxHeight: "260px",
                    borderRadius: "4px", border: "1px solid #555",
                    padding: "4px", background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "vertical", boxSizing: "border-box",
                });
                resultTextarea.placeholder = "Résultat de l'enhance...";
                resultTextarea.readOnly = true;
                container.appendChild(resultTextarea);

                // ---- Ajout au node ----
                const widget = node.addDOMWidget("FRIA_Enhance", "div", container, {
                    serialize: false,
                    hideOnZoom: false,
                });
                widget.computeSize = () => [node.size[0] - 20, 240];

                // ---- Initialisation ----
                loadEnhanceTemplates();
                populateSelect(presetSelect, "presets", "name", "id", "-- Preset IA --").then(() => {
                    populateSelect(styleSelect, "styles", "name", "id", "-- Style --").then(() => {
                        restoreFromNativeWidgets();
                        syncNativeWidgets();
                        // Retry si les options n'étaient pas encore chargées
                        let ra = 0;
                        function delayedRestore() {
                            restoreFromNativeWidgets();
                            if (++ra < 20) setTimeout(delayedRestore, 300);
                        }
                        setTimeout(delayedRestore, 100);
                    });
                });

                // ---- Onclick Test Enhance ----
                // Appelle /api/enhance en streaming (ndjson keepalive) et
                // affiche le prompt final + negative_prompt dans la textarea.
                enhanceBtn.onclick = async () => {
                    const get = (name) => node.widgets?.find(w => w.name === name);
                    const basePrompt = (get("base_prompt")?.value || "").trim();
                    const specialInstructions = (get("special_instructions")?.value || "").trim();
                    const seedW = get("seed")?.value;
                    const elementsRaw = get("elements")?.value || "[]";

                    // Parser elements (tableau direct ou objet _elements_json)
                    let elements = [];
                    try {
                        const parsed = JSON.parse(elementsRaw);
                        if (Array.isArray(parsed)) elements = parsed;
                        else if (parsed?.elements) elements = parsed.elements;
                    } catch {
                        // Texte brut : on enverra comme tel via le payload brut
                    }

                    const payload = {
                        text: basePrompt,
                        seed: seedW > 0 ? seedW : null,
                        prompt_type: typeSelect.value,
                        preset_id: parseInt(presetSelect.value) || null,
                        style_id: parseInt(styleSelect.value) || null,
                        special_instructions: specialInstructions,
                    };
                    // elements en texte brut si pas du JSON structuré
                    if (elements.length > 0) {
                        payload.ep_elements = elements;
                    } else if (elementsRaw.trim() && elementsRaw !== "[]") {
                        // texte brut : on le concatenre avec base_prompt
                        payload.text = (basePrompt + "\n\n" + elementsRaw).trim();
                    }

                    if (!payload.text && (!payload.ep_elements || payload.ep_elements.length === 0)) {
                        resultTextarea.value = "Saisis au moins le prompt de base ou des éléments.";
                        return;
                    }

                    resultTextarea.value = "Enhancement en cours...";
                    try {
                        const resp = await fetch(`${getApiUrl()}/enhance`, {
                            method: "POST", headers: apiHeaders(), body: JSON.stringify(payload),
                        });
                        if (!resp.ok) {
                            const t = await resp.text().catch(() => "");
                            throw new Error(`HTTP ${resp.status}: ${t.substring(0, 200)}`);
                        }
                        const text = await resp.text();
                        let output = "";
                        let neg = "";
                        for (const line of text.split("\n")) {
                            if (!line.trim()) continue;
                            try {
                                const chunk = JSON.parse(line);
                                if (chunk.status === "done") {
                                    output = chunk.output || "";
                                    neg = chunk.negative_prompt || "";
                                } else if (chunk.status === "error") {
                                    throw new Error(chunk.error || "Erreur inconnue");
                                }
                            } catch (e) {
                                if (e instanceof SyntaxError) continue;
                                throw e;
                            }
                        }
                        const sep = neg ? "\n\n--- Negative prompt ---\n" + neg : "";
                        resultTextarea.value = output + sep;
                        syncNativeWidgets();
                    } catch (err) {
                        resultTextarea.value = "Erreur: " + err.message;
                    }
                };

                // ---- onExecuted : recupere le resultat du Run ComfyUI ----
                const origExec = node.onExecuted;
                node.onExecuted = function (output) {
                    if (origExec) origExec.call(this, output);
                    const arr = output?.prompt;
                    if (Array.isArray(arr) && arr.length > 0) {
                        const neg = output?.negative_prompt;
                        const out = String(arr[0]);
                        const sep = Array.isArray(neg) && neg[0] ? "\n\n--- Negative prompt ---\n" + neg[0] : "";
                        resultTextarea.value = out + sep;
                    }
                };

                // ---- Resize ----
                const onResize = node.onResize;
                node.onResize = function (size) {
                    const r = onResize?.apply(this, arguments);
                    widget.computeSize = () => [size[0] - 20, 240];
                    return r;
                };

                return r;
            };
        },
    });
})();
