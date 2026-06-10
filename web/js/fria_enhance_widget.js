/**
 * FR.IA Prompt Enhancer — Custom DOM widget for ComfyUI node.
 *
 * Flux :
 *   - "Run" (workflow) : Python lit tous les widgets, appelle l'API
 *   - "Test enhance" : JS appelle l'API pour un aperçu instantané
 *
 * Dropdowns Preset IA et Style peuplés depuis l'API.
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

                // ---- Cacher les widgets remplacés par le DOM ----
                // base_prompt et special_instructions : widgets natifs ComfyUI volontairement visibles
                // elements : forceInput:True dans INPUT_TYPES (déjà input socket, pas de widget à cacher)
                // prompt_type, preset_id, style_id, _api_config : déclarés dans INPUT_TYPES
                // (pour garantir leur sérialisation dans widgets_values), mais leur
                // widget est caché (le DOM les pilote) et leur socket d'entrée est
                // supprimée (voir removeInputSockets ci-dessous).
                const hideWidget = (n, name) => {
                    const w = n.widgets?.find(x => x.name === name);
                    if (w) {
                        w.hidden = true;
                        w.computeSize = () => [0, -4];
                        if (w.inputEl) w.inputEl.style.display = "none";
                        if (w.parentEl) w.parentEl.style.display = "none";
                    }
                };

                // Cacher tous les widgets pilotés par le DOM
                ["prompt_type", "preset_id", "style_id", "_api_config"].forEach(
                    n => hideWidget(node, n)
                );

                // ---- Supprimer les sockets d'entrée non désirées ----
                // Depuis ComfyUI v1.16, chaque widget STRING/COMBO/INT déclaré dans
                // INPUT_TYPES génère automatiquement une socket d'entrée dans
                // node.inputs[]. Comme on ne veut PAS que l'utilisateur puisse brancher
                // un câble sur ces champs (texte, dropdowns, et cache interne), on
                // supprime les sockets après création. Le widget reste intact dans
                // node.widgets[], donc la valeur est toujours sérialisée et lue par Python.
                for (const inputName of [
                    "base_prompt", "special_instructions",
                    "prompt_type", "preset_id", "style_id",
                    "_api_config",
                ]) {
                    const slot = node.findInputSlot?.(inputName);
                    if (slot !== undefined && slot !== -1) {
                        node.removeInput(slot);
                    }
                }

                // ---- Utilitaires ----
                const getApiUrl = () => "https://kw.holaf.fr/api";
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
                const apiPost = async (path, body) => {
                    const resp = await fetch(`${getApiUrl()}/${path.replace(/^\//, "")}`, {
                        method: "POST", headers: apiHeaders(), body: JSON.stringify(body),
                    });
                    if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error(`HTTP ${resp.status}: ${t.substring(0, 200)}`); }
                    return resp.json();
                };

                // ---- Sync widgets cachés (uniquement ceux remplacés par le DOM) ----
                function syncEnhanceWidget() {
                    const set = (name, val) => {
                        const w = node.widgets?.find(x => x.name === name);
                        if (w) w.value = val;
                    };
                    set("prompt_type", typeSelect.value);
                    set("preset_id", parseInt(presetSelect.value) || 0);
                    set("style_id", parseInt(styleSelect.value) || 0);
                    const a = node.widgets?.find(x => x.name === "_api_config");
                    if (a) a.value = JSON.stringify({ api_url: getApiUrl(), api_key: getApiKey() });
                }

                // ---- Cache de rafraîchissement intelligent ----
                const _cache = (window.__FRIA_cache = window.__FRIA_cache || { presets: 0, styles: 0 });
                const CACHE_TTL = 15000; // 15 secondes

                async function populateSelect(select, apiPath, labelKey, valKey, placeholder, onDone) {
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
                    onDone?.();
                }

                // Rafraîchir un dropdown si le cache est périmé
                async function refreshIfStale(select, apiPath, cacheKey) {
                    const now = Date.now();
                    if (now - (_cache[cacheKey] || 0) < CACHE_TTL) return;
                    _cache[cacheKey] = now;
                    const oldVal = select.value;
                    await populateSelect(select, apiPath, "name", "id", select.options[0]?.textContent || "--", () => {
                        if ([...select.options].some(o => o.value === oldVal)) select.value = oldVal;
                    });
                }

                // ---- Container (flex column, result prend tout l'espace) ----
                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%", height: "100%", padding: "8px", boxSizing: "border-box",
                    background: "#2a2a2e", borderRadius: "8px",
                    display: "flex", flexDirection: "column", gap: "6px",
                    fontSize: "12px", color: "#ccc", overflow: "hidden",
                });

                // ---- Helper label ----
                function mkLabel(text) {
                    const l = document.createElement("label");
                    l.textContent = text;
                    l.style.cssText = "font-size:10px;color:#888;display:block;margin-bottom:2px;";
                    return l;
                }

                // ---- 1. Grille 2x2 (Preset IA + Type, Style sur la 4ème case) ----
                // NB : base_prompt et special_instructions sont des widgets natifs ComfyUI
                // affichés au-dessus/au-dessous de ce DOM widget.
                const grid = document.createElement("div");
                Object.assign(grid.style, {
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px",
                });
                const selectStyle = {
                    width: "100%", padding: "3px 6px", borderRadius: "4px",
                    border: "1px solid #555", background: "#3a3a3e",
                    color: "#ccc", fontSize: "11px", cursor: "pointer",
                };

                // Preset IA (top-left) — depuis /api/presets
                const presetDiv = document.createElement("div");
                const presetRow = document.createElement("div");
                Object.assign(presetRow.style, { display: "flex", gap: "4px", alignItems: "center" });
                const presetSelect = document.createElement("select");
                Object.assign(presetSelect.style, selectStyle);
                presetSelect.style.flex = "1";
                presetSelect.onchange = syncEnhanceWidget;
                presetSelect.dataset.filled = "false";
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

                // Type (top-right) — valeurs fixes comme sur le site
                const typeDiv = document.createElement("div");
                const typeSelect = document.createElement("select");
                Object.assign(typeSelect.style, selectStyle);
                ["SDXL", "SD1.5", "Flux", "Anima", "Qwen", "Liste"].forEach(v => {
                    const o = document.createElement("option");
                    o.value = v.toLowerCase(); o.textContent = v;
                    typeSelect.appendChild(o);
                });
                typeSelect.onchange = syncEnhanceWidget;
                typeDiv.appendChild(mkLabel("Type"));
                typeDiv.appendChild(typeSelect);
                grid.appendChild(typeDiv);

                // Style (bottom-right) — depuis /api/styles
                const styleDiv = document.createElement("div");
                const styleRow = document.createElement("div");
                Object.assign(styleRow.style, { display: "flex", gap: "4px", alignItems: "center" });
                const styleSelect = document.createElement("select");
                Object.assign(styleSelect.style, selectStyle);
                styleSelect.style.flex = "1";
                styleSelect.onchange = syncEnhanceWidget;
                styleSelect.dataset.filled = "false";
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
                grid.appendChild(styleDiv);

                container.appendChild(grid);

                // ---- 3. Test enhance button ----
                // NB : special_instructions est un widget natif ComfyUI (une seule ligne)
                // affiché juste avant ce DOM widget.
                const enhanceBtn = document.createElement("button");
                enhanceBtn.textContent = "🔄  Test enhance";
                Object.assign(enhanceBtn.style, {
                    width: "100%", padding: "6px", borderRadius: "4px",
                    border: "none", background: "#6366f1", color: "white",
                    fontSize: "11px", fontWeight: "600", cursor: "pointer",
                    flex: "0 0 auto",
                });
                enhanceBtn.onmouseenter = () => enhanceBtn.style.background = "#5558e8";
                enhanceBtn.onmouseleave = () => enhanceBtn.style.background = "#6366f1";
                enhanceBtn.onclick = async () => {
                    syncEnhanceWidget();

                    const get = (name) => node.widgets?.find(w => w.name === name);
                    const basePrompt = get("base_prompt")?.value || "";
                    const specialInstructions = get("special_instructions")?.value || "";
                    const elemsW = get("elements");
                    let elems = [];
                    let elemsRaw = "";
                    try {
                        const p = JSON.parse(elemsW?.value || "[]");
                        if (Array.isArray(p)) elems = p;
                        else if (p?.elements) elems = p.elements;
                    } catch {
                        // Pas du JSON → texte brut
                        elemsRaw = elemsW?.value || "";
                    }

                    function fmtElems(elist) {
                        return elist.map(e => {
                            if (e.type === "filter") return `[Filtre: ${e.name || `ID ${e.id}`}]`;
                            if (e.type === "text") return `[Recherche: ${e.text}]`;
                            if (e.type === "random") return "[Éléments aléatoires]";
                            return "";
                        }).filter(Boolean).join("\n");
                    }
                    const parts = [fmtElems(elems), elemsRaw, basePrompt].filter(Boolean);
                    const combinedText = parts.join("\n\n");

                    if (!basePrompt && elems.length === 0) {
                        resultTextarea.value = "Entrez un prompt de base ou connectez des éléments.";
                        return;
                    }

                    resultTextarea.value = "Génération en cours...";
                    const payload = {
                        text: combinedText,
                        seed: (() => {
                            const s = parseInt(get("seed")?.value) || 0;
                            return s > 0 ? s : null;
                        })(),
                        prompt_type: typeSelect.value,
                        preset_id: parseInt(presetSelect.value) || null,
                        style_id: parseInt(styleSelect.value) || null,
                        special_instructions: specialInstructions,
                    };
                    try {
                        // Endpoint retourne du ndjson (streaming keepalive)
                        const resp = await fetch(`${getApiUrl()}/enhance`, {
                            method: "POST", headers: apiHeaders(), body: JSON.stringify(payload),
                        });
                        if (!resp.ok) {
                            const t = await resp.text().catch(() => "");
                            throw new Error(`HTTP ${resp.status}: ${t.substring(0, 200)}`);
                        }
                        const text = await resp.text();
                        let prompt = "";
                        for (const line of text.split("\n")) {
                            if (!line.trim()) continue;
                            try {
                                const chunk = JSON.parse(line);
                                if (chunk.status === "done") {
                                    prompt = chunk.output || "";
                                } else if (chunk.status === "error") {
                                    throw new Error(chunk.error || "Erreur inconnue");
                                }
                            } catch (e) {
                                if (e instanceof SyntaxError) continue;
                                throw e;
                            }
                        }
                        if (node._resultArea) node._resultArea.value = prompt;
                        syncEnhanceWidget();
                    } catch (err) {
                        if (node._resultArea) node._resultArea.value = "Erreur: " + err.message;
                    }
                };
                container.appendChild(enhanceBtn);

                // ---- 5. Result (remplit l'espace restant) ----
                const resultTextarea = document.createElement("textarea");
                Object.assign(resultTextarea.style, {
                    width: "100%", flex: "1", minHeight: "40px",
                    borderRadius: "4px", border: "1px solid #555",
                    padding: "4px", background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "none", boxSizing: "border-box",
                });
                resultTextarea.placeholder = "Résultat...";
                resultTextarea.readOnly = true;
                container.appendChild(resultTextarea);

                // ---- Intégration DOM Widget (taille adaptative) ----
                const domWidget = node.addDOMWidget("enhance_ui", "custom", container, {
                    getValue: () => "",
                    setValue: (v) => {},
                    getMinHeight: () => 280,
                    getMaxHeight: () => 1200,
                });
                // Pas de height fixe — le flex:1 du result et le resize ComfyUI gèrent

                node._resultArea = resultTextarea;
                node._domWidget = domWidget;

                // ---- Peupler les dropdowns depuis l'API ----
                populateSelect(presetSelect, "presets", "name", "id", "-- Preset IA --",
                    () => restoreFromWidgets(node));
                populateSelect(styleSelect, "styles", "name", "id", "-- Style --",
                    () => restoreFromWidgets(node));

                // ---- Restauration workflow ----
                function restoreFromWidgets(n) {
                    const read = (name) => n.widgets?.find(w => w.name === name);
                    try {
                        const t = read("prompt_type");
                        if (t && t.value) typeSelect.value = t.value;
                        const p = read("preset_id");
                        if (p && p.value > 0 && [...presetSelect.options].some(o => o.value === String(p.value))) {
                            presetSelect.value = String(p.value);
                        }
                        const s = read("style_id");
                        if (s && s.value > 0 && [...styleSelect.options].some(o => o.value === String(s.value))) {
                            styleSelect.value = String(s.value);
                        }
                        return true;
                    } catch { return false; }
                }
                node._friaRestore = restoreFromWidgets.bind(null, node);
                let ra = 0;
                function delayedRestore() {
                    if (restoreFromWidgets(node)) return;
                    if (++ra < 20) setTimeout(delayedRestore, 300);
                }
                setTimeout(delayedRestore, 100);

                // ---- onExecuted ----
                const origExec = node.onExecuted;
                node.onExecuted = function (output) {
                    if (origExec) origExec.call(this, output);
                    const arr = output?.prompt;
                    if (Array.isArray(arr) && arr.length > 0 && node._resultArea) {
                        node._resultArea.value = String(arr[0]);
                    }
                };

                syncEnhanceWidget();
                return r;
            };
        },
    });
})();
