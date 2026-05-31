/**
 * FR.IA — Menu & Settings extension for ComfyUI.
 * Adds a [FR.IA] button to the menu bar with dropdown options.
 * Pattern inspiré de Holaf Utilities (CUI-Holaf-Utils).
 */

const STORAGE_KEY = "FRIA_config";

function getConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
}

function setConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// Wait for ComfyUI app to be available
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) {
        setTimeout(waitForApp, 100);
        return;
    }

    app.registerExtension({
        name: "FR.IA.Menu",
        async setup() {
            setTimeout(() => initMenu(app), 50);
        }
    });
})();

function initMenu(appInstance) {
    // Référence : CUI-Holaf-Utils cherche settingsButton dans app.menu
    const settingsButton = appInstance?.menu?.settingsGroup?.element;
    if (!settingsButton) {
        setTimeout(() => initMenu(appInstance), 300);
        return;
    }

    // Wrapper contenant le bouton + dropdown
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.display = "inline-block";
    wrapper.style.margin = "0 4px";

    // Bouton principal
    const btn = document.createElement("button");
    btn.textContent = "FR.IA ▾";
    Object.assign(btn.style, {
        background: "#6366f1", color: "white", border: "none",
        padding: "4px 12px", borderRadius: "6px", cursor: "pointer",
        fontSize: "13px", fontWeight: "600",
    });

    // Dropdown menu
    const dd = document.createElement("div");
    dd.id = "fria-dropdown-menu";
    dd.style.display = "none";
    dd.style.zIndex = "10005";

    // Appliquer le style du dropdown via une classe ou en inline
    Object.assign(dd.style, {
        position: "absolute", top: "100%", left: "0",
        background: "#2a2a2e", border: "1px solid #444", borderRadius: "8px",
        minWidth: "200px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    });

    const mkItem = (txt, icon, cb) => {
        const el = document.createElement("div");
        el.textContent = `${icon}  ${txt}`;
        Object.assign(el.style, {
            padding: "10px 16px", cursor: "pointer", fontSize: "13px",
            borderBottom: "1px solid #444",
        });
        el.onmouseenter = () => el.style.background = "#3a3a3e";
        el.onmouseleave = () => el.style.background = "";
        el.onclick = () => { cb(); dd.style.display = "none"; };
        return el;
    };

    dd.appendChild(mkItem("Open Webpage", "🌐", () => {
        const cfg = getConfig();
        window.open(cfg.serverUrl || "https://kw.holaf.fr", "_blank");
    }));

    const paramsItem = mkItem("Paramètres", "⚙️", () => openSettings());
    paramsItem.style.borderBottom = "none";
    dd.appendChild(paramsItem);

    // Statut serveur (séparateur + indicateur)
    const statusDiv = document.createElement("div");
    statusDiv.id = "fria-server-status";
    Object.assign(statusDiv.style, {
        padding: "8px 16px", fontSize: "11px", color: "#888",
        borderTop: "1px solid #444", cursor: "default",
    });
    statusDiv.textContent = "Statut : vérification...";
    dd.appendChild(statusDiv);

    wrapper.appendChild(btn);
    wrapper.appendChild(dd);

    // Toggle dropdown + vérifier le statut du serveur
    btn.onclick = (e) => {
        e.stopPropagation();
        const opening = dd.style.display !== "block";
        dd.style.display = opening ? "block" : "none";
        if (opening) checkServerStatus(statusDiv);
    };

    // Fermer au clic ailleurs
    document.addEventListener("click", (e) => {
        if (dd.style.display === "block" && !wrapper.contains(e.target)) {
            dd.style.display = "none";
        }
    });

    // Insérer avant le bouton Settings (comme la référence)
    settingsButton.parentNode.insertBefore(wrapper, settingsButton);
    console.log("[FR.IA] Menu initialized");
}

async function checkServerStatus(el) {
    const cfg = getConfig();
    const baseUrl = (cfg.serverUrl || "https://kw.holaf.fr").replace(/\/+$/, "");
    try {
        const resp = await fetch(`${baseUrl}/api/stats`, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
            el.textContent = "🟢  Serveur en ligne";
            el.style.color = "#4ade80";
        } else {
            el.textContent = "🟡  Serveur répond (HTTP " + resp.status + ")";
            el.style.color = "#facc15";
        }
    } catch {
        el.textContent = "🔴  Serveur hors ligne";
        el.style.color = "#f87171";
    }
}

function openSettings() {
    const cfg = getConfig();

    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "99999",
        background: "rgba(0,0,0,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
    });

    const modal = document.createElement("div");
    Object.assign(modal.style, {
        background: "#2a2a2e", borderRadius: "12px", padding: "24px",
        width: "420px", boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
    });

    modal.innerHTML = `
        <h2 style="margin:0 0 16px; font-size:16px; color:#fff;">⚙️ Paramètres FR.IA</h2>

        <label style="display:block; margin-bottom:4px; font-size:12px; color:#aaa;">URL du serveur</label>
        <input id="fria-url" type="url" value="${cfg.serverUrl || 'https://kw.holaf.fr'}"
               style="width:100%; padding:8px 12px; border-radius:6px; border:1px solid #555;
                      background:#1a1a1e; color:#fff; font-size:13px; margin-bottom:16px; box-sizing:border-box;">

        <label style="display:block; margin-bottom:4px; font-size:12px; color:#aaa;">Clé API</label>
        <input id="fria-key" type="password" value="${cfg.apiKey || ''}"
               style="width:100%; padding:8px 12px; border-radius:6px; border:1px solid #555;
                      background:#1a1a1e; color:#fff; font-size:13px; margin-bottom:4px; box-sizing:border-box;">
        <p style="margin:0 0 16px; font-size:11px; color:#888;">
            Générez votre clé sur le site web → Settings → Clé API
        </p>

        <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button id="fria-cancel" style="padding:8px 16px; border-radius:6px; border:1px solid #555;
                   background:transparent; color:#ccc; cursor:pointer; font-size:13px;">Annuler</button>
            <button id="fria-save" style="padding:8px 16px; border-radius:6px; border:none;
                   background:#6366f1; color:white; cursor:pointer; font-size:13px; font-weight:600;">Sauvegarder</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("fria-cancel").onclick = () => overlay.remove();
    document.getElementById("fria-save").onclick = () => {
        setConfig({
            serverUrl: document.getElementById("fria-url").value.trim(),
            apiKey: document.getElementById("fria-key").value.trim(),
        });
        overlay.remove();
    };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}
