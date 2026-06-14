/**
 * FR.IA Ideogram Prep — Custom DOM widget for ComfyUI node FRIAIdeogramPrepNode.
 *
 * Version "découplée" du FR.IA Ideogram 4 Builder :
 *   - Il NE fait PAS d'appel LLM
 *   - Il sort 3 strings (llm_prompt, system_prompt, context)
 *   - L'utilisateur branche son propre node LLM (LM Studio, Ollama, etc.)
 *   - Puis le FR.IA Ideogram Parse parse la réponse
 *
 * DOM widget : grille 2 colonnes (Type fixé à ideogram4 + Style).
 *
 * Les widgets natifs ComfyUI (seed, description, element_1..4, special_instructions,
 * width, height, style_id) sont restaurés automatiquement par ComfyUI au
 * rechargement. Le DOM widget pilote juste style_id.
 */
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    app.registerExtension({
        name: "FR.IA.IdeogramPrep",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "FRIAIdeogramPrepNode") return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated?.apply(this, arguments);
                const node = this;

                // ---- Cacher les widgets natifs pilotes par le DOM ----
                // On utilise UNIQUEMENT w.hidden = true (pas de computeSize negatif
                // qui empeche ComfyUI de serialiser la valeur du widget)
                const styleWidget = node.widgets?.find(x => x.name === "style_id");
                if (styleWidget) {
                    styleWidget.hidden = true;
                    if (styleWidget.inputEl) styleWidget.inputEl.style.display = "none";
                    if (styleWidget.parentEl) styleWidget.parentEl.style.display = "none";
                }
                const promptTypeWidget = node.widgets?.find(x => x.name === "prompt_type");
                if (promptTypeWidget) {
                    promptTypeWidget.hidden = true;
                    if (promptTypeWidget.inputEl) promptTypeWidget.inputEl.style.display = "none";
                    if (promptTypeWidget.parentEl) promptTypeWidget.parentEl.style.display = "none";
                }
                // Supprimer les sockets d'entrée
                for (const inputName of ["style_id", "prompt_type"]) {
                    const slot = node.findInputSlot?.(inputName);
                    if (slot !== undefined && slot !== -1) {
                        node.removeInput(slot);
                    }
                }

                // ---- Cache de rafraîchissement ----
                const _cache = (window.__FRIA_cache = window.__FRIA_cache || { styles: 0 });
                const CACHE_TTL = 15000;

                // URL API pour recuperer la liste des styles
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

                function syncStyleWidget() {
                    if (styleWidget) {
                        styleWidget.value = parseInt(styleSelect.value) || 0;
                    }
                    if (promptTypeWidget) {
                        promptTypeWidget.value = parseInt(typeSelect.value) || 0;
                    }
                }

                function restoreFromNativeWidget() {
                    let restored = false;
                    if (styleWidget) {
                        const sid = parseInt(styleWidget.value) || 0;
                        if (sid > 0 && [...styleSelect.options].some(o => o.value === String(sid))) {
                            styleSelect.value = String(sid);
                            restored = true;
                        }
                    }
                    if (promptTypeWidget && promptTypeWidget.value > 0) {
                        if ([...typeSelect.options].some(o => o.value === String(promptTypeWidget.value))) {
                            typeSelect.value = String(promptTypeWidget.value);
                            restored = true;
                        }
                    }
                    return restored;
                }

                async function populateStyleSelect() {
                    styleSelect.innerHTML = `<option value="0">-- Style --</option>`;
                    try {
                        const items = await apiGet("styles");
                        if (Array.isArray(items)) {
                            items.forEach(item => {
                                const o = document.createElement("option");
                                o.value = item.id;
                                o.textContent = item.name;
                                styleSelect.appendChild(o);
                            });
                        }
                    } catch {}
                }

                async function refreshStylesIfStale() {
                    const now = Date.now();
                    if (now - (_cache.styles || 0) < CACHE_TTL) return;
                    _cache.styles = now;
                    const oldVal = styleSelect.value;
                    await populateStyleSelect();
                    if ([...styleSelect.options].some(o => o.value === oldVal)) {
                        styleSelect.value = oldVal;
                    }
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

                // ---- Grille 2 colonnes (Type fixé + Style) ----
                const grid = document.createElement("div");
                Object.assign(grid.style, {
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px",
                });

                const selectStyle = {
                    width: "100%", padding: "3px 6px", borderRadius: "4px",
                    border: "1px solid #555", background: "#3a3a3e",
                    color: "#ccc", fontSize: "11px", cursor: "pointer",
                };

                // Type (gauche) — peuplé depuis les templates
                const typeDiv = document.createElement("div");
                const typeSelect = document.createElement("select");
                Object.assign(typeSelect.style, selectStyle);
                typeDiv.appendChild(mkLabel("Template"));
                typeDiv.appendChild(typeSelect);
                grid.appendChild(typeDiv);

                async function loadIdeogramPrepTemplates() {
                    const current = typeSelect.value;
                    typeSelect.innerHTML = '<option value="">-- Chargement --</option>';
                    try {
                        const apiUrl = getApiUrl();
                        const resp = await fetch(apiUrl + '/prompts/templates', { headers: apiHeaders() });
                        const list = resp.ok ? await resp.json() : [];
                        if (!Array.isArray(list) || list.length === 0) return;
                        typeSelect.innerHTML = '';
                        list.forEach(t => {
                            const o = document.createElement("option");
                    o.value = t.prompt_type;
                                o.textContent = t.name || t.prompt_type;
                                o.dataset.promptType = t.prompt_type;
                            typeSelect.appendChild(o);
                        });
                        if (current && [...typeSelect.options].some(o => o.value === current)) {
                            typeSelect.value = current;
                        }
                    } catch {}
                }
                typeSelect.addEventListener("mousedown", loadIdeogramPrepTemplates);

                // Style (droite)
                const styleDiv = document.createElement("div");
                const styleRow = document.createElement("div");
                Object.assign(styleRow.style, { display: "flex", gap: "4px", alignItems: "center" });
                const styleSelect = document.createElement("select");
                Object.assign(styleSelect.style, selectStyle);
                styleSelect.style.flex = "1";
                typeSelect.onchange = syncStyleWidget;
                styleSelect.onchange = syncStyleWidget;
                styleSelect.addEventListener("mousedown", refreshStylesIfStale);
                const styleRefreshBtn = document.createElement("button");
                styleRefreshBtn.textContent = "↻";
                Object.assign(styleRefreshBtn.style, {
                    padding: "2px 5px", fontSize: "10px", cursor: "pointer",
                    border: "1px solid #555", borderRadius: "3px",
                    background: "#3a3a3e", color: "#aaa", flex: "0 0 auto",
                });
                styleRefreshBtn.title = "Rafraîchir la liste des styles";
                styleRefreshBtn.onclick = () => { _cache.styles = 0; refreshStylesIfStale(); };
                styleDiv.appendChild(mkLabel("Style"));
                styleRow.appendChild(styleSelect);
                styleRow.appendChild(styleRefreshBtn);
                styleDiv.appendChild(styleRow);
                grid.appendChild(styleDiv);

                container.appendChild(grid);

                // Mini-explication
                const help = document.createElement("div");
                help.style.cssText = "font-size:10px;color:#777;margin-top:4px;line-height:1.4;";
                help.innerHTML = "Sort 3 strings : <b>llm_prompt</b>, <b>system_prompt</b>, <b>context</b>.<br>Branchez un LLM puis la node Parse.";
                container.appendChild(help);

                // ---- Ajout au node ----
                const widget = node.addDOMWidget("FRIA_IdeogramPrep", "div", container, {
                    serialize: false,
                    hideOnZoom: false,
                });
                widget.computeSize = () => [node.size[0] - 20, 105];

                // ---- Initialisation ----
                loadIdeogramPrepTemplates().then(() => {
                    restoreFromNativeWidget();
                    syncStyleWidget();
                    let ra = 0;
                    function delayedRestore() {
                        if (restoreFromNativeWidget()) return;
                        if (++ra < 20) setTimeout(delayedRestore, 300);
                    }
                    setTimeout(delayedRestore, 100);
                });
                populateStyleSelect().then(() => {
                    restoreFromNativeWidget();
                    syncStyleWidget();
                    let ra = 0;
                    function delayedRestore() {
                        if (restoreFromNativeWidget()) return;
                        if (++ra < 20) setTimeout(delayedRestore, 300);
                    }
                    setTimeout(delayedRestore, 100);
                });

                // ---- Resize ----
                const onResize = node.onResize;
                node.onResize = function (size) {
                    const r = onResize?.apply(this, arguments);
                    widget.computeSize = () => [size[0] - 20, 105];
                    return r;
                };

                node._friaRestore = function () {
                    let ra = 0;
                    const retry = () => {
                        const restored = restoreFromNativeWidget();
                        if (!restored && ++ra < 20) setTimeout(retry, 300);
                    };
                    retry();
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
