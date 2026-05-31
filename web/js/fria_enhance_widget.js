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

                // ---- Cacher les widgets standards ----
                const hideWidget = (n, name) => {
                    const w = n.widgets?.find(x => x.name === name);
                    if (w) {
                        // Ne PAS mettre w.hidden = true (cacherait le port des opt. inputs)
                        w.computeSize = () => [0, -4];
                        if (w.inputEl) w.inputEl.style.display = "none";
                        if (w.parentEl) w.parentEl.style.display = "none";
                    }
                };
                ["base_prompt", "prompt_type", "output_format", "preset_id", "style_id",
                 "special_instructions", "elements", "_api_config"].forEach(
                    n => hideWidget(node, n)
                );

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

                // ---- Sync widgets cachés ----
                function syncEnhanceWidget() {
                    const set = (name, val) => {
                        const w = node.widgets?.find(x => x.name === name);
                        if (w) w.value = val;
                    };
                    set("base_prompt", basePromptTextarea.value);
                    set("prompt_type", typeSelect.value);
                    set("output_format", formatSelect.value);
                    set("preset_id", parseInt(presetSelect.value) || 0);
                    set("style_id", parseInt(styleSelect.value) || 0);
                    set("special_instructions", specialTextarea.value);
                    const a = node.widgets?.find(x => x.name === "_api_config");
                    if (a) a.value = JSON.stringify({ api_url: getApiUrl(), api_key: getApiKey() });
                }

                // ---- Populate un select depuis l'API ----
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

                // ---- Container (flex column, result prend tout l'espace) ----
                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%", padding: "8px", boxSizing: "border-box",
                    background: "#2a2a2e", borderRadius: "8px",
                    display: "flex", flexDirection: "column", gap: "6px",
                    fontSize: "12px", color: "#ccc",
                    flex: "1", minHeight: "280px",
                });

                // ---- Helper label ----
                function mkLabel(text) {
                    const l = document.createElement("label");
                    l.textContent = text;
                    l.style.cssText = "font-size:10px;color:#888;display:block;margin-bottom:2px;";
                    return l;
                }

                // ---- 1. Base prompt (textarea fixe) ----
                const basePromptTextarea = document.createElement("textarea");
                Object.assign(basePromptTextarea.style, {
                    width: "100%", height: "50px", minHeight: "50px", maxHeight: "50px",
                    borderRadius: "4px", border: "1px solid #555",
                    padding: "4px", background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "none", boxSizing: "border-box",
                });
                basePromptTextarea.placeholder = "Prompt de base...";
                basePromptTextarea.onchange = basePromptTextarea.oninput = syncEnhanceWidget;
                container.appendChild(mkLabel("Prompt de base"));
                container.appendChild(basePromptTextarea);

                // ---- 2. Grille 2x2 ----
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
                const presetSelect = document.createElement("select");
                Object.assign(presetSelect.style, selectStyle);
                presetSelect.onchange = syncEnhanceWidget;
                presetSelect.dataset.filled = "false";
                presetDiv.appendChild(mkLabel("Preset IA"));
                presetDiv.appendChild(presetSelect);
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

                // Format (bottom-left) — valeurs comme sur le site
                const fmtDiv = document.createElement("div");
                const formatSelect = document.createElement("select");
                Object.assign(formatSelect.style, selectStyle);
                [["text", "Texte brut"], ["markdown", "Markdown"], ["json", "JSON"]].forEach(([v, l]) => {
                    const o = document.createElement("option");
                    o.value = v; o.textContent = l;
                    formatSelect.appendChild(o);
                });
                formatSelect.onchange = syncEnhanceWidget;
                fmtDiv.appendChild(mkLabel("Format"));
                fmtDiv.appendChild(formatSelect);
                grid.appendChild(fmtDiv);

                // Style (bottom-right) — depuis /api/styles
                const styleDiv = document.createElement("div");
                const styleSelect = document.createElement("select");
                Object.assign(styleSelect.style, selectStyle);
                styleSelect.onchange = syncEnhanceWidget;
                styleSelect.dataset.filled = "false";
                styleDiv.appendChild(mkLabel("Style"));
                styleDiv.appendChild(styleSelect);
                grid.appendChild(styleDiv);

                container.appendChild(grid);

                // ---- 3. Instructions spéciales (3 lignes) ----
                const specialTextarea = document.createElement("textarea");
                Object.assign(specialTextarea.style, {
                    width: "100%", height: "50px", minHeight: "50px", maxHeight: "50px",
                    borderRadius: "4px", border: "1px solid #555",
                    padding: "4px", background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "none", boxSizing: "border-box",
                });
                specialTextarea.placeholder = "Instructions spéciales (optionnel)...";
                specialTextarea.onchange = specialTextarea.oninput = syncEnhanceWidget;
                container.appendChild(specialTextarea);

                // ---- 4. Test enhance button ----
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

                    const basePrompt = basePromptTextarea.value;
                    const elemsW = node.widgets?.find(w => w.name === "elements");
                    let elems = [];
                    try {
                        const p = JSON.parse(elemsW?.value || "[]");
                        if (Array.isArray(p)) elems = p;
                        else if (p?.elements) elems = p.elements;
                    } catch {}

                    function fmtElems(elist) {
                        return elist.map(e => {
                            if (e.type === "filter") return `[Filtre: ${e.name || `ID ${e.id}`}]`;
                            if (e.type === "text") return `[Recherche: ${e.text}]`;
                            if (e.type === "random") return "[Éléments aléatoires]";
                            return "";
                        }).filter(Boolean).join("\n");
                    }
                    const elemsText = fmtElems(elems);
                    const combinedText = elemsText ? elemsText + "\n\n" + basePrompt : basePrompt;

                    if (!basePrompt && elems.length === 0) {
                        resultTextarea.value = "Entrez un prompt de base ou connectez des éléments.";
                        return;
                    }

                    resultTextarea.value = "Génération en cours...";
                    const payload = {
                        text: combinedText,
                        seed: (() => {
                            const sw = node.widgets?.find(w => w.name === "seed");
                            const s = sw ? parseInt(sw.value) || 0 : 0;
                            return s > 0 ? s : null;
                        })(),
                        prompt_type: typeSelect.value,
                        output_format: formatSelect.value,
                        preset_id: parseInt(presetSelect.value) || null,
                        style_id: parseInt(styleSelect.value) || null,
                        special_instructions: specialTextarea.value,
                    };
                    try {
                        const data = await apiPost("enhance", payload);
                        const prompt = data.output || "";
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

                // ---- Intégration DOM Widget ----
                const domWidget = node.addDOMWidget("enhance_ui", "custom", container, {
                    getValue: () => "",
                    setValue: (v) => {},
                });
                domWidget.options = domWidget.options || {};
                domWidget.options.height = 350;

                node._resultArea = resultTextarea;
                node._domWidget = domWidget;

                // ---- Peupler les dropdowns depuis l'API ----
                populateSelect(presetSelect, "presets", "name", "id", "-- Preset IA --");
                populateSelect(styleSelect, "styles", "name", "id", "-- Style --");

                // ---- Restauration workflow ----
                function restoreFromWidgets(n) {
                    const read = (name) => n.widgets?.find(w => w.name === name);
                    try {
                        const bp = read("base_prompt");
                        if (bp && bp.value) basePromptTextarea.value = bp.value;
                        const t = read("prompt_type");
                        if (t && t.value) typeSelect.value = t.value;
                        const f = read("output_format");
                        if (f && f.value) formatSelect.value = f.value;
                        const p = read("preset_id");
                        if (p && p.value > 0) presetSelect.value = String(p.value);
                        const s = read("style_id");
                        if (s && s.value > 0) styleSelect.value = String(s.value);
                        const sp = read("special_instructions");
                        if (sp && sp.value) specialTextarea.value = sp.value;
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
