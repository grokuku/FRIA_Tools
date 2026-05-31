/**
 * FR.IA — Menu & Settings extension for ComfyUI.
 * Adds a [FR.IA] button to the menu bar with dropdown options.
 * Modales : draggable, ✕ pour fermer, pas de fermeture au clic extérieur.
 */

const STORAGE_KEY = "FRIA_config";

function getConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
}

function setConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ── Modale draggable (style FR.IA, pas de fermeture au clic extérieur) ──

function friaOpenModal(title, contentHtml, width) {
    // Pas d'overlay — la modale flotte au-dessus de ComfyUI sans bloquer les clics
    const modal = document.createElement("div");
    Object.assign(modal.style, {
        position: "fixed",
        background: "#2a2a2e",
        borderRadius: "12px",
        boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        width: (width || "440px"),
        maxHeight: "80vh",
        zIndex: "99999",
    });

    // Header draggable
    const header = document.createElement("div");
    Object.assign(header.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", cursor: "grab", userSelect: "none",
        borderBottom: "1px solid #444",
    });
    header.onmouseenter = () => header.style.cursor = "grab";
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    Object.assign(titleEl.style, { fontSize: "14px", fontWeight: "600", color: "#fff" });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, {
        background: "none", border: "none", color: "#999", cursor: "pointer",
        fontSize: "16px", padding: "0 4px",
    });
    closeBtn.onmouseenter = () => closeBtn.style.color = "#f87171";
    closeBtn.onmouseleave = () => closeBtn.style.color = "#999";
    closeBtn.onclick = () => { modal.remove(); };

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement("div");
    Object.assign(body.style, {
        padding: "16px", overflowY: "auto", maxHeight: "calc(80vh - 48px)",
    });
    if (typeof contentHtml === "string") {
        body.innerHTML = contentHtml;
    } else {
        body.appendChild(contentHtml);
    }

    modal.appendChild(header);
    modal.appendChild(body);
    document.body.appendChild(modal);

    // Center modal initially
    modal.style.left = Math.max(100, (window.innerWidth - parseInt(width || "440")) / 2) + "px";
    modal.style.top = Math.max(50, (window.innerHeight * 0.1)) + "px";

    // Drag logic
    const drag = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
    header.addEventListener("mousedown", (e) => {
        if (e.target === closeBtn) return;
        drag.active = true;
        const rect = modal.getBoundingClientRect();
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.origX = rect.left;
        drag.origY = rect.top;
        header.style.cursor = "grabbing";
        e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
        if (!drag.active) return;
        modal.style.left = (drag.origX + e.clientX - drag.startX) + "px";
        modal.style.top = (drag.origY + e.clientY - drag.startY) + "px";
    });
    document.addEventListener("mouseup", () => {
        if (drag.active) { drag.active = false; header.style.cursor = "grab"; }
    });

    return { modal, body, close: () => modal.remove() };
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
    const settingsButton = appInstance?.menu?.settingsGroup?.element;
    if (!settingsButton) {
        setTimeout(() => initMenu(appInstance), 300);
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.display = "inline-block";
    wrapper.style.margin = "0 4px";

    const btn = document.createElement("button");
    btn.textContent = "FR.IA ▾";
    Object.assign(btn.style, {
        background: "#6366f1", color: "white", border: "none",
        padding: "4px 12px", borderRadius: "6px", cursor: "pointer",
        fontSize: "13px", fontWeight: "600",
    });

    const dd = document.createElement("div");
    dd.id = "fria-dropdown-menu";
    dd.style.display = "none";
    dd.style.zIndex = "10005";
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
    dd.appendChild(mkItem("Membres", "👥", () => openMembers()));
    dd.appendChild(mkItem("Paramètres", "⚙️", () => openSettings()));

    // Statut serveur
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

    btn.onclick = (e) => {
        e.stopPropagation();
        const opening = dd.style.display !== "block";
        dd.style.display = opening ? "block" : "none";
        if (opening) checkServerStatus(statusDiv);
    };

    document.addEventListener("click", (e) => {
        if (dd.style.display === "block" && !wrapper.contains(e.target)) {
            dd.style.display = "none";
        }
    });

    settingsButton.parentNode.insertBefore(wrapper, settingsButton);
    console.log("[FR.IA] Menu initialized");
}

// ── Membres ──────────────────────────────────────────────────────────

async function openMembers() {
    const cfg = getConfig();
    const baseUrl = (cfg.serverUrl || "https://kw.holaf.fr").replace(/\/+$/, "");
    const apiKey = cfg.apiKey || "";

    const modal = friaOpenModal("👥 Membres", "<p style='color:#888;font-size:12px;'>Chargement...</p>", "560px");

    try {
        const headers = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        const resp = await fetch(`${baseUrl}/api/members`, { method: "GET", headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const members = await resp.json();

        // Trier : admin en premier, puis par nom
        members.sort((a, b) => {
            if (a.role === "admin" && b.role !== "admin") return -1;
            if (a.role !== "admin" && b.role === "admin") return 1;
            return (a.display_name || a.username || "").localeCompare(b.display_name || b.username || "");
        });

        let html = `<table style="width:100%;border-collapse:collapse;font-size:12px;color:#ccc;">
            <thead>
                <tr style="border-bottom:1px solid #555;">
                    <th style="text-align:left;padding:6px 8px;color:#888;font-weight:600;">Membre</th>
                    <th style="text-align:center;padding:6px 4px;color:#888;font-weight:600;">Rôle</th>
                    <th style="text-align:center;padding:6px 4px;color:#888;font-weight:600;">Filtres</th>
                    <th style="text-align:center;padding:6px 4px;color:#888;font-weight:600;">Prompts</th>
                </tr>
            </thead><tbody>`;

        for (const m of members) {
            const name = m.display_name || m.username || m.id?.substring(0, 8) || "?";
            const avatarUrl = m.avatar_url || (m.avatar && m.id ? `https://cdn.discordapp.com/avatars/${m.id}/${m.avatar}.png?size=32` : null);
            const roleBadge = m.role === "admin"
                ? '<span style="background:#6366f1;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">admin</span>'
                : '<span style="color:#888;font-size:11px;">membre</span>';

            html += `<tr style="border-bottom:1px solid #333;">
                <td style="padding:6px 8px;display:flex;align-items:center;gap:8px;">
                    ${avatarUrl ? `<img src="${avatarUrl}" style="width:24px;height:24px;border-radius:50;flex-shrink:0;">` : '<span style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;background:#444;border-radius:50%;font-size:11px;flex-shrink:0;">👤</span>'}
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                </td>
                <td style="text-align:center;padding:6px 4px;">${roleBadge}</td>
                <td style="text-align:center;padding:6px 4px;">${m.filter_count ?? 0}</td>
                <td style="text-align:center;padding:6px 4px;">${m.prompt_count ?? 0}</td>
            </tr>`;
        }

        html += "</tbody></table>";
        modal.body.innerHTML = html;
    } catch (err) {
        modal.body.innerHTML = `<p style="color:#f87171;font-size:12px;">Erreur : ${err.message}</p>`;
    }
}

// ── Statut serveur ────────────────────────────────────────────────────

async function checkServerStatus(el) {
    const cfg = getConfig();
    const baseUrl = (cfg.serverUrl || "https://kw.holaf.fr").replace(/\/+$/, "");
    const apiKey = cfg.apiKey || "";
    try {
        const headers = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const [statsResp, meResp] = await Promise.all([
            fetch(`${baseUrl}/api/stats`, { method: "GET", headers, signal: AbortSignal.timeout(5000) }).catch(() => null),
            fetch(`${baseUrl}/api/auth/me`, { method: "GET", headers, signal: AbortSignal.timeout(5000) }).catch(() => null),
        ]);

        const serverOk = statsResp && statsResp.ok;
        let user = null;
        if (meResp && meResp.ok) {
            try { user = await meResp.json(); } catch {}
        }

        el.innerHTML = "";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.gap = "6px";

        if (user && (user.display_name || user.username)) {
            const name = user.display_name || user.username || "?";
            const avatarUrl = user.avatar_url || (user.avatar && user.id ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null);

            const dot = document.createElement("span");
            dot.textContent = "🟢";
            dot.style.cssText = "font-size:11px;line-height:1;flex-shrink:0;";
            el.appendChild(dot);

            const nameSpan = document.createElement("span");
            nameSpan.textContent = name;
            nameSpan.style.cssText = "flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
            el.appendChild(nameSpan);

            if (avatarUrl) {
                const img = document.createElement("img");
                img.src = avatarUrl;
                img.style.cssText = "width:22px;height:22px;border-radius:50%;flex-shrink:0;";
                el.appendChild(img);
            }

            el.style.color = "#4ade80";
        } else if (serverOk) {
            el.textContent = "🟢  Serveur en ligne (non connecté)";
            el.style.color = "#4ade80";
        } else if (statsResp) {
            el.textContent = "🟡  Serveur répond (HTTP " + statsResp.status + ")";
            el.style.color = "#facc15";
        } else {
            el.textContent = "🔴  Serveur hors ligne";
            el.style.color = "#f87171";
        }
    } catch {
        el.textContent = "🔴  Serveur hors ligne";
        el.style.color = "#f87171";
    }
}

// ── Paramètres ────────────────────────────────────────────────────────

function openSettings() {
    const cfg = getConfig();

    const content = document.createElement("div");

    const title = document.createElement("h2");
    title.textContent = "⚙️ Paramètres FR.IA";
    Object.assign(title.style, { margin: "0 0 16px", fontSize: "16px", color: "#fff" });
    content.appendChild(title);

    const lbl1 = document.createElement("label");
    lbl1.textContent = "URL du serveur";
    Object.assign(lbl1.style, { display: "block", marginBottom: "4px", fontSize: "12px", color: "#aaa" });
    content.appendChild(lbl1);

    const inputUrl = document.createElement("input");
    inputUrl.type = "url";
    inputUrl.value = cfg.serverUrl || "https://kw.holaf.fr";
    Object.assign(inputUrl.style, { width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #555", background: "#1a1a1e", color: "#fff", fontSize: "13px", marginBottom: "16px", boxSizing: "border-box" });
    content.appendChild(inputUrl);

    const lbl2 = document.createElement("label");
    lbl2.textContent = "Clé API";
    Object.assign(lbl2.style, { display: "block", marginBottom: "4px", fontSize: "12px", color: "#aaa" });
    content.appendChild(lbl2);

    const inputKey = document.createElement("input");
    inputKey.type = "password";
    inputKey.value = cfg.apiKey || "";
    Object.assign(inputKey.style, { width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #555", background: "#1a1a1e", color: "#fff", fontSize: "13px", marginBottom: "4px", boxSizing: "border-box" });
    content.appendChild(inputKey);

    const hint = document.createElement("p");
    hint.textContent = "Générez votre clé sur le site web → Settings → Clé API";
    Object.assign(hint.style, { margin: "0 0 16px", fontSize: "11px", color: "#888" });
    content.appendChild(hint);

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Annuler";
    Object.assign(cancelBtn.style, { padding: "8px 16px", borderRadius: "6px", border: "1px solid #555", background: "transparent", color: "#ccc", cursor: "pointer", fontSize: "13px" });
    btnRow.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Sauvegarder";
    Object.assign(saveBtn.style, { padding: "8px 16px", borderRadius: "6px", border: "none", background: "#6366f1", color: "white", cursor: "pointer", fontSize: "13px", fontWeight: "600" });
    btnRow.appendChild(saveBtn);
    content.appendChild(btnRow);

    const modalRef = friaOpenModal("", content, "420px");
    // Cacher le titre par défaut car on a notre propre h2
    const titleSpan = modalRef.modal.querySelector("div:first-child span");
    if (titleSpan) titleSpan.style.display = "none";

    cancelBtn.onclick = () => modalRef.close();
    saveBtn.onclick = () => {
        setConfig({
            serverUrl: inputUrl.value.trim(),
            apiKey: inputKey.value.trim(),
        });
        modalRef.close();
    };
}