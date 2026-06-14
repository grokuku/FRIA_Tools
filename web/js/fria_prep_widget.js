/**
 * FR.IA Prompt Prep — Custom DOM widget for ComfyUI node FRIAPromptPrepNode.
 *
 * Ce node est une version "découplée" du FR.IA Prompt Enhancer :
 *   - Il NE fait PAS d'appel LLM
 *   - Il sort 3 strings (llm_prompt, system_prompt, neg_prompt)
 *   - L'utilisateur branche son propre node LLM (LM Studio, Ollama, etc.)
 *
 * DOM widget simplifié :
 *   - Grille 2 colonnes : Type (gauche) + Style (droite)
 *   - 1 bouton "↻" pour rafraichir la liste des styles
 *   - Pas de bouton "Test enhance", pas de textarea, pas de dropdown "Preset IA"
 *
 * Les widgets natifs ComfyUI (seed, base_prompt, special_instructions,
 * elements) sont restaurés automatiquement par ComfyUI au rechargement
 * de la page. Les widgets prompt_type et style_id sont natifs mais caches
 * (le DOM les pilote via leur .value).
 *
 * api_key et server_url sont lus depuis ComfyUI/user/default/fria_credentials.json
 * (helper Python _credentials). Plus de widget STRING _api_config.
 */
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    app.registerExtension({
        name: "FR.IA.PromptPrep",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "FRIAPromptPrepNode") return;

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
                ["prompt_type", "style_id"].forEach(n => hideWidget(node, n));

                // ---- Supprimer les sockets d'entrée ----
                for (const inputName of ["prompt_type", "style_id"]) {
                    const slot = node.findInputSlot?.(inputName);
                    if (slot !== undefined && slot !== -1) {
                        node.removeInput(slot);
                    }
                }

                // Refs vers les widgets natifs (utiles pour le sync)
                const promptTypeWidget = node.widgets?.find(x => x.name === "prompt_type");
                const styleWidget = node.widgets?.find(x => x.name === "style_id");

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

                function syncNativeWidgets() {
                    if (promptTypeWidget) promptTypeWidget.value = typeSelect.value;
                    if (styleWidget) styleWidget.value = parseInt(styleSelect.value) || 0;
                }

                // Restaurer la selection des dropdowns depuis les widgets natifs
                // (restaures par ComfyUI au rechargement de la page)
                function restoreFromNativeWidgets() {
                    if (promptTypeWidget && promptTypeWidget.value) {
                        if ([...typeSelect.options].some(o => o.value === promptTypeWidget.value)) {
                            typeSelect.value = promptTypeWidget.value;
                        }
                    }
                    if (styleWidget) {
                        const sid = parseInt(styleWidget.value) || 0;
                        if (sid > 0 && [...styleSelect.options].some(o => o.value === String(sid))) {
                            styleSelect.value = String(sid);
                        }
                    }
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

                // ---- Grille 2 colonnes (Type + Style) ----
                const grid = document.createElement("div");
                Object.assign(grid.style, {
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px",
                });

                const selectStyle = {
                    width: "100%", padding: "3px 6px", borderRadius: "4px",
                    border: "1px solid #555", background: "#3a3a3e",
                    color: "#ccc", fontSize: "11px", cursor: "pointer",
                };

                // Type (gauche) — peuplé depuis /api/prompts/templates
                const typeDiv = document.createElement("div");
                const typeSelect = document.createElement("select");
                Object.assign(typeSelect.style, selectStyle);
                typeSelect.onchange = syncNativeWidgets;
                typeDiv.appendChild(mkLabel("Template"));
                typeDiv.appendChild(typeSelect);
                grid.appendChild(typeDiv);

                async function loadPrepTemplates() {
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
                            typeSelect.appendChild(o);
                        });
                        // Restaurer la selection precedente, ou le widget natif
                        const pw = node.widgets?.find(x => x.name === "prompt_type");
                        if (current && [...typeSelect.options].some(o => o.value === current)) {
                            typeSelect.value = current;
                        } else if (pw && pw.value && [...typeSelect.options].some(o => o.value === pw.value)) {
                            typeSelect.value = pw.value;
                        }
                    } catch {}
                }
                typeSelect.addEventListener("mousedown", loadPrepTemplates);

                // Style (droite) — peuplé depuis /api/styles
                const styleDiv = document.createElement("div");
                const styleRow = document.createElement("div");
                Object.assign(styleRow.style, { display: "flex", gap: "4px", alignItems: "center" });
                const styleSelect = document.createElement("select");
                Object.assign(styleSelect.style, selectStyle);
                styleSelect.style.flex = "1";
                styleSelect.onchange = syncNativeWidgets;
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
                help.innerHTML = "Sort 3 strings : <b>llm_prompt</b>, <b>system_prompt</b>, <b>neg_prompt</b>.<br>Branchez votre node LLM sur les 2 premiers.";
                container.appendChild(help);

                // ---- Ajout au node ----
                const widget = node.addDOMWidget("FRIA_PromptPrep", "div", container, {
                    serialize: false,
                    hideOnZoom: false,
                });
                widget.computeSize = () => [node.size[0] - 20, 110];

                // ---- Initialisation ----
                loadPrepTemplates();
                populateStyleSelect().then(() => {
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

                // ---- Resize au resize du node ----
                const onResize = node.onResize;
                node.onResize = function (size) {
                    const r = onResize?.apply(this, arguments);
                    widget.computeSize = () => [size[0] - 20, 110];
                    return r;
                };

                return r;
            };
        },
    });
})();
