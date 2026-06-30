/**
 * FR.IA Workflow Manager — Modale unique avec 2 onglets.
 *
 * Onglet 1 : 📤 Partager — upload du workflow actif + dépendances auto-détectées
 * Onglet 2 : 🌐 Parcourir — liste paginée des workflows publics + installation
 *
 * Dépendances : fria_menu.js (getConfig, setConfig, friaOpenModal)
 *
 * Les scripts ComfyUI sont chargés par ordre alphabétique :
 * fria_menu.js (fria_m) arrive avant fria_workflow_share.js (fria_w).
 * Donc friaOpenModal est toujours disponible.
 */

(function () {
  "use strict";

  // ── Helpers ──

  function getApp() {
    return window.app || window.comfyAPI?.app?.app;
  }

  function getApiUrl() {
    try {
      var cfg = JSON.parse(localStorage.getItem("FRIA_config") || "{}");
      return (cfg.serverUrl || "https://kw.holaf.fr").replace(/\/+$/, "") + "/api";
    } catch { return "https://kw.holaf.fr/api"; }
  }

  function getApiKey() {
    try { return JSON.parse(localStorage.getItem("FRIA_config") || "{}").apiKey || ""; }
    catch { return ""; }
  }

  function apiHeaders() {
    var h = { "Content-Type": "application/json" };
    var key = getApiKey();
    if (key) h["Authorization"] = "Bearer " + key;
    return h;
  }

  function esc(str) {
    if (typeof str !== "string") return "";
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Types ComfyUI natifs ──

  var STANDARD_TYPES = new Set([
    "CheckpointLoaderSimple", "CLIPTextEncode", "CLIPSetLastLayer",
    "KSampler", "KSamplerAdvanced", "VAELoader", "VAEDecode", "VAEEncode",
    "LoraLoader", "EmptyLatentImage", "SaveImage", "PreviewImage",
    "LoadImage", "CLIPVisionEncode", "ControlNetLoader",
    "GLIGENLoader", "UpscaleModelLoader", "unCLIPCheckpointLoader",
    "CLIPLoader", "DualCLIPLoader", "UNETLoader",
    "ImageUpscaleWithModel", "ImageScale", "ImageScaleToTotalPixels",
    "LatentUpscale", "LatentDecode", "LatentFromBatch",
    "CheckpointSave", "PromptBlob", "Reroute", "Note",
    "PrimitiveNode", "WorkflowRestorer",
  ]);

  function detectDependencies(workflowJSON) {
    var nodes = workflowJSON?.nodes || [];
    var deps = { nodes: [], models: [], loras: [] };
    var seen = { nodes: {}, models: {}, loras: {} };
    for (var i = 0; i < nodes.length; i++) {
      var type = nodes[i].type || "";
      var widgets = nodes[i].widgets_values || [];
      if (!STANDARD_TYPES.has(type) && !type.startsWith("_") && !seen.nodes[type]) {
        seen.nodes[type] = true;
        deps.nodes.push({ name: type, url: "" });
      }
      if (type === "CheckpointLoaderSimple" && widgets[0] && !seen.models[widgets[0]]) {
        seen.models[widgets[0]] = true;
        deps.models.push({ name: widgets[0], type: "checkpoint" });
      }
      if (type === "LoraLoader" && widgets[0] && !seen.loras[widgets[0]]) {
        seen.loras[widgets[0]] = true;
        deps.loras.push({ name: widgets[0] });
      }
    }
    return deps;
  }

  // ── Modale unique ──

  window.openWorkflowManager = function () {
    var modal = friaOpenModal("📤  Workflows", "", "680px");
    var body = modal.querySelector("div:last-child");

    var currentTab = "share";
    var browseState = { page: 1, query: "", sort: "downloads" };

    function render() {
      body.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:10px;min-height:350px;">' +
        // Tab bar
        '<div style="display:flex;gap:0;border-bottom:1px solid #444;">' +
        '<button id="wf-tab-share" style="flex:1;padding:8px;border:none;border-bottom:2px solid ' +
        (currentTab === "share" ? "#6366f1" : "transparent") + ';background:transparent;color:' +
        (currentTab === "share" ? "#e2e8f0" : "#888") + ';font-size:13px;font-weight:' +
        (currentTab === "share" ? "600" : "400") + ';cursor:pointer;">📤 Partager</button>' +
        '<button id="wf-tab-browse" style="flex:1;padding:8px;border:none;border-bottom:2px solid ' +
        (currentTab === "browse" ? "#6366f1" : "transparent") + ';background:transparent;color:' +
        (currentTab === "browse" ? "#e2e8f0" : "#888") + ';font-size:13px;font-weight:' +
        (currentTab === "browse" ? "600" : "400") + ';cursor:pointer;">🌐 Parcourir</button>' +
        '</div>' +
        '<div id="wf-tab-content" style="flex:1;"></div>' +
        '</div>';

      body.querySelector("#wf-tab-share").onclick = function () { currentTab = "share"; renderTab(); };
      body.querySelector("#wf-tab-browse").onclick = function () { currentTab = "browse"; renderTab(); };
      renderTab();
    }

    function renderTab() {
      var container = body.querySelector("#wf-tab-content");
      if (currentTab === "share") renderShareTab(container);
      else renderBrowseTab(container);
    }

    // ═══════════════════════════════════════════════
    //  TAB 1 : PARTAGER
    // ═══════════════════════════════════════════════

    function renderShareTab(container) {
      // Lire le workflow actif
      var workflowStr = "";
      var workflowJSON = null;
      try {
        var currentApp = getApp();
        if (currentApp && currentApp.graph) {
          workflowJSON = currentApp.graph.serialize();
          workflowStr = JSON.stringify(workflowJSON, null, 2);
        }
      } catch (e) { workflowStr = ""; }

      if (!workflowStr) {
        container.innerHTML = '<p style="color:#f87171;font-size:13px;text-align:center;padding:30px 0;">Impossible de lire le workflow actif.</p>';
        return;
      }

      var deps = detectDependencies(workflowJSON);
      var existingId = null;

      container.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<div><label style="font-size:11px;color:#888;display:block;margin-bottom:3px;">Nom *</label>' +
        '<input id="wf-name" type="text" value="' + esc(workflowJSON?.extra?.title || workflowJSON?.title || workflowJSON?.name || '') + '" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:13px;box-sizing:border-box;"></div>' +
        '<div><label style="font-size:11px;color:#888;display:block;margin-bottom:3px;">Description</label>' +
        '<textarea id="wf-desc" rows="2" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:12px;box-sizing:border-box;resize:vertical;"></textarea></div>' +
        '<div><label style="font-size:11px;color:#888;display:block;margin-bottom:3px;">Tags (virgules)</label>' +
        '<input id="wf-tags" type="text" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:13px;box-sizing:border-box;"></div>' +
        '<div id="wf-deps" style="font-size:12px;color:#bbb;border-top:1px solid #444;padding-top:8px;"></div>' +
        '<button id="wf-publish-btn" style="padding:8px;border:none;border-radius:6px;background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">📤 Publier</button>' +
        '<div id="wf-status" style="font-size:11px;color:#888;display:none;"></div>' +
        '</div>';

      // Remplir les dépendances
      var depsHtml = '<p style="font-size:11px;color:#888;margin:0 0 6px 0;">🔍 Dépendances détectées :</p>';
      if (deps.nodes.length === 0 && deps.models.length === 0 && deps.loras.length === 0) {
        depsHtml += '<span style="color:#34d399;">✓ Aucune dépendance externe</span>';
      } else {
        if (deps.nodes.length) {
          depsHtml += '<div style="margin-bottom:4px;"><span style="color:#f59e0b;">📦 Custom nodes</span>';
          for (var i = 0; i < deps.nodes.length; i++)
            depsHtml += '<div style="margin-left:12px;color:#ccc;">· ' + esc(deps.nodes[i].name) + '</div>';
          depsHtml += '</div>';
        }
        if (deps.models.length) {
          depsHtml += '<div style="margin-bottom:4px;"><span style="color:#60a5fa;">🧠 Modèles</span>';
          for (var i = 0; i < deps.models.length; i++)
            depsHtml += '<div style="margin-left:12px;color:#ccc;">· ' + esc(deps.models[i].name) + '</div>';
          depsHtml += '</div>';
        }
        if (deps.loras.length) {
          depsHtml += '<div style="margin-bottom:4px;"><span style="color:#a78bfa;">🎨 LoRAs</span>';
          for (var i = 0; i < deps.loras.length; i++)
            depsHtml += '<div style="margin-left:12px;color:#ccc;">· ' + esc(deps.loras[i].name) + '</div>';
          depsHtml += '</div>';
        }
      }
      container.querySelector("#wf-deps").innerHTML = depsHtml;

      // Vérifier si un workflow du même nom existe déjà
      function checkExisting(name) {
        fetch(getApiUrl() + "/workflows?q=" + encodeURIComponent(name) + "&limit=5", { headers: apiHeaders() })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var items = data?.items || [];
            fetch(getApiUrl() + "/auth/me", { headers: apiHeaders() })
              .then(function (r) { return r.json(); })
              .then(function (me) {
                if (!me || typeof me.id !== 'string') return;
                for (var i = 0; i < items.length; i++) {
                  if (items[i].name.toLowerCase() === name.toLowerCase() && items[i].user_id === me.id) {
                    existingId = items[i].id;
                    var btn = container.querySelector("#wf-publish-btn");
                    btn.textContent = "🔄 Mettre à jour (v" + (items[i].version + 1) + ")";
                    btn.style.background = "#f59e0b";
                    return;
                  }
                }
                existingId = null;
                var btn = container.querySelector("#wf-publish-btn");
                btn.textContent = "📤 Publier";
                btn.style.background = "#6366f1";
              });
          });
      }

      container.querySelector("#wf-name").addEventListener("input", function () {
        checkExisting(this.value.trim());
      });
      // Check existing on load too
      var initialName = container.querySelector("#wf-name").value.trim();
      if (initialName) checkExisting(initialName);

      // Publish
      container.querySelector("#wf-publish-btn").onclick = function () {
        var name = container.querySelector("#wf-name").value.trim();
        var desc = container.querySelector("#wf-desc").value.trim();
        var tags = container.querySelector("#wf-tags").value.trim();
        var statusEl = container.querySelector("#wf-status");
        statusEl.style.display = "block";
        statusEl.style.color = "#fbbf24";
        statusEl.textContent = "Publication...";

        var payload = {
          name: name, description: desc, tags: tags,
          workflow_json: workflowStr,
          required_nodes: deps.nodes,
          required_models: deps.models,
          required_loras: deps.loras,
        };
        if (existingId) payload.existing_id = existingId;

        fetch(getApiUrl() + "/workflows", {
          method: "POST", headers: apiHeaders(),
          body: JSON.stringify(payload),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.error) throw new Error(data.error);
            statusEl.style.color = "#34d399";
            statusEl.textContent = existingId ? "✅ Mis à jour !" : "✅ Publié !";
            setTimeout(function () { statusEl.textContent = ""; statusEl.style.display = "none"; }, 2000);
          })
          .catch(function (e) {
            statusEl.style.color = "#f87171";
            statusEl.textContent = "❌ " + e.message;
          });
      };
    }

    // ═══════════════════════════════════════════════
    //  TAB 2 : PARCOURIR
    // ═══════════════════════════════════════════════

    function renderBrowseTab(container, ctx) {
      ctx = ctx || browseState;
      var q = encodeURIComponent(ctx.query);
      var s = encodeURIComponent(ctx.sort);
      var url = getApiUrl() + "/workflows?q=" + q + "&sort=" + s + "&page=" + ctx.page + "&limit=20";

      container.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:8px;min-height:300px;">' +
        '<div style="display:flex;gap:8px;">' +
        '<input id="wf-search" type="text" placeholder="🔍 Rechercher..." value="' + esc(ctx.query) + '" style="flex:1;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:13px;">' +
        '<select id="wf-sort" style="padding:6px 8px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;font-size:12px;">' +
        '<option value="downloads"' + (ctx.sort === "downloads" ? " selected" : "") + '>📥 DL</option>' +
        '<option value="likes"' + (ctx.sort === "likes" ? " selected" : "") + '>❤️ Likes</option>' +
        '<option value="created_at"' + (ctx.sort === "created_at" ? " selected" : "") + '>📅 Date</option>' +
        '</select></div>' +
        '<div id="wf-list" style="flex:1;"><p style="color:#888;font-size:13px;text-align:center;padding:30px 0;">Chargement...</p></div>' +
        '<div id="wf-pages" style="display:flex;justify-content:center;gap:6px;"></div>' +
        '</div>';

      container.querySelector("#wf-search").addEventListener("input", function () {
        clearTimeout(window._wfSearchTimer);
        window._wfSearchTimer = setTimeout(function () {
          ctx.query = container.querySelector("#wf-search").value.trim();
          ctx.page = 1;
          renderBrowseTab(container, ctx);
        }, 300);
      });

      container.querySelector("#wf-sort").addEventListener("change", function () {
        ctx.sort = container.querySelector("#wf-sort").value;
        ctx.page = 1;
        renderBrowseTab(container, ctx);
      });

      fetch(url, { headers: apiHeaders() })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var items = data?.items || [];
          var total = data?.total || 0;
          var pages = Math.ceil(total / 20);
          var listEl = container.querySelector("#wf-list");

          if (items.length === 0) {
            listEl.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:30px 0;">Aucun workflow trouvé.</p>';
            return;
          }

          var html = "";
          for (var i = 0; i < items.length; i++) {
            var w = items[i];
            var author = w.author || w.user_id || "?";
            var depsCount = (w.required_nodes?.length || 0) + (w.required_models?.length || 0) + (w.required_loras?.length || 0);
            html +=
              '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #444;border-radius:6px;margin-bottom:4px;cursor:pointer;background:#3a3a3e;"' +
              ' onclick="window._wfOpenDetail(' + w.id + ', this)">' +
              '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(w.name) + '</div>' +
              '<div style="font-size:11px;color:#888;">par ' + esc(author) + (depsCount > 0 ? ' · ' + depsCount + ' dép.' : '') + '</div></div>' +
              '<div style="text-align:right;font-size:11px;color:#888;white-space:nowrap;">' +
              '❤️ ' + (w.likes || 0) + ' 📥 ' + (w.downloads || 0) + ' <span style="color:#666;">v' + (w.version || 1) + '</span></div></div>';
          }
          listEl.innerHTML = html;

          // Pagination
          var pagEl = container.querySelector("#wf-pages");
          if (pages > 1) {
            var pagHtml = "";
            if (ctx.page > 1)
              pagHtml += '<button onclick="window._wfGoPage(' + (ctx.page - 1) + ')" style="padding:4px 10px;border:1px solid #555;border-radius:4px;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:12px;">←</button>';
            pagHtml += '<span style="font-size:12px;color:#888;padding:4px 8px;">' + ctx.page + ' / ' + pages + '</span>';
            if (ctx.page < pages)
              pagHtml += '<button onclick="window._wfGoPage(' + (ctx.page + 1) + ')" style="padding:4px 10px;border:1px solid #555;border-radius:4px;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:12px;">→</button>';
            pagEl.innerHTML = pagHtml;
          }
        })
        .catch(function () {
          container.querySelector("#wf-list").innerHTML = '<p style="color:#f87171;font-size:13px;text-align:center;padding:30px 0;">Erreur de chargement.</p>';
        });
    }

    // ── Detail / Install (global pour les onclick HTML) ──

    window._wfGoPage = function (page) {
      browseState.page = page;
      render();
    };

    window._wfOpenDetail = function (workflowId) {
      var detailModal = friaOpenModal("📥 Workflow", "", "580px");
      var detailBody = detailModal.querySelector("div:last-child");
      detailBody.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:30px 0;">Chargement...</p>';

      fetch(getApiUrl() + "/workflows/" + workflowId, { headers: apiHeaders() })
        .then(function (r) { return r.json(); })
        .then(function (w) {
          var html =
            '<div style="margin-bottom:12px;">' +
            '<h2 style="font-size:16px;font-weight:700;color:#e2e8f0;margin:0 0 4px 0;">' + esc(w.name) + '</h2>' +
            '<p style="font-size:12px;color:#888;margin:0;">par ' + esc(w.author || w.user_id) + ' · v' + (w.version || 1) +
            ' · ❤️ ' + (w.likes || 0) + ' · 📥 ' + (w.downloads || 0) + '</p>' +
            (w.description ? '<p style="font-size:12px;color:#aaa;margin:8px 0 0 0;">' + esc(w.description) + '</p>' : '') +
            '</div>' +
            '<div id="wf-install-deps" style="margin-bottom:12px;"></div>' +
            '<div style="display:flex;gap:8px;">' +
            '<button id="wf-load-btn" style="flex:1;padding:10px;border:none;border-radius:6px;background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">📥 Charger le workflow</button>' +
            '<button onclick="this.closest(\'[id^=fria-modal]\').remove()" style="padding:10px 16px;border:1px solid #555;border-radius:6px;background:transparent;color:#999;font-size:13px;cursor:pointer;">Fermer</button></div>' +
            '<div id="wf-load-status" style="font-size:11px;color:#888;display:none;margin-top:8px;"></div>';

          detailBody.innerHTML = html;

          // Dépendances
          var allDeps = {
            nodes: w.required_nodes || [],
            models: w.required_models || [],
            loras: w.required_loras || [],
          };
          var totalDeps = allDeps.nodes.length + allDeps.models.length + allDeps.loras.length;
          var depsEl = detailBody.querySelector("#wf-install-deps");

          if (totalDeps === 0) {
            depsEl.innerHTML = '<p style="font-size:12px;color:#34d399;">✓ Aucune dépendance externe</p>';
          } else {
            var depHtml = '<p style="font-size:12px;color:#fbbf24;margin:0 0 8px 0;">⚠️ Dépendances requises :</p>';
            depHtml += '<div style="border:1px solid #444;border-radius:6px;overflow:hidden;">';

            if (allDeps.nodes.length) {
              depHtml += '<div style="background:#3a3a3e;padding:6px 10px;border-bottom:1px solid #444;"><span style="font-size:11px;color:#f59e0b;font-weight:600;">📦 Custom nodes</span></div>';
              for (var i = 0; i < allDeps.nodes.length; i++) {
                var n = allDeps.nodes[i];
                depHtml += '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #3a3a3e;cursor:pointer;font-size:12px;color:#ccc;">' +
                  '<input type="checkbox" class="wf-dep-cb" checked data-type="node" style="accent-color:#6366f1;">' +
                  '<span style="flex:1;">' + esc(n.name) + '</span>' +
                  (n.url ? '<a href="' + esc(n.url) + '" target="_blank" style="color:#60a5fa;text-decoration:none;font-size:11px;" onclick="event.stopPropagation();">🔗</a>' : '') +
                  '</label>';
              }
            }
            if (allDeps.models.length) {
              if (allDeps.nodes.length) depHtml += '<div style="border-top:1px solid #444;"></div>';
              depHtml += '<div style="background:#3a3a3e;padding:6px 10px;border-bottom:1px solid #444;"><span style="font-size:11px;color:#60a5fa;font-weight:600;">🧠 Modèles</span></div>';
              for (var i = 0; i < allDeps.models.length; i++) {
                var m = allDeps.models[i];
                depHtml += '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #3a3a3e;cursor:pointer;font-size:12px;color:#ccc;">' +
                  '<input type="checkbox" class="wf-dep-cb" checked data-type="model" style="accent-color:#6366f1;">' +
                  '<span style="flex:1;">' + esc(m.name) + '</span>' +
                  '<span style="font-size:10px;color:#666;">' + (m.type || 'modèle') + '</span></label>';
              }
            }
            if (allDeps.loras.length) {
              if (allDeps.nodes.length || allDeps.models.length) depHtml += '<div style="border-top:1px solid #444;"></div>';
              depHtml += '<div style="background:#3a3a3e;padding:6px 10px;border-bottom:1px solid #444;"><span style="font-size:11px;color:#a78bfa;font-weight:600;">🎨 LoRAs</span></div>';
              for (var i = 0; i < allDeps.loras.length; i++) {
                depHtml += '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #3a3a3e;cursor:pointer;font-size:12px;color:#ccc;">' +
                  '<input type="checkbox" class="wf-dep-cb" checked data-type="lora" style="accent-color:#6366f1;">' +
                  '<span style="flex:1;">' + esc(allDeps.loras[i].name) + '</span></label>';
              }
            }
            depHtml += '</div>';
            depsEl.innerHTML = depHtml;
          }

          // Load button
          detailBody.querySelector("#wf-load-btn").onclick = function () {
            var statusEl = detailBody.querySelector("#wf-load-status");
            statusEl.style.display = "block";
            statusEl.style.color = "#fbbf24";
            statusEl.textContent = "Téléchargement...";

            fetch(getApiUrl() + "/workflows/" + workflowId + "/download", { headers: apiHeaders() })
              .then(function (r) { return r.json(); })
              .then(function (data) {
                if (data.error) throw new Error(data.error);
                var wfJson = data.workflow_json;
                statusEl.textContent = "Chargement dans ComfyUI...";

                try {
                  var parsed = JSON.parse(wfJson);
                  var currentApp = getApp();
                  if (currentApp && currentApp.loadGraphData) {
                    currentApp.loadGraphData(parsed).then(function () {
                      statusEl.style.color = "#34d399";
                      statusEl.textContent = "✅ Workflow chargé !";
                      setTimeout(function () { detailModal.remove(); }, 1500);
                    }).catch(function (err) {
                      statusEl.style.color = "#f87171";
                      statusEl.textContent = "❌ Erreur de chargement : " + err.message;
                    });
                  } else if (currentApp && currentApp.graph) {
                    currentApp.graph.clear();
                    currentApp.loadGraphData(parsed);
                    statusEl.style.color = "#34d399";
                    statusEl.textContent = "✅ Workflow chargé !";
                    setTimeout(function () { detailModal.remove(); }, 1500);
                  } else {
                    navigator.clipboard.writeText(wfJson).then(function () {
                      statusEl.style.color = "#fbbf24";
                      statusEl.textContent = "⚠️ Copié dans le presse-papier.";
                    }).catch(function () {
                      statusEl.style.color = "#f87171";
                      statusEl.textContent = "❌ Impossible de charger.";
                    });
                  }
                } catch (e) {
                  statusEl.style.color = "#f87171";
                  statusEl.textContent = "❌ Erreur : " + e.message;
                }
              })
              .catch(function (e) {
                statusEl.style.color = "#f87171";
                statusEl.textContent = "❌ " + e.message;
              });
          };
        })
        .catch(function () {
          detailBody.innerHTML = '<p style="color:#f87171;font-size:13px;text-align:center;padding:30px 0;">Erreur de chargement.</p>';
        });
    };

    render();
  };
})();
