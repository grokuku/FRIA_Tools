/**
 * FR.IA Workflow Sharing — Partager, parcourir et installer des workflows ComfyUI.
 *
 * Fonctionnalités :
 *   - 📤 Partager : envoie le workflow actuel avec dépendances auto-détectées
 *   - 🌐 Parcourir : liste paginée des workflows publics
 *   - 📥 Installer : tableau de validation des dépendances avant chargement
 *
 * Dépendances :
 *   - fria_menu.js (pour les helpers getConfig, setConfig, friaOpenModal)
 *   - API FR.IA (kw.holaf.fr)
 *
 * Les fonctions sont attachées à window pour être appelables depuis fria_menu.js.
 */

(function waitForApp() {
  var app = window.app || window.comfyAPI?.app?.app;
  if (!app) { setTimeout(waitForApp, 200); return; }

  // ── Helpers ──

  function getApp() {
    return window.app || window.comfyAPI?.app?.app;
  }

  function getApiUrl() {
    try {
      const cfg = JSON.parse(localStorage.getItem("FRIA_config") || "{}");
      return (cfg.serverUrl || "https://kw.holaf.fr").replace(/\/+$/, "") + "/api";
    } catch { return "https://kw.holaf.fr/api"; }
  }

  function getApiKey() {
    try { return JSON.parse(localStorage.getItem("FRIA_config") || "{}").apiKey || ""; }
    catch { return ""; }
  }

  function apiHeaders() {
    const h = { "Content-Type": "application/json" };
    const key = getApiKey();
    if (key) h["Authorization"] = "Bearer " + key;
    return h;
  }

  // ── Types ComfyUI natifs (pas des custom nodes) ──

  const STANDARD_TYPES = new Set([
    "CheckpointLoaderSimple", "CLIPTextEncode", "CLIPSetLastLayer",
    "KSampler", "KSamplerAdvanced", "VAELoader", "VAEDecode", "VAEEncode",
    "LoraLoader", "EmptyLatentImage", "SaveImage", "PreviewImage",
    "LoadImage", "CLIPVisionEncode", "ControlNetLoader",
    "GLIGENLoader", "UpscaleModelLoader", "unCLIPCheckpointLoader",
    "CLIPLoader", "DualCLIPLoader", "UNETLoader", "VAEDecode",
    "ImageUpscaleWithModel", "ImageScale", "ImageScaleToTotalPixels",
    "LatentUpscale", "LatentDecode", "LatentFromBatch",
    "CheckpointSave", "PromptBlob", "Reroute", "Note",
    "PrimitiveNode", "WorkflowRestorer",
  ]);

  // ── Détection des dépendances ──

  function detectDependencies(workflowJSON) {
    const nodes = workflowJSON?.nodes || [];
    const deps = { nodes: [], models: [], loras: [] };
    const seen = { nodes: new Set(), models: new Set(), loras: new Set() };

    for (const node of nodes) {
      const type = node.type || "";
      const widgets = node.widgets_values || [];

      // Custom nodes
      if (!STANDARD_TYPES.has(type) && !type.startsWith("_") && !seen.nodes.has(type)) {
        seen.nodes.add(type);
        deps.nodes.push({ name: type, url: "" });
      }

      // Checkpoints
      if (type === "CheckpointLoaderSimple" && widgets[0] && !seen.models.has(widgets[0])) {
        seen.models.add(widgets[0]);
        deps.models.push({ name: widgets[0], type: "checkpoint" });
      }

      // LoRAs
      if (type === "LoraLoader" && widgets[0] && !seen.loras.has(widgets[0])) {
        seen.loras.add(widgets[0]);
        deps.loras.push({ name: widgets[0] });
      }
    }

    return deps;
  }

  // ── Partager le workflow ──

  window.openWorkflowShare = function () {
    if (typeof friaOpenModal !== 'function') {
      alert("FR.IA Menu pas encore chargé. Rafraîchis la page.");
      return;
    }
    const modal = friaOpenModal("📤 Partager le workflow", "", "520px");
    const body = modal.querySelector("div:last-child");

    // Récupérer le workflow actif
    let workflowJSON = null;
    let workflowStr = "";
    try {
      var currentApp = getApp();
      if (currentApp?.graph) {
        const data = currentApp.graph.serialize();
        workflowJSON = data;
        workflowStr = JSON.stringify(data, null, 2);
      }
    } catch (e) {
      workflowStr = "";
    }

    if (!workflowStr) {
      body.innerHTML =
        '<p style="color:#f87171;font-size:13px;">Impossible de lire le workflow actif.</p>';
      return;
    }

    // Détection des dépendances
    const deps = workflowJSON ? detectDependencies(workflowJSON) : { nodes: [], models: [], loras: [] };

    // Vérifier si un workflow du même nom existe déjà (pour update)
    let existingId = null;

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <label style="font-size:11px;color:#888;display:block;margin-bottom:3px;">Nom du workflow *</label>
          <input id="wf-share-name" type="text" value="${escapeHtml(workflowJSON?.extra?.title || workflowJSON?.title || workflowJSON?.name || '')}"
                 style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#888;display:block;margin-bottom:3px;">Description</label>
          <textarea id="wf-share-desc" rows="3"
                    style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:12px;box-sizing:border-box;resize:vertical;">${escapeHtml('')}</textarea>
        </div>
        <div>
          <label style="font-size:11px;color:#888;display:block;margin-bottom:3px;">Tags (séparés par des virgules)</label>
          <input id="wf-share-tags" type="text" value="${escapeHtml('')}"
                 style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:13px;box-sizing:border-box;">
        </div>
        <div style="border-top:1px solid #444;padding-top:8px;">
          <p style="font-size:11px;color:#888;margin:0 0 6px 0;">🔍 Dépendances détectées :</p>
          <div id="wf-share-deps" style="font-size:12px;color:#bbb;"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button id="wf-share-publish-btn"
                  style="flex:1;padding:8px;border:none;border-radius:6px;background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">📤 Publier</button>
          <button id="wf-share-update-btn" style="display:none;flex:1;padding:8px;border:none;border-radius:6px;background:#f59e0b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">🔄 Mettre à jour</button>
          <button onclick="this.closest('[id^=fria-modal]')?.remove()"
                  style="padding:8px 16px;border:1px solid #555;border-radius:6px;background:transparent;color:#999;font-size:13px;cursor:pointer;">Annuler</button>
        </div>
        <div id="wf-share-status" style="font-size:11px;color:#888;display:none;"></div>
      </div>
    `;

    // Remplir les dépendances
    const depsEl = body.querySelector("#wf-share-deps");
    if (deps.nodes.length === 0 && deps.models.length === 0 && deps.loras.length === 0) {
      depsEl.innerHTML = '<span style="color:#34d399;">✓ Aucune dépendance externe détectée</span>';
    } else {
      let html = "";
      if (deps.nodes.length) {
        html += `<div style="margin-bottom:4px;"><span style="color:#f59e0b;">📦 Custom nodes</span>`;
        deps.nodes.forEach(n => { html += `<div style="margin-left:12px;color:#ccc;">· ${escapeHtml(n.name)}</div>`; });
        html += `</div>`;
      }
      if (deps.models.length) {
        html += `<div style="margin-bottom:4px;"><span style="color:#60a5fa;">🧠 Modèles</span>`;
        deps.models.forEach(m => { html += `<div style="margin-left:12px;color:#ccc;">· ${escapeHtml(m.name)}</div>`; });
        html += `</div>`;
      }
      if (deps.loras.length) {
        html += `<div style="margin-bottom:4px;"><span style="color:#a78bfa;">🎨 LoRAs</span>`;
        deps.loras.forEach(l => { html += `<div style="margin-left:12px;color:#ccc;">· ${escapeHtml(l.name)}</div>`; });
        html += `</div>`;
      }
      depsEl.innerHTML = html;
    }

    // Vérifier si un workflow du même nom existe déjà (pour proposer update)
    async function checkExisting(name) {
      try {
        const r = await fetch(getApiUrl() + "/workflows?q=" + encodeURIComponent(name) + "&limit=5", { headers: apiHeaders() });
        if (!r.ok) return null;
        const data = await r.json();
        const items = data?.items || [];
        const authR = await fetch(getApiUrl() + "/auth/me", { headers: apiHeaders() });
        const me = authR.ok ? await authR.json() : null;
        if (!me || typeof me.id !== 'string') return null;
        const match = items.find(i => i.name.toLowerCase() === name.toLowerCase() && i.user_id === me.id);
        return match?.id || null;
      } catch { return null; }
    }

    body.querySelector("#wf-share-name").addEventListener("input", async function () {
      const name = this.value.trim();
      if (!name) return;
      existingId = await checkExisting(name);
      const publishBtn = body.querySelector("#wf-share-publish-btn");
      const updateBtn = body.querySelector("#wf-share-update-btn");
      if (existingId) {
        publishBtn.style.display = "none";
        updateBtn.style.display = "block";
      } else {
        publishBtn.style.display = "block";
        updateBtn.style.display = "none";
      }
    });

    body.querySelector("#wf-share-publish-btn").onclick = async function () {
      await _doPublish(modal, body, false);
    };
    body.querySelector("#wf-share-update-btn").onclick = async function () {
      await _doPublish(modal, body, true);
    };

    async function _doPublish(modalEl, bodyEl, isUpdate) {
      const name = bodyEl.querySelector("#wf-share-name").value.trim();
      const desc = bodyEl.querySelector("#wf-share-desc").value.trim();
      const tags = bodyEl.querySelector("#wf-share-tags").value.trim();
      const statusEl = bodyEl.querySelector("#wf-share-status");

      if (!name) {
        statusEl.style.display = "block";
        statusEl.style.color = "#f87171";
        statusEl.textContent = "Le nom est requis.";
        return;
      }

      const payload = {
        name,
        description: desc,
        tags,
        workflow_json: workflowStr,
        required_nodes: deps.nodes,
        required_models: deps.models,
        required_loras: deps.loras,
      };
      if (isUpdate && existingId) payload.existing_id = existingId;

      statusEl.style.display = "block";
      statusEl.style.color = "#fbbf24";
      statusEl.textContent = "Publication en cours...";

      try {
        const r = await fetch(getApiUrl() + "/workflows", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Erreur " + r.status);

        statusEl.style.color = "#34d399";
        statusEl.textContent = isUpdate
          ? "✅ Workflow mis à jour (v+" + (data.version || "") + ") !"
          : "✅ Workflow publié ! ID: " + data.id;
        setTimeout(() => modalEl?.remove(), 2000);
      } catch (e) {
        statusEl.style.color = "#f87171";
        statusEl.textContent = "❌ Erreur : " + e.message;
      }
    }
  };

  // ── Parcourir les workflows ──

  window.openWorkflowBrowse = function () {
    if (typeof friaOpenModal !== 'function') {
      alert("FR.IA Menu pas encore chargé. Rafraîchis la page.");
      return;
    }
    const modal = friaOpenModal("🌐 Parcourir les workflows", "", "700px");
    const body = modal.querySelector("div:last-child");

    let currentPage = 1;
    let currentQuery = "";
    let currentSort = "downloads";

    function render() {
      const q = encodeURIComponent(currentQuery);
      const sort = encodeURIComponent(currentSort);
      const url = getApiUrl() + "/workflows?q=" + q + "&sort=" + sort + "&page=" + currentPage + "&limit=20";

      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px;min-height:300px;">
          <div style="display:flex;gap:8px;">
            <input id="wf-search-input" type="text" placeholder="🔍 Rechercher..." value="${escapeHtml(currentQuery)}"
                   style="flex:1;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:13px;">
            <select id="wf-sort-select"
                    style="padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:12px;">
              <option value="downloads" ${currentSort === 'downloads' ? 'selected' : ''}>📥 Téléchargements</option>
              <option value="likes" ${currentSort === 'likes' ? 'selected' : ''}>❤️ Likes</option>
              <option value="created_at" ${currentSort === 'created_at' ? 'selected' : ''}>📅 Date</option>
            </select>
          </div>
          <div id="wf-results" style="flex:1;">
            <p style="color:#888;font-size:13px;text-align:center;padding:40px 0;">Chargement...</p>
          </div>
          <div id="wf-pagination" style="display:flex;justify-content:center;gap:8px;"></div>
        </div>
      `;

      body.querySelector("#wf-search-input").addEventListener("input", () => {
        clearTimeout(window._wfSearchTimer);
        window._wfSearchTimer = setTimeout(() => {
          currentQuery = body.querySelector("#wf-search-input").value.trim();
          currentPage = 1;
          render();
        }, 300);
      });

      body.querySelector("#wf-sort-select").addEventListener("change", () => {
        currentSort = body.querySelector("#wf-sort-select").value;
        currentPage = 1;
        render();
      });

      fetch(url, { headers: apiHeaders() })
        .then(r => r.json())
        .then(data => {
          const items = data?.items || [];
          const total = data?.total || 0;
          const pages = Math.ceil(total / 20);
          const resultsEl = body.querySelector("#wf-results");

          if (items.length === 0) {
            resultsEl.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:40px 0;">Aucun workflow trouvé.</p>';
            return;
          }

          resultsEl.innerHTML = items.map(w => {
            const author = w.author || w.user_id || "?";
            const tags = Array.isArray(w.tags) ? w.tags.join(", ") : "";
            const depsCount = (w.required_nodes?.length || 0) + (w.required_models?.length || 0) + (w.required_loras?.length || 0);
            return `
              <div class="wf-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #444;border-radius:8px;margin-bottom:6px;cursor:pointer;background:#3a3a3e;"
                   onclick="window._wfOpenDetail(${w.id})">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(w.name)}</div>
                  <div style="font-size:11px;color:#888;">
                    par ${escapeHtml(author)}
                    ${depsCount > 0 ? " · " + depsCount + " dépendances" : ""}
                    ${tags ? " · " + escapeHtml(tags) : ""}
                  </div>
                </div>
                <div style="text-align:right;font-size:11px;color:#888;white-space:nowrap;">
                  <span title="Likes">❤️ ${w.likes || 0}</span>
                  <span title="Downloads" style="margin-left:6px;">📥 ${w.downloads || 0}</span>
                  <span style="margin-left:6px;color:#666;">v${w.version || 1}</span>
                </div>
              </div>
            `;
          }).join("");

          // Pagination
          const pagEl = body.querySelector("#wf-pagination");
          if (pages > 1) {
            let pagHtml = "";
            if (currentPage > 1) pagHtml += `<button onclick="window._wfGoPage(${currentPage - 1})" style="padding:4px 10px;border:1px solid #555;border-radius:4px;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:12px;">←</button>`;
            pagHtml += `<span style="font-size:12px;color:#888;padding:4px 8px;">${currentPage} / ${pages}</span>`;
            if (currentPage < pages) pagHtml += `<button onclick="window._wfGoPage(${currentPage + 1})" style="padding:4px 10px;border:1px solid #555;border-radius:4px;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:12px;">→</button>`;
            pagEl.innerHTML = pagHtml;
          }
        })
        .catch(() => {
          const resultsEl = body.querySelector("#wf-results");
          resultsEl.innerHTML = '<p style="color:#f87171;font-size:13px;text-align:center;padding:40px 0;">Erreur de chargement.</p>';
        });
    }

    window._wfGoPage = function (page) {
      currentPage = page;
      render();
    };

    window._wfOpenDetail = function (id) {
      _openDetailModal(id, modal);
    };

    render();
  };

  // ── Détail + Installation ──

  function _openDetailModal(workflowId, parentModal) {
    if (typeof friaOpenModal !== 'function') {
      alert("FR.IA Menu pas encore chargé. Rafraîchis la page.");
      return;
    }
    const detailModal = friaOpenModal("📥 Workflow", "", "580px");
    const body = detailModal.querySelector("div:last-child");
    body.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:40px 0;">Chargement...</p>';

    // Fetch workflow detail
    fetch(getApiUrl() + "/workflows/" + workflowId, { headers: apiHeaders() })
      .then(r => r.json())
      .then(w => {
        let html = `
          <div style="margin-bottom:12px;">
            <h2 style="font-size:16px;font-weight:700;color:#e2e8f0;margin:0 0 4px 0;">${escapeHtml(w.name)}</h2>
            <p style="font-size:12px;color:#888;margin:0;">
              par ${escapeHtml(w.author || w.user_id)} · v${w.version || 1}
              · ❤️ ${w.likes || 0} · 📥 ${w.downloads || 0}
            </p>
            ${w.description ? `<p style="font-size:12px;color:#aaa;margin:8px 0 0 0;">${escapeHtml(w.description)}</p>` : ''}
          </div>
          <div id="wf-install-deps" style="margin-bottom:12px;"></div>
          <div style="display:flex;gap:8px;">
            <button id="wf-load-btn"
                    style="flex:1;padding:10px;border:none;border-radius:6px;background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">📥 Charger le workflow</button>
            <button onclick="this.closest('[id^=fria-modal]')?.remove()"
                    style="padding:10px 16px;border:1px solid #555;border-radius:6px;background:transparent;color:#999;font-size:13px;cursor:pointer;">Fermer</button>
          </div>
          <div id="wf-load-status" style="font-size:11px;color:#888;display:none;margin-top:8px;"></div>
        `;
        body.innerHTML = html;

        // Installer les dépendances
        const deps = {
          nodes: w.required_nodes || [],
          models: w.required_models || [],
          loras: w.required_loras || [],
        };
        const totalDeps = deps.nodes.length + deps.models.length + deps.loras.length;
        const depsEl = body.querySelector("#wf-install-deps");

        if (totalDeps === 0) {
          depsEl.innerHTML = '<p style="font-size:12px;color:#34d399;">✓ Aucune dépendance externe</p>';
        } else {
          let depHtml = '<p style="font-size:12px;color:#fbbf24;margin:0 0 8px 0;">⚠️ Ce workflow nécessite des dépendances :</p>';

          depHtml += '<div style="border:1px solid #444;border-radius:6px;overflow:hidden;">';

          if (deps.nodes.length) {
            depHtml += '<div style="background:#3a3a3e;padding:6px 10px;border-bottom:1px solid #444;">';
            depHtml += '<span style="font-size:11px;color:#f59e0b;font-weight:600;">📦 Custom nodes</span></div>';
            deps.nodes.forEach(n => {
              depHtml += `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #3a3a3e;cursor:pointer;font-size:12px;color:#ccc;">
                  <input type="checkbox" class="wf-dep-check" checked data-type="node" data-name="${escapeHtml(n.name)}" style="accent-color:#6366f1;">
                  <span style="flex:1;">${escapeHtml(n.name)}</span>
                  ${n.url ? `<a href="${escapeHtml(n.url)}" target="_blank" style="color:#60a5fa;text-decoration:none;font-size:11px;" onclick="event.stopPropagation();">🔗</a>` : ''}
                </label>
              `;
            });
          }

          if (deps.models.length) {
            if (deps.nodes.length) depHtml += '<div style="border-top:1px solid #444;"></div>';
            depHtml += '<div style="background:#3a3a3e;padding:6px 10px;border-bottom:1px solid #444;">';
            depHtml += '<span style="font-size:11px;color:#60a5fa;font-weight:600;">🧠 Modèles</span></div>';
            deps.models.forEach(m => {
              depHtml += `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #3a3a3e;cursor:pointer;font-size:12px;color:#ccc;">
                  <input type="checkbox" class="wf-dep-check" checked data-type="model" data-name="${escapeHtml(m.name)}" style="accent-color:#6366f1;">
                  <span style="flex:1;">${escapeHtml(m.name)}</span>
                  <span style="font-size:10px;color:#666;">${m.type || 'modèle'}</span>
                </label>
              `;
            });
          }

          if (deps.loras.length) {
            if (deps.nodes.length || deps.models.length) depHtml += '<div style="border-top:1px solid #444;"></div>';
            depHtml += '<div style="background:#3a3a3e;padding:6px 10px;border-bottom:1px solid #444;">';
            depHtml += '<span style="font-size:11px;color:#a78bfa;font-weight:600;">🎨 LoRAs</span></div>';
            deps.loras.forEach(l => {
              depHtml += `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #3a3a3e;cursor:pointer;font-size:12px;color:#ccc;">
                  <input type="checkbox" class="wf-dep-check" checked data-type="lora" data-name="${escapeHtml(l.name)}" style="accent-color:#6366f1;">
                  <span style="flex:1;">${escapeHtml(l.name)}</span>
                </label>
              `;
            });
          }

          depHtml += '</div>';
          depsEl.innerHTML = depHtml;
        }

        // Bouton Load
        body.querySelector("#wf-load-btn").onclick = async function () {
          const statusEl = body.querySelector("#wf-load-status");
          statusEl.style.display = "block";
          statusEl.style.color = "#fbbf24";
          statusEl.textContent = "Téléchargement en cours...";

          try {
            const r = await fetch(getApiUrl() + "/workflows/" + workflowId + "/download", {
              headers: apiHeaders(),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Erreur " + r.status); }
            const data = await r.json();
            const wfJson = data.workflow_json;

            statusEl.textContent = "Chargement dans ComfyUI...";

            // Parse and load
            try {
              const parsed = JSON.parse(wfJson);
              if (window.app?.loadGraphData) {
                await app.loadGraphData(parsed);
                statusEl.style.color = "#34d399";
                statusEl.textContent = "✅ Workflow chargé !";
                setTimeout(() => { detailModal?.remove(); if (parentModal) parentModal.remove(); }, 1500);
              } else if (window.app?.graph) {
                window.app.graph.clear();
                window.app.loadGraphData(parsed);
                statusEl.style.color = "#34d399";
                statusEl.textContent = "✅ Workflow chargé !";
                setTimeout(() => { detailModal?.remove(); if (parentModal) parentModal.remove(); }, 1500);
              } else {
                // Fallback : copier dans le presse-papier
                navigator.clipboard.writeText(wfJson).then(() => {
                  statusEl.style.color = "#fbbf24";
                  statusEl.textContent = "⚠️ Copié dans le presse-papier. Colle-le sur le canvas.";
                }).catch(() => {
                  statusEl.style.color = "#f87171";
                  statusEl.textContent = "❌ Impossible de charger automatiquement.";
                });
              }
            } catch (e) {
              statusEl.style.color = "#f87171";
              statusEl.textContent = "❌ JSON invalide : " + e.message;
            }
          } catch (e) {
            statusEl.style.color = "#f87171";
            statusEl.textContent = "❌ Erreur : " + e.message;
          }
        };
      })
      .catch(e => {
        body.innerHTML =
          '<p style="color:#f87171;font-size:13px;text-align:center;padding:40px 0;">Erreur : ' + escapeHtml(e.message) + '</p>';
      });
  }

  // ── Escape HTML ──

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Init ──
  console.log("[FR.IA] Workflow Sharing loaded.");
})();
