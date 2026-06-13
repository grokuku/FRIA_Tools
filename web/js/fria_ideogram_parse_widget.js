/**
 * FR.IA Ideogram Parse — DOM widget for FRIAIdeogramParseNode.
 *
 * Le node Parse est très simple : il prend la string LLM en entrée, parse
 * le JSON, valide, convertit les bboxes, sort le prompt + preview.
 *
 * Pas de dropdowns à piloter. Juste un petit texte d'aide qui montre
 * quel pass_number est actif (1 ou 2).
 */
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    app.registerExtension({
        name: "FR.IA.IdeogramParse",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "FRIAIdeogramParseNode") return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated?.apply(this, arguments);
                const node = this;

                // ---- Container simple (juste un help text) ----
                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%", padding: "8px", boxSizing: "border-box",
                    background: "#2a2a2e", borderRadius: "8px",
                    display: "flex", flexDirection: "column", gap: "4px",
                    fontSize: "11px", color: "#ccc", overflow: "hidden",
                });

                const help = document.createElement("div");
                help.style.cssText = "line-height:1.4;color:#888;";
                help.innerHTML = "Parse la sortie du LLM Ideogram 4 (passe 1 ou 2).<br>"
                    + "Sort : <b>prompt</b> (JSON), <b>preview</b> (IMAGE), "
                    + "<b>validation_prompt</b> (si pass=1).";
                container.appendChild(help);

                // Indicateur du pass_number actuel
                const passIndicator = document.createElement("div");
                passIndicator.style.cssText = "font-size:10px;color:#6366f1;margin-top:4px;font-weight:600;";
                const updatePassIndicator = () => {
                    const w = node.widgets?.find(x => x.name === "pass_number");
                    const pass = w ? w.value : 1;
                    passIndicator.textContent = `→ Actif : passe ${pass}`;
                    if (pass === 1) {
                        passIndicator.style.color = "#6366f1";
                    } else {
                        passIndicator.style.color = "#22c55e";
                    }
                };
                const passWidget = node.widgets?.find(x => x.name === "pass_number");
                if (passWidget) {
                    const origCallback = passWidget.callback;
                    passWidget.callback = function () {
                        const r = origCallback?.apply(this, arguments);
                        updatePassIndicator();
                        return r;
                    };
                }
                container.appendChild(passIndicator);
                updatePassIndicator();

                // ---- Ajout au node ----
                const widget = node.addDOMWidget("FRIA_IdeogramParse", "div", container, {
                    serialize: false,
                    hideOnZoom: false,
                });
                widget.computeSize = () => [node.size[0] - 20, 80];

                // ---- Resize ----
                const onResize = node.onResize;
                node.onResize = function (size) {
                    const r = onResize?.apply(this, arguments);
                    widget.computeSize = () => [size[0] - 20, 80];
                    return r;
                };

                return r;
            };
        },
    });
})();
