/**
 * FR.IA Terminal — Floating panel (singleton) for ComfyUI.
 *
 * Adapted from CUI-Holaf-Utils/js/holaf_terminal.js (Holaf, 2025).
 *
 * Architecture :
 *   - Singleton : un seul panel existe, accessible via le menu FR.IA → 💻 Terminal.
 *   - Floating panel : positionné en `position: fixed`, draggable, redimensionnable.
 *   - Persistant : taille / position / fullscreen / thème / font-size / dernière
 *     commande sont sauvegardés dans localStorage.fria_terminal_settings.
 *   - Conflit-safe avec CUI-Holaf-Utils : route `/fr_ia/terminal` (pas /holaf/),
 *     expose `window.friaTerminal` (pas `window.holafTerminal`).
 *   - PAS DE MOT DE PASSE : usage local uniquement. Bandeau d'avertissement
 *     toujours visible.
 */
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    // ════════════════════════════════════════════════════════════════════
    //  Helpers
    // ════════════════════════════════════════════════════════════════════

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

    async function ensureXtermLoaded() {
        if (window.Terminal && window.FitAddon) return;
        // Try FR.IA first, then fall back to Holaf if not installed.
        const sources = [
            "extensions/FRIA_Tools/js/xterm.js",
            "extensions/FRIA_Tools/js/xterm-addon-fit.js",
            "extensions/ComfyUI-Holaf-Utilities/js/xterm.js",
            "extensions/ComfyUI-Holaf-Utilities/js/xterm-addon-fit.js",
        ];
        for (const src of sources) {
            try {
                if (src.endsWith("xterm.js") && !window.Terminal) {
                    await loadScript(src);
                } else if (src.endsWith("xterm-addon-fit.js") && !window.FitAddon) {
                    await loadScript(src);
                }
            } catch (e) { /* try next */ }
        }
        if (!window.Terminal || !window.FitAddon) {
            throw new Error("xterm.js introuvable (ni dans FR.IA, ni dans Holaf).");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    //  Settings (localStorage)
    // ════════════════════════════════════════════════════════════════════

    const STORAGE_KEY = "fria_terminal_settings";
    const DEFAULTS = {
        fontSize: 13,
        theme: "dark",
        panel_x: null,
        panel_y: null,
        panel_width: 720,
        panel_height: 420,
        panel_is_fullscreen: false,
    };
    const THEMES = {
        dark: { background: "#0a0a0a", foreground: "#e0e0e0", cursor: "#7f7", selectionBackground: "#444" },
        light: { background: "#fafafa", foreground: "#1a1a1a", cursor: "#27c93f", selectionBackground: "#b4d5fe" },
        solarized: { background: "#002b36", foreground: "#839496", cursor: "#93a1a1", selectionBackground: "#073642" },
        monokai: { background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f0", selectionBackground: "#49483e" },
    };

    function loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            return { ...DEFAULTS, ...s };
        } catch { return { ...DEFAULTS }; }
    }
    let saveTimer = null;
    function saveSettings(patch) {
        friaTerminal.settings = { ...friaTerminal.settings, ...patch };
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(friaTerminal.settings)); } catch {}
        }, 200);
    }

    // ════════════════════════════════════════════════════════════════════
    //  Panel singleton
    // ════════════════════════════════════════════════════════════════════

    const friaTerminal = {
        panelEl: null,
        contentEl: null,
        xtermContainer: null,
        terminal: null,
        fitAddon: null,
        socket: null,
        isConnected: false,
        settings: loadSettings(),

        // ── Public API ────────────────────────────────────────────────
        toggle() { this.isOpen() ? this.hide() : this.show(); },
        isOpen() { return !!this.panelEl && this.panelEl.style.display === "flex"; },

        show() {
            if (!this.panelEl) { this._createPanel(); }
            this.panelEl.style.display = "flex";
            this._bringToFront();
            this._connectIfNeeded();
        },

        hide() {
            if (this.panelEl) this.panelEl.style.display = "none";
        },

        // ── Build DOM (once) ─────────────────────────────────────────
        _createPanel() {
            // ---- Panel root ----
            const panel = document.createElement("div");
            panel.id = "fria-terminal-panel";
            Object.assign(panel.style, {
                position: "fixed",
                display: "flex", flexDirection: "column",
                background: "#1a1a1e",
                border: "1px solid #444",
                borderRadius: "8px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                overflow: "hidden",
                zIndex: "9999",
                fontFamily: "sans-serif",
                minWidth: "400px", minHeight: "200px",
            });

            // ---- Header ----
            const header = document.createElement("div");
            Object.assign(header.style, {
                padding: "8px 12px", background: "#2a2a2e",
                color: "#ccc", fontSize: "12px", fontWeight: "600",
                display: "flex", alignItems: "center", gap: "8px",
                cursor: "move", userSelect: "none",
                borderBottom: "1px solid #444",
            });
            const title = document.createElement("span");
            title.innerHTML = "💻 FR.IA Terminal";
            title.style.flex = "1";
            header.appendChild(title);

            // Theme selector
            const themeSelect = document.createElement("select");
            Object.assign(themeSelect.style, {
                padding: "2px 4px", background: "#3a3a3e", color: "#ccc",
                border: "1px solid #555", borderRadius: "3px", fontSize: "11px",
            });
            Object.keys(THEMES).forEach(t => {
                const o = document.createElement("option");
                o.value = t; o.textContent = t;
                themeSelect.appendChild(o);
            });
            themeSelect.value = this.settings.theme;
            themeSelect.onchange = () => {
                this.settings.theme = themeSelect.value;
                saveSettings({ theme: themeSelect.value });
                this._applyTheme();
            };
            header.appendChild(themeSelect);

            // Font size controls
            const mkBtn = (label, title, onClick) => {
                const b = document.createElement("button");
                b.textContent = label; b.title = title;
                Object.assign(b.style, {
                    padding: "2px 6px", background: "#3a3a3e", color: "#ccc",
                    border: "1px solid #555", borderRadius: "3px",
                    fontSize: "11px", cursor: "pointer",
                });
                b.onmouseenter = () => b.style.background = "#4a4a4e";
                b.onmouseleave = () => b.style.background = "#3a3a3e";
                b.onclick = onClick;
                return b;
            };
            header.appendChild(mkBtn("A-", "Decrease font size", () => {
                this.settings.fontSize = Math.max(8, this.settings.fontSize - 1);
                saveSettings({ fontSize: this.settings.fontSize });
                if (this.terminal) { this.terminal.options.fontSize = this.settings.fontSize; this._fit(); }
            }));
            header.appendChild(mkBtn("A+", "Increase font size", () => {
                this.settings.fontSize = Math.min(28, this.settings.fontSize + 1);
                saveSettings({ fontSize: this.settings.fontSize });
                if (this.terminal) { this.terminal.options.fontSize = this.settings.fontSize; this._fit(); }
            }));

            // Fullscreen toggle
            header.appendChild(mkBtn("⛶", "Toggle fullscreen", () => this._toggleFullscreen()));

            // Close
            const closeBtn = mkBtn("✕", "Close", () => this.hide());
            closeBtn.onmouseenter = () => { closeBtn.style.background = "#a33"; };
            closeBtn.onmouseleave = () => { closeBtn.style.background = "#3a3a3e"; };
            header.appendChild(closeBtn);

            panel.appendChild(header);

            // ---- Body ----
            const body = document.createElement("div");
            Object.assign(body.style, {
                display: "flex", flexDirection: "column", flex: "1",
                background: "#1a1a1e", overflow: "hidden",
            });
            panel.appendChild(body);

            // Warning banner
            const warning = document.createElement("div");
            Object.assign(warning.style, {
                background: "#5a1a1a", color: "#ffcccc",
                padding: "4px 8px", fontSize: "10px", lineHeight: "1.3",
                borderBottom: "1px solid #333",
            });
            warning.innerHTML = "⚠️ <b>No password.</b> Anyone on this network can run shell commands. Localhost only.";
            body.appendChild(warning);

            // xterm container
            const xtermContainer = document.createElement("div");
            Object.assign(xtermContainer.style, {
                flex: "1", background: THEMES[this.settings.theme]?.background || "#0a0a0a",
                padding: "4px", overflow: "hidden", boxSizing: "border-box",
            });
            body.appendChild(xtermContainer);
            this.xtermContainer = xtermContainer;
            this.contentEl = body;

            // Status bar
            const statusBar = document.createElement("div");
            Object.assign(statusBar.style, {
                padding: "4px 8px", background: "#2a2a2e", color: "#888",
                fontSize: "11px", display: "flex", gap: "8px", alignItems: "center",
                borderTop: "1px solid #444",
            });
            const statusText = document.createElement("span");
            statusText.textContent = "Disconnected";
            statusText.id = "fria-terminal-status";
            statusBar.appendChild(statusText);
            const spacer = document.createElement("span");
            spacer.style.flex = "1";
            statusBar.appendChild(spacer);
            const connectBtn = document.createElement("button");
            connectBtn.textContent = "🔌 Connect";
            Object.assign(connectBtn.style, {
                padding: "2px 10px", background: "#6366f1", color: "white",
                border: "none", borderRadius: "3px", fontSize: "11px",
                fontWeight: "600", cursor: "pointer",
            });
            connectBtn.onmouseenter = () => connectBtn.style.background = "#5558e8";
            connectBtn.onmouseleave = () => connectBtn.style.background = "#6366f1";
            connectBtn.onclick = () => this._toggleConnection();
            statusBar.appendChild(connectBtn);
            body.appendChild(statusBar);
            this._statusText = statusText;
            this._connectBtn = connectBtn;

            // Resize handle (bottom-right)
            const resizeHandle = document.createElement("div");
            Object.assign(resizeHandle.style, {
                position: "absolute", right: "0", bottom: "0",
                width: "16px", height: "16px", cursor: "nwse-resize",
                background: "linear-gradient(135deg, transparent 50%, #666 50%, #666 60%, transparent 60%, transparent 70%, #666 70%, #666 80%, transparent 80%)",
            });
            panel.appendChild(resizeHandle);

            // ---- Position & size from settings ----
            this._applyPosition(panel);
            this._applySize(panel);

            // ---- Drag (header only) ----
            this._makeDraggable(panel, header);

            // ---- Resize (handle only) ----
            this._makeResizable(panel, resizeHandle);

            // ---- Double-click header = fullscreen ----
            header.ondblclick = (e) => {
                if (e.target === header || e.target === title) this._toggleFullscreen();
            };

            // ---- Bring to front on click ----
            panel.addEventListener("mousedown", () => this._bringToFront());

            document.body.appendChild(panel);
            this.panelEl = panel;
        },

        // ── Position / size / fullscreen ─────────────────────────────
        _applyPosition(panel) {
            const s = this.settings;
            if (s.panel_x !== null && s.panel_y !== null) {
                panel.style.left = s.panel_x + "px";
                panel.style.top = s.panel_y + "px";
                panel.style.right = "auto";
            } else {
                // First-time centering
                panel.style.left = "50%";
                panel.style.top = "50%";
                panel.style.transform = "translate(-50%, -50%)";
            }
        },
        _applySize(panel) {
            panel.style.width = this.settings.panel_width + "px";
            panel.style.height = this.settings.panel_height + "px";
        },
        _toggleFullscreen() {
            this.settings.panel_is_fullscreen = !this.settings.panel_is_fullscreen;
            saveSettings({ panel_is_fullscreen: this.settings.panel_is_fullscreen });
            if (this.settings.panel_is_fullscreen) {
                this.panelEl.style.left = "0";
                this.panelEl.style.top = "0";
                this.panelEl.style.width = "100vw";
                this.panelEl.style.height = "100vh";
                this.panelEl.style.transform = "none";
            } else {
                this._applyPosition(this.panelEl);
                this._applySize(this.panelEl);
            }
            setTimeout(() => this._fit(), 50);
        },
        _bringToFront() {
            // Find highest z-index among sibling panels (e.g. Holaf's), go above.
            let maxZ = 9998;
            document.querySelectorAll("body > div").forEach(el => {
                const z = parseInt(getComputedStyle(el).zIndex) || 0;
                if (el !== this.panelEl && z > maxZ) maxZ = z;
            });
            this.panelEl.style.zIndex = String(maxZ + 1);
        },

        // ── Drag ──────────────────────────────────────────────────────
        _makeDraggable(panel, handle) {
            let dragging = false, startX, startY, startLeft, startTop;
            handle.addEventListener("mousedown", (e) => {
                if (e.target.tagName === "BUTTON" || e.target.tagName === "SELECT") return;
                dragging = true;
                startX = e.clientX; startY = e.clientY;
                const rect = panel.getBoundingClientRect();
                startLeft = rect.left; startTop = rect.top;
                panel.style.transform = "none";
                e.preventDefault();
            });
            document.addEventListener("mousemove", (e) => {
                if (!dragging) return;
                const dx = e.clientX - startX, dy = e.clientY - startY;
                const newLeft = startLeft + dx, newTop = startTop + dy;
                panel.style.left = Math.max(0, newLeft) + "px";
                panel.style.top = Math.max(0, newTop) + "px";
            });
            document.addEventListener("mouseup", () => {
                if (!dragging) return;
                dragging = false;
                if (this.settings.panel_is_fullscreen) return;
                const rect = panel.getBoundingClientRect();
                saveSettings({ panel_x: Math.round(rect.left), panel_y: Math.round(rect.top) });
            });
        },

        // ── Resize ────────────────────────────────────────────────────
        _makeResizable(panel, handle) {
            let resizing = false, startX, startY, startW, startH;
            handle.addEventListener("mousedown", (e) => {
                if (this.settings.panel_is_fullscreen) return;
                resizing = true;
                startX = e.clientX; startY = e.clientY;
                startW = panel.offsetWidth; startH = panel.offsetHeight;
                e.preventDefault(); e.stopPropagation();
            });
            document.addEventListener("mousemove", (e) => {
                if (!resizing) return;
                const w = Math.max(400, startW + (e.clientX - startX));
                const h = Math.max(200, startH + (e.clientY - startY));
                panel.style.width = w + "px";
                panel.style.height = h + "px";
            });
            document.addEventListener("mouseup", () => {
                if (!resizing) return;
                resizing = false;
                if (this.settings.panel_is_fullscreen) return;
                saveSettings({
                    panel_width: panel.offsetWidth,
                    panel_height: panel.offsetHeight,
                });
                this._fit();
            });
        },

        // ── xterm + WebSocket ─────────────────────────────────────────
        _setStatus(text, connected) {
            if (this._statusText) {
                this._statusText.textContent = text;
                this._statusText.style.color = connected ? "#7f7" : "#888";
            }
            if (this._connectBtn) {
                this._connectBtn.textContent = connected ? "🔌 Disconnect" : "🔌 Connect";
                this._connectBtn.style.background = connected ? "#a33" : "#6366f1";
            }
        },

        _applyTheme() {
            if (!this.terminal) return;
            const theme = THEMES[this.settings.theme] || THEMES.dark;
            this.terminal.options.theme = theme;
            if (this.xtermContainer) this.xtermContainer.style.background = theme.background;
        },

        _fit() {
            try { if (this.fitAddon) this.fitAddon.fit(); } catch {}
        },

        async _connectIfNeeded() {
            // Lazy-init xterm + auto-connect
            if (!this.terminal) {
                try {
                    await ensureXtermLoaded();
                } catch (e) {
                    this._setStatus("xterm load failed", false);
                    console.error("[FR.IA Terminal]", e);
                    return;
                }
                this.terminal = new window.Terminal({
                    cursorBlink: true,
                    fontSize: this.settings.fontSize,
                    fontFamily: "monospace",
                    theme: THEMES[this.settings.theme] || THEMES.dark,
                    rows: 24,
                });
                this.fitAddon = new window.FitAddon.FitAddon();
                this.terminal.loadAddon(this.fitAddon);
                this.terminal.open(this.xtermContainer);
                setTimeout(() => this._fit(), 30);

                this.terminal.onData(data => {
                    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                        this.socket.send(data);
                    }
                });
                this.terminal.attachCustomKeyEventHandler(e => {
                    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && e.type === 'keydown') {
                        if (this.terminal.hasSelection()) {
                            try { navigator.clipboard.writeText(this.terminal.getSelection()); } catch {}
                            return false;
                        }
                    }
                    if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && e.type === 'keydown') {
                        try {
                            navigator.clipboard.readText().then(text => {
                                if (text && this.terminal) this.terminal.paste(text);
                            });
                        } catch {}
                        return false;
                    }
                    return true;
                });

                // Resize on window resize
                window.addEventListener("resize", () => this._fit());

                // Open WebSocket
                this._openSocket();
            } else if (!this.isConnected) {
                this._openSocket();
            } else {
                setTimeout(() => this._fit(), 30);
            }
        },

        _openSocket() {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
            this._setStatus("Connecting...", false);
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const url = `${protocol}//${window.location.host}/fr_ia/terminal`;
            this.socket = new WebSocket(url);
            this.socket.binaryType = "arraybuffer";

            this.socket.onopen = () => {
                this.isConnected = true;
                this._setStatus("Connected", true);
                requestAnimationFrame(() => {
                    this._fit();
                    if (this.terminal) this.terminal.focus();
                });
            };
            this.socket.onmessage = (event) => {
                if (!this.terminal) return;
                try {
                    if (event.data instanceof ArrayBuffer) {
                        this.terminal.write(new Uint8Array(event.data));
                    } else {
                        this.terminal.write(event.data);
                    }
                } catch (e) { console.warn("[FR.IA Terminal] write error:", e); }
            };
            this.socket.onclose = () => {
                this.isConnected = false;
                this._setStatus("Disconnected", false);
                if (this.terminal) {
                    try { this.terminal.writeln("\r\n--- CONNECTION CLOSED ---"); } catch {}
                }
            };
            this.socket.onerror = (e) => {
                console.error("[FR.IA Terminal] WebSocket error:", e);
                if (this.terminal) {
                    try { this.terminal.writeln("\r\n--- CONNECTION ERROR ---"); } catch {}
                }
            };
        },

        _disconnect() {
            try { if (this.socket) this.socket.close(); } catch {}
            this.socket = null;
            this.isConnected = false;
            this._setStatus("Disconnected", false);
        },

        _toggleConnection() {
            if (this.isConnected) this._disconnect();
            else this._openSocket();
        },
    };

    // ════════════════════════════════════════════════════════════════════
    //  Register
    // ════════════════════════════════════════════════════════════════════

    // Expose on window so the menu (fria_menu.js) can call it
    window.friaTerminal = friaTerminal;

    app.registerExtension({
        name: "FR.IA.Terminal.Panel",
        async setup() {
            console.log("[FR.IA Terminal] Panel ready. Access via FR.IA menu → 💻 Terminal.");
        },
    });
})();
