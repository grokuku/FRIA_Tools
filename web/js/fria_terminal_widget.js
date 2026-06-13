/**
 * FR.IA Terminal — DOM widget for FRIATerminalNode.
 *
 * Renders an xterm.js terminal in a ComfyUI node. Connects to the
 * backend WebSocket at /fr_ia/terminal (no password, local-only).
 *
 * Adapted from CUI-Holaf-Utils/js/holaf_terminal.js (Holaf, 2025).
 *
 * Differences vs. Holaf version:
 *   - Lives inside a ComfyUI DOM widget (not a floating Holaf panel).
 *   - No login / password flow. Just a "Connect" button.
 *   - No settings persistence (theme, font size, panel position).
 *   - Always uses a single dark xterm theme.
 *
 * Conflict avoidance with CUI-Holaf-Utils:
 *   - Backend route is /fr_ia/terminal (not /holaf/terminal).
 *   - WebSocket protocol is identical, so this widget and Holaf's
 *     panel can be installed side-by-side without interference.
 *   - xterm.js is loaded on demand from `extensions/FRIA_Tools/js/`.
 *     If Holaf is also installed and already loaded its xterm into
 *     window.Terminal, we reuse it (saves bandwidth, ensures the
 *     same xterm version is used).
 */
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    // ---- Helper : load a script from a given URL once ----
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing && existing.dataset.loaded) { resolve(); return; }
            if (existing) {
                existing.addEventListener('load', () => { existing.dataset.loaded = "1"; resolve(); }, { once: true });
                existing.addEventListener('error', () => reject(new Error("load failed: " + src)), { once: true });
                return;
            }
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => { s.dataset.loaded = "1"; resolve(); };
            s.onerror = () => reject(new Error("load failed: " + src));
            document.head.appendChild(s);
        });
    }

    // ---- Load xterm.js + FitAddon (reuse if Holaf already loaded them) ----
    async function ensureXtermLoaded() {
        if (window.Terminal && window.FitAddon) return;
        // Try our bundled copy first.
        const extBase = "extensions/FRIA_Tools/js/";
        try {
            if (!window.Terminal) {
                await loadScript(extBase + "xterm.js");
            }
            if (!window.FitAddon) {
                await loadScript(extBase + "xterm-addon-fit.js");
            }
        } catch (e) {
            // Fallback to Holaf's copy if our own is missing
            try {
                if (!window.Terminal) {
                    await loadScript("extensions/ComfyUI-Holaf-Utilities/js/xterm.js");
                }
                if (!window.FitAddon) {
                    await loadScript("extensions/ComfyUI-Holaf-Utilities/js/xterm-addon-fit.js");
                }
            } catch (e2) {
                throw new Error("Could not load xterm.js from FR.IA or Holaf bundles.");
            }
        }
    }

    app.registerExtension({
        name: "FR.IA.Terminal",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "FRIATerminalNode") return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = async function () {
                const r = onNodeCreated?.apply(this, arguments);
                const node = this;

                // ---- Container principal ----
                const container = document.createElement("div");
                Object.assign(container.style, {
                    width: "100%", padding: "8px", boxSizing: "border-box",
                    background: "#1a1a1e", borderRadius: "8px",
                    display: "flex", flexDirection: "column", gap: "6px",
                    fontSize: "12px", color: "#ccc", overflow: "hidden",
                });

                // ---- Bandeau d'avertissement ----
                const warning = document.createElement("div");
                warning.style.cssText = [
                    "background:#5a1a1a", "color:#ffcccc", "padding:6px 8px",
                    "border-radius:4px", "font-size:11px", "line-height:1.4",
                ].join(";");
                warning.innerHTML = "⚠️ <b>No password.</b> Anyone with network access to ComfyUI can run shell commands. Localhost only.";
                container.appendChild(warning);

                // ---- Zone xterm ----
                const xtermContainer = document.createElement("div");
                Object.assign(xtermContainer.style, {
                    width: "100%", height: "300px",
                    background: "#0a0a0a", borderRadius: "4px",
                    border: "1px solid #333", padding: "4px",
                    boxSizing: "border-box", overflow: "hidden",
                });
                container.appendChild(xtermContainer);

                // ---- Bouton Connect/Disconnect ----
                const statusRow = document.createElement("div");
                Object.assign(statusRow.style, {
                    display: "flex", gap: "6px", alignItems: "center",
                });
                const connectBtn = document.createElement("button");
                connectBtn.textContent = "🔌  Connect";
                Object.assign(connectBtn.style, {
                    padding: "6px 12px", borderRadius: "4px", border: "none",
                    background: "#6366f1", color: "white",
                    fontSize: "11px", fontWeight: "600", cursor: "pointer", flex: "1",
                });
                const statusText = document.createElement("span");
                statusText.textContent = "Disconnected";
                statusText.style.cssText = "color:#888; font-size:11px; flex: 0 0 auto;";
                statusRow.appendChild(connectBtn);
                statusRow.appendChild(statusText);
                container.appendChild(statusRow);

                // ---- DOM widget ----
                const widget = node.addDOMWidget("FRIA_Terminal", "div", container, {
                    serialize: false,
                    hideOnZoom: false,
                });
                widget.computeSize = () => [node.size[0] - 20, 400];

                // ---- Resize ----
                const onResize = node.onResize;
                node.onResize = function (size) {
                    const r = onResize?.apply(this, arguments);
                    widget.computeSize = () => [size[0] - 20, 400];
                    setTimeout(() => { try { if (fitAddon) fitAddon.fit(); } catch {} }, 50);
                    return r;
                };

                // ---- Terminal state ----
                let terminal = null;
                let fitAddon = null;
                let socket = null;
                let isConnected = false;

                function setStatus(text, connected) {
                    statusText.textContent = text;
                    statusText.style.color = connected ? "#7f7" : "#888";
                    connectBtn.textContent = connected ? "🔌  Disconnect" : "🔌  Connect";
                    connectBtn.style.background = connected ? "#a33" : "#6366f1";
                }

                function disconnect() {
                    try { if (socket) socket.close(); } catch {}
                    socket = null;
                    isConnected = false;
                    setStatus("Disconnected", false);
                    if (terminal) {
                        try { terminal.writeln("\r\n--- DISCONNECTED ---"); } catch {}
                    }
                }

                async function connect() {
                    if (isConnected) { disconnect(); return; }
                    setStatus("Loading xterm...", false);
                    try {
                        await ensureXtermLoaded();
                    } catch (e) {
                        setStatus("Error: " + e.message, false);
                        return;
                    }

                    if (!window.Terminal || !window.FitAddon) {
                        setStatus("Error: xterm not loaded", false);
                        return;
                    }

                    // Create terminal if not already
                    if (!terminal) {
                        terminal = new window.Terminal({
                            cursorBlink: true,
                            fontSize: 13,
                            fontFamily: "monospace",
                            theme: {
                                background: "#0a0a0a",
                                foreground: "#e0e0e0",
                                cursor: "#7f7",
                                selectionBackground: "#444",
                            },
                            rows: 24,
                        });
                        fitAddon = new window.FitAddon.FitAddon();
                        terminal.loadAddon(fitAddon);
                        terminal.open(xtermContainer);
                        setTimeout(() => { try { fitAddon.fit(); } catch {} }, 30);

                        // Wire input
                        terminal.onData(data => {
                            if (socket && socket.readyState === WebSocket.OPEN) {
                                socket.send(data);
                            }
                        });

                        // Ctrl+C / Ctrl+V
                        terminal.attachCustomKeyEventHandler(e => {
                            if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && e.type === 'keydown') {
                                if (terminal.hasSelection()) {
                                    try { navigator.clipboard.writeText(terminal.getSelection()); } catch {}
                                    return false;
                                }
                            }
                            if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && e.type === 'keydown') {
                                try {
                                    navigator.clipboard.readText().then(text => {
                                        if (text && terminal) terminal.paste(text);
                                    });
                                } catch {}
                                return false;
                            }
                            return true;
                        });
                    }

                    // Open WebSocket
                    setStatus("Connecting...", false);
                    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                    const url = `${protocol}//${window.location.host}/fr_ia/terminal`;

                    socket = new WebSocket(url);
                    socket.binaryType = "arraybuffer";

                    socket.onopen = () => {
                        isConnected = true;
                        setStatus("Connected", true);
                        requestAnimationFrame(() => {
                            try { fitAddon.fit(); terminal.focus(); } catch {}
                        });
                    };
                    socket.onmessage = (event) => {
                        if (!terminal) return;
                        try {
                            if (event.data instanceof ArrayBuffer) {
                                terminal.write(new Uint8Array(event.data));
                            } else {
                                terminal.write(event.data);
                            }
                        } catch (e) {
                            console.warn("[FR.IA Terminal] write error:", e);
                        }
                    };
                    socket.onclose = () => {
                        isConnected = false;
                        setStatus("Disconnected", false);
                        if (terminal) {
                            try { terminal.writeln("\r\n--- CONNECTION CLOSED ---"); } catch {}
                        }
                    };
                    socket.onerror = (e) => {
                        console.error("[FR.IA Terminal] WebSocket error:", e);
                        if (terminal) {
                            try { terminal.writeln("\r\n--- CONNECTION ERROR ---"); } catch {}
                        }
                    };
                }

                connectBtn.onclick = connect;

                // Cleanup when node is removed
                const onRemoved = node.onRemoved;
                node.onRemoved = function () {
                    disconnect();
                    if (terminal) {
                        try { terminal.dispose(); } catch {}
                        terminal = null;
                    }
                    return onRemoved?.apply(this, arguments);
                };

                return r;
            };
        },
    });
})();
