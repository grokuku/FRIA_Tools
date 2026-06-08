/**
 * FR.IA Ideogram 4 Caption Builder — Custom DOM widget for ComfyUI node.
 *
 * Tous les widgets ComfyUI natifs sont caches. Le DOM widget gere tout :
 * seed, width, height, description, element_1..4, preset, style.
 * Les valeurs sont synchronisees avec les widgets caches pour la
 * sauvegarde/restauration du workflow.
 *
 * Flux :
 *   - "Run" (workflow) : Python lit les widgets caches, appelle l'API
 *   - "Generate" : JS appelle l'API pour un apercu instantane
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

                // ---- Cacher TOUS les widgets ----
                const hideWidget = (n, name) => {
                    const w = n.widgets?.find(x => x.name === name);
                    if (w) {
                        w.hidden = true;
                        w.computeSize = () => [0, -4];
                        if (w.inputEl) w.inputEl.style.display = "none";
                        if (w.parentEl) w.parentEl.style.display = "none";
                    }
                };
                ["seed", "width", "height", "description",
                 "element_1", "element_2", "element_3", "element_4",
                 "preset_id", "style_id", "_api_config"].forEach(
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

                // ---- Cache de rafraichissement des listes ----
                const _cache = (window.__FRIA_cache = window.__FRIA_cache || { presets: 0, styles: 0 });
                const CACHE_TTL = 15000;

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
                async function refreshIfStale(select, apiPath, cacheKey) {
                    const now = Date.now();
                    if (now - (_cache[cacheKey] || 0) < CACHE_TTL) return;
                    _cache[cacheKey] = now;
                    const oldVal = select.value;
                    await populateSelect(select, apiPath, "name", "id", select.options[0]?.textContent || "--", () => {
                        if ([...select.options].some(o => o.value === oldVal)) select.value = oldVal;
                    });
                }

                // ========================================
                // DOM WIDGET — contient TOUT
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

                const inputBaseStyle = {
                    width: "100%", padding: "3px 6px", borderRadius: "4px",
                    border: "1px solid #555", background: "#1a1a1e",
                    color: "#fff", fontSize: "11px", boxSizing: "border-box",
                };

                const selectStyle = {
                    width: "100%", padding: "3px 6px", borderRadius: "4px",
                    border: "1px solid #555", background: "#3a3a3e",
                    color: "#ccc", fontSize: "11px", cursor: "pointer",
                };

                // ======== Ligne 1 : Seed + Width + Height ========
                const dimRow = document.createElement("div");
                Object.assign(dimRow.style, { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" });

                // Seed (avec control after generate miniature)
                const seedDiv = document.createElement("div");
                const seedInput = document.createElement("input");
                seedInput.type = "text";
                seedInput.value = "0";
                Object.assign(seedInput.style, inputBaseStyle);
                seedDiv.appendChild(mkLabel("Seed"));
                seedDiv.appendChild(seedInput);

                const widthDiv = document.createElement("div");
                const widthInput = document.createElement("input");
                widthInput.type = "number";
                widthInput.value = "1024";
                Object.assign(widthInput.style, inputBaseStyle);
                widthInput.min = 64; widthInput.max = 4096;
                widthDiv.appendChild(mkLabel("Width"));
                widthDiv.appendChild(widthInput);

                const heightDiv = document.createElement("div");
                const heightInput = document.createElement("input");
                heightInput.type = "number";
                heightInput.value = "1024";
                Object.assign(heightInput.style, inputBaseStyle);
                heightInput.min = 64; heightInput.max = 4096;
                heightDiv.appendChild(mkLabel("Height"));
                heightDiv.appendChild(heightInput);

                dimRow.appendChild(seedDiv);
                dimRow.appendChild(widthDiv);
                dimRow.appendChild(heightDiv);
                container.appendChild(dimRow);

                // ======== Ligne 2 : Description ========
                const descTextarea = document.createElement("textarea");
                Object.assign(descTextarea.style, {
                    width: "100%", height: "60px", minHeight: "60px", maxHeight: "60px",
                    borderRadius: "4px", border: "1px solid #555",
                    padding: "4px", background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "none", boxSizing: "border-box",
                });
                descTextarea.placeholder = "Description generale (style, decor, lumiere, ambiance...)";
                container.appendChild(mkLabel("Description generale"));
                container.appendChild(descTextarea);

                // ======== Lignes 3-6 : 4 Elements ========
                const elemPlaceholders = [
                    "ex: une jeune barista aux cheveux boucles",
                    "ex: une tasse en porcelaine avec latte art",
                    "ex: une machine a espresso en laiton",
                    "ex: un comptoir en bois",
                ];
                const elemTextareas = [];
                for (let i = 0; i < 4; i++) {
                    const ta = document.createElement("textarea");
                    Object.assign(ta.style, {
                        width: "100%", height: "40px", minHeight: "40px", maxHeight: "40px",
                        borderRadius: "4px", border: "1px solid #555",
                        padding: "4px", background: "#1a1a1e", color: "#fff",
                        fontSize: "11px", resize: "none", boxSizing: "border-box",
                    });
                    ta.placeholder = elemPlaceholders[i];
                    container.appendChild(mkLabel(`Element ${i + 1}`));
                    container.appendChild(ta);
                    elemTextareas.push(ta);
                }

                // ======== Preset + Style (grille 2 col) ========
                const psRow = document.createElement("div");
                Object.assign(psRow.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });

                const presetDiv = document.createElement("div");
                const presetSelect = document.createElement("select");
                Object.assign(presetSelect.style, selectStyle);
                presetSelect.addEventListener("mousedown", () => refreshIfStale(presetSelect, "presets", "presets"));
                presetDiv.appendChild(mkLabel("Preset IA"));
                presetDiv.appendChild(presetSelect);
                psRow.appendChild(presetDiv);

                const styleDiv = document.createElement("div");
                const styleSelect = document.createElement("select");
                Object.assign(styleSelect.style, selectStyle);
                styleSelect.addEventListener("mousedown", () => refreshIfStale(styleSelect, "styles", "styles"));
                styleDiv.appendChild(mkLabel("Style"));
                styleDiv.appendChild(styleSelect);
                psRow.appendChild(styleDiv);
                container.appendChild(psRow);

                // ======== Generate button ========
                const generateBtn = document.createElement("button");
                generateBtn.textContent = "🔄  Generate Ideogram 4 caption";
                Object.assign(generateBtn.style, {
                    width: "100%", padding: "6px", borderRadius: "4px",
                    border: "none", background: "#6366f1", color: "white",
                    fontSize: "11px", fontWeight: "600", cursor: "pointer",
                    flex: "0 0 auto",
                });
                generateBtn.onmouseenter = () => generateBtn.style.background = "#5558e8";
                generateBtn.onmouseleave = () => generateBtn.style.background = "#6366f1";
                container.appendChild(generateBtn);

                // ======== Result textarea ========
                const resultTextarea = document.createElement("textarea");
                Object.assign(resultTextarea.style, {
                    width: "100%",
                    height: "120px", minHeight: "120px", maxHeight: "120px",
                    borderRadius: "4px", border: "1px solid #555",
                    padding: "4px", background: "#1a1a1e", color: "#fff",
                    fontSize: "11px", resize: "none", boxSizing: "border-box",
                });
                resultTextarea.placeholder = "JSON caption Ideogram 4...";
                resultTextarea.readOnly = true;
                container.appendChild(mkLabel("Resultat (JSON caption)"));
                container.appendChild(resultTextarea);

                // ======== Preview canvas ========
                const previewHeader = document.createElement("div");
                Object.assign(previewHeader.style, {
                    fontSize: "10px", color: "#888", display: "flex", justifyContent: "space-between",
                });
                container.appendChild(mkLabel("Preview"));
                container.appendChild(previewHeader);

                const canvasWrap = document.createElement("div");
                Object.assign(canvasWrap.style, {
                    width: "100%", height: "220px",
                    background: "#1a1a1e", borderRadius: "4px", overflow: "hidden",
                    display: "flex", alignItems: "center", justifyContent: "center",
                });
                const canvas = document.createElement("canvas");
                Object.assign(canvas.style, {
                    maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block",
                });
                canvasWrap.appendChild(canvas);
                container.appendChild(canvasWrap);

                const previewFooter = document.createElement("div");
                Object.assign(previewFooter.style, {
                    fontSize: "10px", color: "#888", textAlign: "center",
                });
                container.appendChild(previewFooter);

                // ========================================
                // Integration DOM Widget
                // ========================================
                const domWidget = node.addDOMWidget("ideogram4_ui", "custom", container, {
                    getValue: () => "",
                    setValue: (v) => {},
                    getMinHeight: () => 580,
                    getMaxHeight: () => 1500,
                });

                node._resultArea = resultTextarea;
                node._domWidget = domWidget;

                // ========================================
                // SYNC : DOM → widgets caches (pour sauvegarde workflow)
                // ========================================
                function syncAll() {
                    const set = (name, val) => {
                        const w = node.widgets?.find(x => x.name === name);
                        if (w) w.value = val;
                    };
                    set("seed", parseInt(seedInput.value) || 0);
                    set("width", parseInt(widthInput.value) || 1024);
                    set("height", parseInt(heightInput.value) || 1024);
                    set("description", descTextarea.value);
                    set("element_1", elemTextareas[0].value);
                    set("element_2", elemTextareas[1].value);
                    set("element_3", elemTextareas[2].value);
                    set("element_4", elemTextareas[3].value);
                    set("preset_id", parseInt(presetSelect.value) || 0);
                    set("style_id", parseInt(styleSelect.value) || 0);
                    const a = node.widgets?.find(x => x.name === "_api_config");
                    if (a) a.value = JSON.stringify({ api_url: getApiUrl(), api_key: getApiKey() });
                }

                // Sync tous les champs sur chaque changement
                const allInputs = [seedInput, widthInput, heightInput, descTextarea,
                    ...elemTextareas, presetSelect, styleSelect];
                allInputs.forEach(el => {
                    el.addEventListener("input", syncAll);
                    el.addEventListener("change", syncAll);
                });

                // ========================================
                // RESTORE : widgets caches → DOM
                // ========================================
                function restoreFromWidgets(n) {
                    const read = (name) => n.widgets?.find(w => w.name === name);
                    try {
                        const sd = read("seed"); if (sd) seedInput.value = sd.value;
                        const w = read("width"); if (w) widthInput.value = w.value;
                        const h = read("height"); if (h) heightInput.value = h.value;
                        const d = read("description"); if (d) descTextarea.value = d.value;
                        read("element_1"); if (elemTextareas[0]) {
                            const e = read("element_1"); if (e) elemTextareas[0].value = e.value;
                            const e2 = read("element_2"); if (e2) elemTextareas[1].value = e2.value;
                            const e3 = read("element_3"); if (e3) elemTextareas[2].value = e3.value;
                            const e4 = read("element_4"); if (e4) elemTextareas[3].value = e4.value;
                        }
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

                // ========================================
                // GENERATE
                // ========================================
                generateBtn.onclick = async () => {
                    const description = descTextarea.value.trim();
                    const elTexts = elemTextareas.map(ta => ta.value.trim()).filter(Boolean);
                    const seedVal = parseInt(seedInput.value) || 0;

                    const payload = {
                        text: description,
                        seed: seedVal > 0 ? seedVal : null,
                        prompt_type: "ideogram4",
                        width: parseInt(widthInput.value) || 1024,
                        height: parseInt(heightInput.value) || 1024,
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
                        const data = await apiPost("enhance", payload);
                        const prompt = data.output || "";
                        resultTextarea.value = prompt;
                        syncAll();
                        schedulePreview();
                    } catch (err) {
                        resultTextarea.value = "Erreur: " + err.message;
                    }
                };

                // ========================================
                // PREVIEW (canvas)
                // ========================================
                function parseCaption(raw) {
                    if (!raw || !raw.trim()) return null;
                    try {
                        let s = raw.trim();
                        const m = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
                        if (m) s = m[1];
                        return JSON.parse(s);
                    } catch (e) { return null; }
                }

                function readInputValues() {
                    return {
                        width: parseInt(widthInput.value) || 1024,
                        height: parseInt(heightInput.value) || 1024,
                    };
                }

                function sizeCanvas(w, h) {
                    const aw = canvasWrap.clientWidth - 16;
                    const ah = canvasWrap.clientHeight - 16;
                    if (aw <= 0 || ah <= 0) return { cw: 100, ch: 100 };
                    const r = w / h;
                    let cw, ch;
                    if (aw / ah > r) { ch = ah; cw = ch * r; }
                    else { cw = aw; ch = cw / r; }
                    const dpr = window.devicePixelRatio || 1;
                    canvas.width = cw * dpr;
                    canvas.height = ch * dpr;
                    canvas.style.width = cw + "px";
                    canvas.style.height = ch + "px";
                    const ctx = canvas.getContext("2d");
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    return { cw, ch };
                }

                function drawEmpty(w, h) {
                    const ctx = canvas.getContext("2d");
                    const { cw, ch } = sizeCanvas(w, h);
                    ctx.fillStyle = "#1a1a1e";
                    ctx.fillRect(0, 0, cw, ch);
                    ctx.strokeStyle = "#555";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(1, 1, cw - 2, ch - 2);
                    ctx.fillStyle = "#555";
                    ctx.font = "12px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("Aucune bbox a afficher", cw / 2, ch / 2);
                }

                function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
                    const words = text.split(/\s+/);
                    let line = "";
                    let yy = y;
                    let lines = 0;
                    for (let i = 0; i < words.length; i++) {
                        const test = line ? line + " " + words[i] : words[i];
                        if (ctx.measureText(test).width > maxW && line) {
                            ctx.fillText(line, x, yy);
                            line = words[i];
                            yy += lineH;
                            lines++;
                            if (lines >= maxLines) {
                                ctx.fillText(line + (i < words.length - 1 ? "..." : ""), x, yy);
                                return;
                            }
                        } else { line = test; }
                    }
                    if (line) ctx.fillText(line, x, yy);
                }

                function hexToRgba(hex, alpha) {
                    const h = hex.replace("#", "");
                    const r = parseInt(h.substring(0, 2), 16);
                    const g = parseInt(h.substring(2, 4), 16);
                    const b = parseInt(h.substring(4, 6), 16);
                    return `rgba(${r},${g},${b},${alpha})`;
                }

                function draw() {
                    const { width, height } = readInputValues();
                    const gcd = (a, b) => b ? gcd(b, a % b) : a;
                    const g = gcd(width, height);
                    previewHeader.innerHTML = `<span>${width}x${height}</span><span>${width / g}:${height / g}</span>`;

                    const caption = parseCaption(resultTextarea.value);
                    if (!caption) {
                        drawEmpty(width, height);
                        previewFooter.textContent = "JSON invalide ou absent";
                        return;
                    }
                    const elements = caption?.compositional_deconstruction?.elements || [];
                    const background = caption?.compositional_deconstruction?.background || "";
                    if (elements.length === 0 && !background) {
                        drawEmpty(width, height);
                        previewFooter.textContent = "JSON vide";
                        return;
                    }

                    const ctx = canvas.getContext("2d");
                    const { cw, ch } = sizeCanvas(width, height);
                    ctx.fillStyle = "#2a2a2e";
                    ctx.fillRect(0, 0, cw, ch);

                    const colors = ["#22d3ee", "#84cc16", "#a855f7", "#eab308",
                                    "#f97316", "#ec4899", "#06b6d4"];
                    let drawn = 0;
                    elements.forEach((el, idx) => {
                        if (!el.bbox || !Array.isArray(el.bbox) || el.bbox.length !== 4) return;
                        drawn++;
                        const [yMin, xMin, yMax, xMax] = el.bbox;
                        const x = (xMin / 1000) * cw, y = (yMin / 1000) * ch;
                        const bw = ((xMax - xMin) / 1000) * cw, bh = ((yMax - yMin) / 1000) * ch;
                        const color = colors[idx % colors.length];

                        ctx.fillStyle = hexToRgba(color, 0.08);
                        ctx.fillRect(x, y, bw, bh);
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);

                        const idxLabel = String(idx + 1).padStart(2, "0");
                        ctx.font = "bold 11px monospace";
                        const pillW = Math.max(ctx.measureText(idxLabel).width + 10, 22);
                        const pillH = 16;
                        ctx.fillStyle = color;
                        ctx.fillRect(x, y, pillW, pillH);
                        ctx.fillStyle = "#000";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(idxLabel, x + pillW / 2, y + pillH / 2 + 0.5);

                        const textX = x + 6;
                        const textY = y + pillH + 6;
                        const textW = bw - 12;
                        ctx.textAlign = "left";
                        ctx.textBaseline = "top";
                        if (el.type === "text" && el.text) {
                            ctx.fillStyle = color;
                            ctx.font = "bold 11px sans-serif";
                            wrapText(ctx, `"${el.text}"`, textX, textY, textW, 13, 2);
                            if (el.desc) {
                                ctx.fillStyle = "rgba(255,255,255,0.75)";
                                ctx.font = "10px sans-serif";
                                wrapText(ctx, el.desc, textX, textY + 30, textW, 12, 4);
                            }
                        } else if (el.desc) {
                            ctx.fillStyle = "#fff";
                            ctx.font = "11px sans-serif";
                            wrapText(ctx, el.desc, textX, textY, textW, 13, 5);
                        }
                    });

                    if (background) {
                        const bgH = Math.min(40, ch * 0.18);
                        const bgY = ch - bgH;
                        ctx.fillStyle = "rgba(0,0,0,0.7)";
                        ctx.fillRect(0, bgY, cw, bgH);
                        ctx.fillStyle = "rgba(255,255,255,0.5)";
                        ctx.font = "italic 9px sans-serif";
                        ctx.textAlign = "left";
                        ctx.textBaseline = "top";
                        wrapText(ctx, "BG: " + background, 6, bgY + 4, cw - 12, 11, 3);
                    }

                    previewFooter.textContent = drawn === 0
                        ? "(JSON valide, mais aucun element avec bbox)"
                        : `${drawn} element(s)`;
                }

                function schedulePreview() {
                    clearTimeout(node._friaPreviewTimer);
                    node._friaPreviewTimer = setTimeout(draw, 50);
                }

                // Redessiner la preview quand le resultat change
                resultTextarea.addEventListener("input", schedulePreview);
                widthInput.addEventListener("input", schedulePreview);
                heightInput.addEventListener("input", schedulePreview);

                const ro = new ResizeObserver(schedulePreview);
                ro.observe(canvasWrap);
                setTimeout(draw, 200);

                // ========================================
                // onExecuted (Python run)
                // ========================================
                const origExec = node.onExecuted;
                node.onExecuted = function (output) {
                    if (origExec) origExec.call(this, output);
                    const arr = output?.prompt;
                    if (Array.isArray(arr) && arr.length > 0) {
                        resultTextarea.value = String(arr[0]);
                        schedulePreview();
                    }
                };

                // Sync initial : on peuple les dropdowns et on restaure.
                // Ne PAS appeler syncAll() ici : les widgets caches viennent
                // d'etre restores par ComfyUI avec les valeurs du workflow.
                // syncAll() sera appele APRES restoreFromWidgets (callbacks
                // populateSelect) ou quand l'utilisateur modifie un champ.
                populateSelect(presetSelect, "presets", "name", "id", "-- Preset IA --",
                    () => {
                        if (restoreFromWidgets(node)) {
                            syncAll();
                            schedulePreview();
                        }
                    });
                populateSelect(styleSelect, "styles", "name", "id", "-- Style --",
                    () => {
                        if (restoreFromWidgets(node)) {
                            syncAll();
                            schedulePreview();
                        }
                    });

                return r;
            };
        },
    });
})();
