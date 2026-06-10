/**
 * FR.IA Ideogram 4 Caption Builder — Widget ComfyUI
 *
 * Widgets natifs ComfyUI (visibles) : seed, width, height, description, element_1..4
 * Widget cache : _api_config (JSON interne)
 * DOM widget : preset IA, style, generate, resultat
 */
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    app.registerExtension({
        name: "FR.IA.Ideogram4",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "FRIAIdeogram4Node") return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated?.apply(this, arguments);
                const node = this;

                // ---- Masquer _api_config ----
                const hideWidget = (n, name) => {
                    const w = n.widgets?.find(x => x.name === name);
                    if (w) {
                        w.hidden = true;
                        w.computeSize = () => [0, -4];
                        return w;
                    }
                    return null;
                };
                hideWidget(node, "_api_config");

                // ---- Supprimer la socket d'entrée de _api_config ----
                // _api_config est un cache technique (JSON interne) qui n'a aucune
                // raison d'être connecté à un autre node. Depuis ComfyUI v1.16,
                // chaque widget STRING déclaré dans INPUT_TYPES génère une socket
                // dans node.inputs[] ; on la retire pour qu'aucun câble ne puisse
                // y être branché. Le widget reste sérialisé et Python le reçoit
                // normalement via les arguments keyword.
                {
                    const slot = node.findInputSlot?.("_api_config");
                    if (slot !== undefined && slot !== -1) {
                        node.removeInput(slot);
                    }
                }

                // ---- Utilitaires API ----
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

                // ---- Cache ----
                const _cache = (window.__FRIA_cache = window.__FRIA_cache || { presets: 0, styles: 0 });
                const CACHE_TTL = 15000;

                async function populateSelect(select, apiPath, placeholder) {
                    select.innerHTML = `<option value="0">${placeholder}</option>`;
                    try {
                        const items = await apiGet(apiPath);
                        if (Array.isArray(items)) {
                            items.forEach(item => {
                                const o = document.createElement("option");
                                o.value = item.id;
                                o.textContent = item.name;
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
                    await populateSelect(select, apiPath, select.options[0]?.textContent || "--");
                    if ([...select.options].some(o => o.value === oldVal)) select.value = oldVal;
                }

                // ========================================
                // DOM WIDGET
                // ========================================

                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%",
                    padding: "8px", boxSizing: "border-box",
                    background: "#2a2a2e", borderRadius: "8px",
                    display: "flex", flexDirection: "column", gap: "6px",
                    fontSize: "12px", color: "#ccc", overflow: "hidden",
                });

                function mkLabel(text) {
                    const l = document.createElement("label");
                    l.textContent = text;
                    l.style.cssText = "font-size:10px;color:#888;display:block;margin-bottom:2px;";
                    return l;
                }

                // ---- Preset + Style ----
                const psRow = document.createElement("div");
                Object.assign(psRow.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });

                const presetDiv = document.createElement("div");
                const presetSelect = document.createElement("select");
                Object.assign(presetSelect.style, { width: "100%", padding: "3px 6px", borderRadius: "4px", border: "1px solid #555", background: "#3a3a3e", color: "#ccc", fontSize: "11px", cursor: "pointer" });
                presetSelect.addEventListener("mousedown", () => refreshIfStale(presetSelect, "presets", "presets"));
                presetDiv.appendChild(mkLabel("Preset IA"));
                presetDiv.appendChild(presetSelect);
                psRow.appendChild(presetDiv);

                const styleDiv = document.createElement("div");
                const styleSelect = document.createElement("select");
                Object.assign(styleSelect.style, { width: "100%", padding: "3px 6px", borderRadius: "4px", border: "1px solid #555", background: "#3a3a3e", color: "#ccc", fontSize: "11px", cursor: "pointer" });
                styleSelect.addEventListener("mousedown", () => refreshIfStale(styleSelect, "styles", "styles"));
                styleDiv.appendChild(mkLabel("Style"));
                styleDiv.appendChild(styleSelect);
                psRow.appendChild(styleDiv);
                container.appendChild(psRow);

                // ---- Generate ----
                const generateBtn = document.createElement("button");
                generateBtn.textContent = "🔄  Generate Ideogram 4 caption";
                Object.assign(generateBtn.style, {
                    width: "100%", padding: "6px", borderRadius: "4px",
                    border: "none", background: "#6366f1", color: "white",
                    fontSize: "11px", fontWeight: "600", cursor: "pointer",
                });
                generateBtn.onmouseenter = () => generateBtn.style.background = "#5558e8";
                generateBtn.onmouseleave = () => generateBtn.style.background = "#6366f1";
                container.appendChild(generateBtn);

                // ---- Resultat ----
                const resultTextarea = document.createElement("textarea");
                Object.assign(resultTextarea.style, {
                    width: "100%",
                    height: "160px", minHeight: "120px", maxHeight: "260px",
                    borderRadius: "4px", border: "1px solid #555",
                    padding: "4px", background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "vertical", boxSizing: "border-box",
                });
                resultTextarea.placeholder = "JSON caption Ideogram 4...";
                resultTextarea.readOnly = true;
                container.appendChild(mkLabel("Resultat"));
                container.appendChild(resultTextarea);

                // ---- Debug bouton ----
                // ---- Preview note ----
                const previewNote = document.createElement("div");
                Object.assign(previewNote.style, {
                    fontSize: "10px", color: "#888", textAlign: "center",
                    fontStyle: "italic", padding: "2px",
                });
                previewNote.textContent = "💡 Preview = sortie IMAGE | Debug = sortie STRING du node";
                container.appendChild(previewNote);

                // ---- Debug bouton ----
                const debugBtn = document.createElement("button");
                debugBtn.textContent = "🔍 Voir debug LLM";
                Object.assign(debugBtn.style, {
                    width: "100%", padding: "4px", borderRadius: "4px",
                    border: "1px solid #555", background: "#3a3a3e", color: "#ccc",
                    fontSize: "10px", cursor: "pointer", marginTop: "4px",
                });
                debugBtn.onclick = () => {
                    const md = node._lastDebugMd || "Aucun debug. Lance un Generate d'abord.";
                    const w = window.open("", "FR.IA Debug", "width=800,height=600");
                    w.document.write(`<html><head><title>FR.IA Debug</title><style>body{background:#1a1a1e;color:#ccc;font-family:monospace;font-size:12px;padding:16px;}pre{white-space:pre-wrap;background:#2a2a2e;padding:8px;border-radius:4px;}h1,h2,h3{color:#6366f1;}h2{border-bottom:1px solid #444;padding-bottom:4px;}code{background:#3a3a3e;padding:1px 4px;border-radius:2px;}</style></head><body><pre>${md.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`);
                    w.document.close();
                };
                container.appendChild(debugBtn);

                // ---- Integration DOM Widget ----
                const domWidget = node.addDOMWidget("ideogram4_ui", "custom", container, {
                    getValue: () => "",
                    setValue: (v) => {},
                });
                domWidget.options = domWidget.options || {};
                domWidget.options.height = 320;

                const MIN_WIDTH = 340;
                const origOnResize = node.onResize;
                node.onResize = function (size) {
                    if (origOnResize) origOnResize.call(this, size);
                    if (size[0] < MIN_WIDTH) size[0] = MIN_WIDTH;
                };
                requestAnimationFrame(() => {
                    if (node.size && node.size[0] < MIN_WIDTH) node.setSize([MIN_WIDTH, node.size[1]]);
                });

                node._resultArea = resultTextarea;
                node._domWidget = domWidget;

                // ========================================
                // _api_config sync
                // ========================================

                function readApiConfig() {
                    const a = node.widgets?.find(x => x.name === "_api_config");
                    if (!a || !a.value) return { api_url: getApiUrl(), api_key: getApiKey(), preset_id: 0, style_id: 0 };
                    try { return { ...{ api_url: getApiUrl(), api_key: getApiKey(), preset_id: 0, style_id: 0 }, ...JSON.parse(a.value) }; }
                    catch { return { api_url: getApiUrl(), api_key: getApiKey(), preset_id: 0, style_id: 0 }; }
                }

                function saveApiConfig() {
                    const a = node.widgets?.find(x => x.name === "_api_config");
                    if (!a) return;
                    a.value = JSON.stringify({
                        api_url: getApiUrl(),
                        api_key: getApiKey(),
                        preset_id: parseInt(presetSelect.value) || 0,
                        style_id: parseInt(styleSelect.value) || 0,
                    });
                }

                presetSelect.onchange = saveApiConfig;
                styleSelect.onchange = saveApiConfig;

                // ========================================
                // RESTORE
                // ========================================

                function restoreFromWidgets(n) {
                    let restored = false;
                    const cfg = readApiConfig();
                    try {
                        if (cfg.preset_id > 0 && [...presetSelect.options].some(o => o.value === String(cfg.preset_id))) {
                            presetSelect.value = String(cfg.preset_id);
                            restored = true;
                        }
                        if (cfg.style_id > 0 && [...styleSelect.options].some(o => o.value === String(cfg.style_id))) {
                            styleSelect.value = String(cfg.style_id);
                            restored = true;
                        }
                    } catch {}
                    return restored;
                }
                node._friaRestore = restoreFromWidgets.bind(null, node);

                populateSelect(presetSelect, "presets", "-- Preset IA --")
                    .then(() => restoreFromWidgets(node));
                populateSelect(styleSelect, "styles", "-- Style --")
                    .then(() => restoreFromWidgets(node));

                saveApiConfig();

                // ========================================
                // GENERATE
                // ========================================

                generateBtn.onclick = async () => {
                    const get = (name) => node.widgets?.find(w => w.name === name);
                    const description = (get("description")?.value || "").trim();
                    const elTexts = ["element_1", "element_2", "element_3", "element_4"]
                        .map(n => (get(n)?.value || "").trim())
                        .filter(Boolean);
                    const seedW = get("seed")?.value;
                    const widthW = get("width")?.value;
                    const heightW = get("height")?.value;

                    const payload = {
                        text: description,
                        seed: seedW > 0 ? seedW : null,
                        prompt_type: "ideogram4",
                        width: widthW || 1024,
                        height: heightW || 1024,
                        ep_elements: elTexts.map(t => ({ type: "text", text: t })),
                        preset_id: parseInt(presetSelect.value) || null,
                        style_id: parseInt(styleSelect.value) || null,
                    };

                    if (!description && elTexts.length === 0) {
                        resultTextarea.value = "Decris au moins la scene generale ou un element.";
                        return;
                    }

                    resultTextarea.value = "Generation en cours...";
                    try {
                        // L'endpoint retourne du ndjson (streaming keepalive).
                        // On lit les chunks et on garde le dernier status='done'.
                        const resp = await fetch(`${getApiUrl()}/enhance`, {
                            method: "POST", headers: apiHeaders(), body: JSON.stringify(payload),
                        });
                        if (!resp.ok) {
                            const t = await resp.text().catch(() => "");
                            throw new Error(`HTTP ${resp.status}: ${t.substring(0, 200)}`);
                        }
                        const text = await resp.text();
                        let output = "";
                        for (const line of text.split("\n")) {
                            if (!line.trim()) continue;
                            try {
                                const chunk = JSON.parse(line);
                                if (chunk.status === "done") {
                                    output = chunk.output || "";
                                    if (chunk.debug_md) node._lastDebugMd = chunk.debug_md;
                                } else if (chunk.status === "error") {
                                    throw new Error(chunk.error || "Erreur inconnue");
                                }
                            } catch (e) {
                                if (e instanceof SyntaxError) continue;
                                throw e;
                            }
                        }
                        resultTextarea.value = output;
                        saveApiConfig();
                    } catch (err) {
                        resultTextarea.value = "Erreur: " + err.message;
                    }
                };

                // ========================================
                // onExecuted
                // ========================================

                const origExec = node.onExecuted;
                node.onExecuted = function (output) {
                    if (origExec) origExec.call(this, output);
                    const arr = output?.prompt;
                    if (Array.isArray(arr) && arr.length > 0) {
                        resultTextarea.value = String(arr[0]);
                    }
                };

                return r;
            };
        },

        async loadedGraphNode(node) {
            if (node._friaRestore) {
                setTimeout(() => node._friaRestore(), 0);
            }
        },
    });
})();