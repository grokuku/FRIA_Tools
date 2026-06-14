
    const API = '/api';
    let allKeywords = [];
    let sectionsList = [];
    let currentUser = null;
    let semanticCache = null;  // { text, results: [...], timestamp }

    // === DOM refs ===
    const $ = id => document.getElementById(id);
    const searchInput = $('search-input');
    const searchNegInput = $('search-neg-input');
    const semanticInput = $('search-semantic-input');
    const sectionSelect = $('section-select');
    const subsectionSelect = $('subsection-select');
    const emptyState = $('empty-state');
    const resultsArea = $('results-area');
    const filtersBar = $('filters-bar');
    const tableBody = $('table-body');
    const footerStats = $('footer-stats');
    const countDisplay = $('count-display');
    const countLabel = $('count-label');
    const scoreHeader = $('score-header');
    const semanticLoading = $('semantic-loading');
    const userArea = $('user-area');
    const btnLogin = $('btn-login');
    const userInfo = $('user-info');
    const userAvatar = $('user-avatar');
    const userName = $('user-name');
    const btnAdmin = $('btn-admin');
    const emptyTitle = $('empty-title');
    const emptyDesc = $('empty-desc');
    const emptyBtn = $('empty-btn');
    const emptyImportBtn = $('empty-import-btn');
    const emptySvg = $('empty-svg');

    let textTimer = null;
    let semanticTimer = null;

    // === Init ===

    const enhOutput = $('enhance-output');

    let hiddenKWs = {};  // { id: true } — mots-cles masques localement

    async function safeJson(res) {
      try { return await res.json(); } catch(e) { return { error: 'Erreur serveur ' + res.status }; }
    }

    function updateStats(stats) {
      var parts = [];
      if (stats.total > 0) parts.push(stats.total + ' mots-cles');
      if (stats.section_count > 0) parts.push(stats.section_count + ' sections');
      if (stats.nsfw_total > 0) parts.push(stats.nsfw_total + ' NSFW');
      if (stats.generated_total > 0) parts.push(stats.generated_total + ' prompts generes');
      footerStats.textContent = parts.length > 0 ? parts.join(' · ') : 'Base vide — importez un fichier pour commencer';
    }

    document.addEventListener('DOMContentLoaded', initApp);

    /* ── Main tabs (Prompt Helper / Style / Template / Keywords Manager) ── */
    function switchMainTab(tab) {
      const tabs = {
        prompt: document.getElementById('tab-prompt-helper'),
        style: document.getElementById('tab-styles'),
        template: document.getElementById('tab-templates'),
        keywords: document.getElementById('tab-keywords-manager')
      };
      const buttons = {
        prompt: document.getElementById('tab-btn-prompt'),
        style: document.getElementById('tab-btn-style'),
        template: document.getElementById('tab-btn-template'),
        keywords: document.getElementById('tab-btn-keywords')
      };

      Object.keys(tabs).forEach(function(key) {
        if (tabs[key]) {
          if (key === tab) tabs[key].classList.remove('hidden');
          else tabs[key].classList.add('hidden');
        }
      });

      Object.keys(buttons).forEach(function(key) {
        var btn = buttons[key];
        if (!btn) return;
        if (key === tab) {
          btn.classList.remove('text-white/70', 'hover:text-white', 'hover:bg-white/10');
          btn.classList.add('bg-white/20', 'text-white');
        } else {
          btn.classList.remove('bg-white/20', 'text-white');
          btn.classList.add('text-white/70', 'hover:text-white', 'hover:bg-white/10');
        }
      });

      if (tab === 'style') loadStylesTab();
      if (tab === 'template') loadTemplate();
    }

    /* ── Theme system ── */
    function setTheme(name) {
      document.documentElement.setAttribute('data-theme', name);
      localStorage.setItem('theme', name);
    }

    function toggleThemeMode() {
      const html = document.documentElement;
      const isDark = html.classList.toggle('dark');
      localStorage.setItem('theme-mode', isDark ? 'dark' : 'light');
      document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
    }

    function initThemeUI() {
      var sel = document.getElementById('theme-select');
      if (sel) {
        var saved = localStorage.getItem('theme') || 'nord';
        var validThemes = ['solarized','nord','catppuccin','gruvbox','material'];
        if (validThemes.indexOf(saved) === -1) saved = 'nord';
        sel.value = saved;
      }
      document.getElementById('theme-icon').textContent =
        document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
    }

    document.addEventListener('DOMContentLoaded', initThemeUI);

    async function initApp() {
      await checkAuth();
      searchInput?.addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(applyFilters, 300); });
      semanticInput?.addEventListener('input', () => { clearTimeout(semanticTimer); semanticTimer = setTimeout(applyFilters, 400); });
      searchNegInput?.addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(applyFilters, 300); });
      sectionSelect?.addEventListener('change', function(){
        semanticCache = null;
        loadSubsections(this.value);
        applyFilters();
      });
      subsectionSelect?.addEventListener('change', function(){ semanticCache = null; applyFilters(); });
      document.querySelectorAll('input[name="nsfw-filter"]').forEach(el => el.addEventListener('change', function(){ semanticCache = null; applyFilters(); }));
    searchNegInput?.addEventListener('change', function(){ semanticCache = null; });
      var confSlider = document.getElementById('filter-confidence');
      var confNum = document.getElementById('filter-confidence-num');
      function applyConfidence() {
        var n = parseInt(confSlider.value);
        if (isNaN(n)) n = 0;
        if (n < 0) n = 0; if (n > 100) n = 100;
        confSlider.value = n;
        confNum.value = n;
        semanticCache = null;  // forcer un re-fetch avec le nouveau %
        loadKeywords();
      }
      if (confSlider) {
        confSlider.addEventListener('input', function() { confNum.value = this.value; applyConfidence(); });
      }
      if (confNum) {
        confNum.addEventListener('change', function() { confSlider.value = this.value; applyConfidence(); });
      }
      if (currentUser) await checkData();
      if (currentUser) { loadEnhancerConfig(); loadEPState(); }
    }

    // --- Reset functions ---
    function toggleHideKeyword(id) {
      if (hiddenKWs[id]) delete hiddenKWs[id];
      else hiddenKWs[id] = true;
      renderTable(allKeywords);
    }

    function showAllHidden() {
      hiddenKWs = {};
      renderTable(allKeywords);
    }

    function resetFilters() {
      document.getElementById('search-input').value = '';
      document.getElementById('search-neg-input').value = '';
      document.getElementById('search-semantic-input').value = '';
      document.getElementById('section-select').value = '';
      document.getElementById('subsection-select').value = '';
      document.getElementById('subsection-select').innerHTML = '<option value="">Toutes sous-sections</option>';
      document.querySelectorAll('input[name="nsfw-filter"]').forEach(function(r){ r.checked = r.value === ''; });
      document.getElementById('filter-confidence').value = 0;
      document.getElementById('filter-confidence-num').value = 0;
      semanticCache = null;
      applyFilters();
    }
    function resetElementsPicker() {
      genElements = [];
      genRender();
      saveEPState();
    }
    function resetEnhancer() {
      document.getElementById('enhance-input').value = '';
      document.getElementById('enhance-output').value = '';
      document.getElementById('btn-copy-enhance').classList.add('hidden');
      document.getElementById('btn-toggle-view').classList.add('hidden');
      saveEnhancerSettings();
    }

    function getNsfwFilter() {
      const checked = document.querySelector('input[name="nsfw-filter"]:checked');
      return checked ? checked.value : '';
    }

    async function checkAuth() {
      try {
        const res = await fetch(API + '/auth/me');
        if (res.ok) {
          currentUser = await res.json();
          btnLogin.classList.add('hidden');
          userInfo.classList.remove('hidden');
          userInfo.classList.add('flex');
          userAvatar.src = currentUser.avatar_url;
          userName.textContent = currentUser.display_name;
          if (currentUser.role === 'admin') btnAdmin.classList.remove('hidden');
          else btnAdmin.classList.add('hidden');
          document.getElementById('btn-members').classList.remove('hidden');
          loadLayout();
        } else {
          currentUser = null;
          btnLogin.classList.remove('hidden');
          userInfo.classList.add('hidden');
          userInfo.classList.remove('flex');
        }
        showEmptyState(currentUser !== null);
      } catch {
        currentUser = null;
        showEmptyState(false);
      }
    }

    function showEmptyState(loggedIn) {
      emptyState.classList.remove('hidden');
      emptyState.style.display = 'flex';
      resultsArea.classList.add('hidden');
      var filtersInPanel = document.getElementById('filters-bar');
      if (filtersInPanel) filtersInPanel.classList.add('hidden');
      var mc = document.getElementById('main-content');
      if (mc) mc.style.display = loggedIn ? '' : '';
      var panels = document.getElementById('panels-container');
      if (panels) panels.style.display = loggedIn ? 'flex' : 'none';
      if (loggedIn) {
        emptyTitle.textContent = 'Base de donnees vide';
        emptyDesc.innerHTML = 'Aucun mot-cle pour le moment. Importe un fichier .md pour commencer.';
        emptyBtn.classList.add('hidden');
        emptyImportBtn.classList.remove('hidden');
      } else {
        emptyTitle.textContent = 'Connexion requise';
        emptyDesc.textContent = 'Connecte-toi avec Discord pour acceder aux mots-cles.';
        emptyBtn.classList.remove('hidden');
        emptyImportBtn.classList.add('hidden');
      }
    }

    async function logout() {
      document.getElementById('admin-panel').classList.add('hidden');
      document.getElementById('members-panel').classList.add('hidden');
      document.getElementById('main-content').style.display = 'none';
      btnAdmin.classList.add('hidden');
      document.getElementById('btn-members').classList.add('hidden');
      await fetch(API + '/auth/logout');
      currentUser = null;
      btnLogin.classList.remove('hidden');
      userInfo.classList.add('hidden');
      userInfo.classList.remove('flex');
      showEmptyState(false);
      footerStats.textContent = 'Deconnecte.';
    }

    function discordLogin() {
      const w = 600, h = 700;
      const left = (screen.width - w) / 2;
      const top = (screen.height - h) / 2;
      window.open(API + '/auth/discord/login', 'Discord Login', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',popup=1');
    }

    window.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'auth_success') {
        await checkAuth();
        if (currentUser) await checkData();
      }
    });

    async function checkData() {
      try {
        const res = await fetch(API + '/stats');
        if (!res.ok) throw new Error('Not authorized');
        const stats = await res.json();
        const hasData = (stats.total || 0) > 0;
        updateUIState(hasData, stats);
        if (hasData) {
          document.getElementById('main-content').style.display = '';
          await loadSections();
          await loadKeywords();
        } else {
          showEmptyState(true);
        }
      } catch {
        updateUIState(false, {});
      }
    }

    function updateUIState(hasData, stats) {
      if (hasData) {
        emptyState.classList.add('hidden');
        emptyState.style.display = 'none';
        resultsArea.classList.remove('hidden');
        var filtersInPanel = document.getElementById('filters-bar');
        if (filtersInPanel) filtersInPanel.classList.remove('hidden');
        var panels = document.getElementById('panels-container');
        if (panels) panels.style.display = 'flex';
        updateStats(stats);
      } else {
        emptyState.classList.add('hidden');
        resultsArea.classList.add('hidden');
        var filtersInPanel = document.getElementById('filters-bar');
        if (filtersInPanel) filtersInPanel.classList.add('hidden');
        if (currentUser) footerStats.textContent = 'Connecte : ' + currentUser.display_name;
      }
    }

    async function loadSections() {
      try {
        const res = await fetch(API + '/sections');
        sectionsList = await res.json();
        sectionSelect.innerHTML = '<option value="">Toutes sections</option>';
        for (const sec of sectionsList) {
          const opt = document.createElement('option');
          opt.value = sec.section_id;
          opt.textContent = sec.section_id + '. ' + sec.section_title + ' (' + sec.total + ')';
          sectionSelect.appendChild(opt);
        }
      } catch { sectionsList = []; }
    }

    async function loadSubsections(sectionId) {
      try {
        const url = sectionId ? (API + '/subsections?section=' + encodeURIComponent(sectionId)) : (API + '/subsections');
        const res = await fetch(url);
        const list = await res.json();
        subsectionSelect.innerHTML = '<option value="">Toutes sous-sections</option>';
        for (const sub of list) {
          const opt = document.createElement('option');
          opt.value = sub.subsection_id;
          opt.textContent = sub.subsection_id + ' — ' + sub.subsection_title + ' (' + sub.total + ')';
          subsectionSelect.appendChild(opt);
        }
      } catch {}
    }

    async function loadKeywords() {
      const kwLoading = document.getElementById('keywords-loading');
      if (kwLoading) kwLoading.classList.remove('hidden');
      try {
        const textQ = searchInput.value.trim();
      const negQ = searchNegInput.value.trim();
      const semQ = semanticInput.value.trim();
      const nsfw = getNsfwFilter();
      const section = sectionSelect.value;
      const subsection = subsectionSelect.value;
      const confidence = parseFloat(document.getElementById('filter-confidence').value) / 100 || 0;

      let semResults = null;
      if (semQ) {
        if (!semanticCache || semanticCache.text !== semQ || semanticCache.confidence !== confidence || semanticCache.section !== section || semanticCache.subsection !== subsection) {
          semResults = await fetchSemanticSearch(semQ, nsfw, section, subsection, confidence);
          if (semResults) semanticCache = { text: semQ, confidence: confidence, section: section, subsection: subsection, results: semResults };
        } else {
          semResults = semanticCache.results;
        }
      }

      // Appliquer les filtres texte (+) et exclusion (-) aux résultats sémantiques
      if (semResults !== null && (textQ || negQ)) {
        const qLower = textQ.toLowerCase();
        const negLower = negQ.toLowerCase();
        semResults = semResults.filter(function(kw) {
          const fields = [
            (kw.keyword || '').toLowerCase(),
            (kw.description || '').toLowerCase(),
            (kw.section_title || '').toLowerCase(),
            (kw.subsection_title || '').toLowerCase()
          ];
          if (qLower && !fields.some(function(f){ return f.includes(qLower); })) return false;
          if (negLower && fields.some(function(f){ return f.includes(negLower); })) return false;
          return true;
        });
      }

      // Ne pas fetcher l'API texte si la sémantique est active (filtrage fait ci-dessus)
      const [textResults] = await Promise.all([
        (!semQ && (textQ || negQ)) ? fetchTextSearch(textQ, negQ, nsfw, section, subsection) : Promise.resolve(null),
      ]);

      if (semResults !== null) {
        allKeywords = semResults;
      } else if (textResults !== null) {
        allKeywords = textResults;
      } else {
        // Aucune recherche active : charger tout
        try {
          const params = new URLSearchParams();
          if (section) params.append('section', section);
          if (subsection) params.append('subsection', subsection);
          if (nsfw !== '') params.append('nsfw', nsfw);
          const res = await fetch(API + '/keywords?' + params.toString());
          allKeywords = await res.json();
        } catch { allKeywords = []; }
      }
      renderTable(allKeywords);
      } finally {
        if (kwLoading) kwLoading.classList.add('hidden');
      }
    }

    async function fetchTextSearch(q, q_neg, nsfw, section, subsection) {
      try {
        const params = new URLSearchParams();
        params.append('q', q);
        if (q_neg) params.append('q_neg', q_neg);
        if (section) params.append('section', section);
        if (subsection) params.append('subsection', subsection);
        if (nsfw !== '') params.append('nsfw', nsfw);
        const res = await fetch(API + '/keywords?' + params.toString());
        return await res.json();
      } catch { return []; }
    }

    async function fetchSemanticSearch(q, nsfw, section, subsection, confidence) {
      semanticLoading.classList.remove('hidden');
      try {
        const params = new URLSearchParams();
        params.append('q', q);
        params.append('limit', '500');
        if (section) params.append('section', section);
        if (subsection) params.append('subsection', subsection);
        if (nsfw !== '') params.append('nsfw', nsfw);
        if (confidence > 0) params.append('confidence', confidence);
        const res = await fetch(API + '/search/semantic?' + params.toString());
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur ' + res.status);
        }
        return await res.json();
      } catch (err) {
        console.error('Semantic search error:', err);
        return [];
      } finally {
        semanticLoading.classList.add('hidden');
      }
    }

    function applyFilters(preserveHidden) {
      if (!preserveHidden) hiddenKWs = {};
      loadKeywords();
    }

    function renderTable(rows) {
      tableBody.innerHTML = '';
      const isSemantic = semanticInput.value.trim() !== '';
      scoreHeader.classList.toggle('hidden', !isSemantic);
      // Filtrer les mots masques localement
      var hiddenCount = rows.filter(function(r){ return hiddenKWs[r.id]; }).length;
      if (rows.length === 0) {
        const colspan = isSemantic ? 4 : 3;
        tableBody.innerHTML = '<tr><td colspan="' + colspan + '" class="px-4 py-10 text-center text-slate-400 dark:text-slate-500">Aucun resultat trouve.</td></tr>';
        countDisplay.textContent = '0';
        countLabel.textContent = 'resultat';
        return;
      }
      if (hiddenCount === rows.length) {
        const colspan = isSemantic ? 4 : 3;
        tableBody.innerHTML = '<tr><td colspan="' + colspan + '" class="px-4 py-8 text-center text-sm text-slate-400">Tous les mots-cles sont masques. <button onclick="showAllHidden()" class="text-indigo-500 hover:underline">Tout reafficher</button></td></tr>';
        countDisplay.textContent = '0';
        countLabel.textContent = 'resultat (masques)';
        return;
      }
      const frag = document.createDocumentFragment();
      const isDark = document.documentElement.classList.contains('dark');
      var hiddenCount = 0;
      for (const row of rows) {
        var isHidden = !!hiddenKWs[row.id];
        if (isHidden) hiddenCount++;
        const tr = document.createElement('tr');
        tr.className = row.nsfw ? (isDark ? 'bg-rose-950/30' : 'bg-rose-50/40') : '';
        if (isHidden) tr.className += ' opacity-40 line-through decoration-1 decoration-slate-400';
        const nsfwClass = row.nsfw
          ? (isDark ? 'bg-rose-900/50 text-rose-300' : 'bg-rose-100 text-rose-700')
          : (isDark ? 'bg-slate-700 text-indigo-300' : 'bg-slate-100 text-indigo-600');
        const pct = Math.round((row.score || 0) * 100);
        const scoreTd = isSemantic
          ? '<td class="px-4 py-2 align-top w-24"><div class="score-bar' + (isDark ? ' bg-slate-700' : '') + '"><div class="score-bar-fill" style="width:' + pct + '%"></div></div><span class="text-xs text-slate-400 dark:text-slate-500">' + pct + '%</span></td>'
          : '';
        tr.innerHTML = '<td class="px-4 py-2 align-top"><div class="flex items-center gap-1"><button onclick="toggleHideKeyword(' + row.id + ')" title="' + (isHidden ? 'Reafficher' : 'Masquer') + '" class="text-xs transition p-0.5 leading-none ' + (isHidden ? 'text-rose-400' : 'text-slate-300 hover:text-rose-400') + '">' + (isHidden ? '🙈' : '👁️') + '</button><code class="text-xs font-mono px-1.5 py-0.5 rounded ' + nsfwClass + '">' + escapeHtml(row.keyword) + '</code></div></td>'
          + '<td class="px-4 py-2 text-slate-700 align-top dark:text-slate-300">' + escapeHtml(row.description) + '</td>'
          + '<td class="px-4 py-2 text-xs text-slate-500 align-top dark:text-slate-400 max-w-[160px]"><div class="font-medium text-slate-600 dark:text-slate-300 truncate">' + escapeHtml(row.subsection_title) + '</div><div class="text-slate-400 mt-0.5 dark:text-slate-500 truncate">' + escapeHtml(row.section_id) + '. ' + escapeHtml(row.section_title) + '</div></td>'
          + scoreTd;
        frag.appendChild(tr);
      }
      tableBody.appendChild(frag);
      initColResize();
      loadColWidths();
      countDisplay.textContent = rows.length - hiddenCount;
      countLabel.textContent = (rows.length - hiddenCount > 1 ? ' visibles' : ' visible') + (hiddenCount > 0 ? ' (+ ' + hiddenCount + ' masques)' : '');
    }

    function escapeHtml(str) {
      if (typeof str !== 'string') return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }    function escapeHtml(str) {
      if (typeof str !== 'string') return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }




    // === Elements Picker ===
    var genElementId = 0;
    var genElements = [];
    var genFilters = [];

    function genAddElement(type) {
      type = type || '';
      var id = ++genElementId;
      genElements.push({id: id, type: type, filterId: null, text: '', filterName: ''});
      genRender();
      if (type === 'filter') openFilterPick(id);
      if (type === 'text') openSemanticModal(id);
      saveEPState();
    }

    function genRemoveElement(id) {
      genElements = genElements.filter(function(e){ return e.id !== id; });
      genRender();
      saveEPState();
    }

    function genRender() {
      var container = document.getElementById('gen-elements');
      var html = '';
      if (genElements.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Ajoute un element via les boutons ci-dessous</p>';
        document.getElementById('gen-count').textContent = '0';
      } else {
        for (var i = 0; i < genElements.length; i++) {
          var el = genElements[i];
          html += '<div class="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-700/30 rounded p-1.5">';
          if (el.type === 'filter' && el.filterId) {
            html += '<span class="flex-1 text-xs text-indigo-600 dark:text-indigo-400 truncate">' + escapeHtml(el.filterName) + '</span>';
            html += '<button onclick="previewFilterCache(' + el.filterId + ')" class="text-xs text-slate-300 hover:text-indigo-400 p-0.5" title="Voir le cache">📊</button>';
            html += '<button onclick="genChangeType(' + el.id + ')" class="text-xs text-slate-400 hover:text-slate-600 p-0.5" title="Changer">↻</button>';
          } else if (el.type === 'text' && el.text) {
            html += '<span class="flex-1 text-xs text-emerald-600 dark:text-emerald-400 truncate">"' + escapeHtml(el.text).replace(/"/g, '&quot;') + '"</span>';
            html += '<button onclick="genChangeType(' + el.id + ')" class="text-xs text-slate-400 hover:text-slate-600 p-0.5" title="Changer">↻</button>';
          } else {
            html += '<span class="flex-1 text-xs text-slate-400 italic">En attente...</span>';
          }
          html += '<button onclick="genRemoveElement(' + el.id + ')" class="text-xs text-rose-400 hover:text-rose-300 p-1" title="Supprimer">&times;</button>';
          html += '</div>';
        }
        container.innerHTML = html;
        document.getElementById('gen-count').textContent = genElements.length;
      }
    }

    function genChangeType(id) {
      for (var i = 0; i < genElements.length; i++) {
        if (genElements[i].id === id) {
          genElements[i].type = '';
          genElements[i].filterId = null;
          genElements[i].text = '';
          genElements[i].filterName = '';
          break;
        }
      }
      genRender();
      saveEPState();
    }

    // Modal pour le texte semantique
    function openSemanticModal(elId) {
      showPrompt('Texte libre', 'Recherche semantique (mot ou phrase) :', 'ex: pose dynamique', function(txt){
        if (txt) {
          for (var i = 0; i < genElements.length; i++) {
            if (genElements[i].id === elId) { genElements[i].text = txt.trim(); break; }
          }
        } else {
          genElements = genElements.filter(function(e){ return e.id !== elId; });
        }
        genRender();
        saveEPState();
      });
    }

    // Persistance Elements Picker
    async function saveEPState() {
      if (!currentUser) return;
      var s = currentUser.settings || {};
      s.genElements = genElements.map(function(e){ return {type: e.type, filterId: e.filterId, text: e.text, filterName: e.filterName}; });
      try {
        await fetch(API + '/settings', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(s)
        });
        currentUser.settings = s;
      } catch (e) {}
    }

    function loadEPState() {
      if (currentUser && currentUser.settings && currentUser.settings.genElements) {
        var saved = currentUser.settings.genElements;
        genElements = [];
        saved.forEach(function(e) {
          genElements.push({id: ++genElementId, type: e.type || '', filterId: e.filterId || null, text: e.text || '', filterName: e.filterName || ''});
        });
        genRender();
      }
    }

    // Filter picker modal
    var fpTargetId = null;

    function openFilterPick(elementId) {
      fpTargetId = elementId;
      document.getElementById('modal-filter-pick').classList.remove('hidden');
      document.getElementById('modal-filter-pick').classList.add('flex');
      makeModalDraggable('fp-modal-header', 'fp-modal');
      loadFilterList();
    }

    function closeFilterPick() {
      var target = fpTargetId;
      fpTargetId = null;
      document.getElementById('modal-filter-pick').classList.add('hidden');
      document.getElementById('modal-filter-pick').classList.remove('flex');
      // Si l'utilisateur ferme sans choisir, enlever l'element
      for (var i = 0; i < genElements.length; i++) {
        if (genElements[i].id === target && !genElements[i].filterId) {
          genElements.splice(i, 1);
          genRender();
          saveEPState();
          break;
        }
      }
    }

    async function loadFilterList() {
      var owner = document.getElementById('fp-owner').value;
      var nsfw = document.getElementById('fp-nsfw').value;
      try {
        var res = await fetch(API + '/filters');
        if (!res.ok) return;
        var all = await res.json();
        var filtered = all.filter(function(f) {
          if (owner === 'mine' && f.user_id !== (currentUser ? currentUser.id : '')) return false;
          if (nsfw !== '' && f.nsfw !== parseInt(nsfw)) return false;
          return true;
        });
        var list = document.getElementById('fp-list');
        list.innerHTML = filtered.map(function(f) {
          var badge = f.nsfw ? '<span class="text-xs text-rose-400">NSFW</span>' : '<span class="text-xs text-emerald-400">SFW</span>';
          var pub = f.is_public ? '<span class="text-xs text-slate-400">public</span>' : '';
          var typeTag = f.filter_type === 'union' ? '<span class="text-xs text-amber-500 font-medium">[Union]</span> ' : '';
          return '<div class="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer" onclick="pickFilter(' + f.id + ',\'' + escapeHtml(f.name).replace(/'/g,"\\'") + '\')">'
            + typeTag + '<span class="flex-1 text-slate-700 dark:text-slate-300">' + escapeHtml(f.name) + '</span>'
            + badge + ' ' + pub
            + '</div>';
        }).join('');
        if (filtered.length === 0) {
          list.innerHTML = '<p class="text-slate-400 text-center">Aucun filtre trouve</p>';
        }
      } catch {}
    }

    function pickFilter(filterId, name) {
      if (fpTargetId === -1) {
        // Mode "charger" depuis les filtres
        loadFilterIntoPanel(filterId);
      } else {
        // Mode "choisir" pour le generateur
        for (var i = 0; i < genElements.length; i++) {
          if (genElements[i].id === fpTargetId) {
            genElements[i].filterId = filterId;
            genElements[i].filterName = name;
            break;
          }
        }
        closeFilterPick();
        genRender();
        saveEPState();
      }
    }

    // Generation
    async function genGenerate() {
      var items = [];
      for (var i = 0; i < genElements.length; i++) {
        var el = genElements[i];
        if (el.type === 'filter' && el.filterId) items.push({type: 'filter', id: el.filterId});
        else if (el.type === 'text' && el.text) items.push({type: 'text', text: el.text});
      }
      if (items.length === 0) { showModal('Elements Picker', 'Ajoute un element (saved filter ou semantic) avant de generer', 'error'); return; }

      try {
        var res = await fetch(API + '/generate', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({elements: items})
        });
        if (!res.ok) {
          var err = await res.json().catch(function(){ return {}; });
          showModal('Erreur', err.error || 'Generation impossible', 'error');
          return;
        }
        var data = await res.json();
        var output = data.prompt;
        if (data.count === 0) output = '(aucun mot-cle trouve : verifie les filtres et le cache)';
        document.getElementById('gen-output').value = output;
        document.getElementById('gen-count').textContent = data.count;
      } catch (err) {
        showModal('Erreur', err.message || 'Une erreur est survenue', 'error');
      }
    }

    function genCopy() {
      var ta = document.getElementById('gen-output');
      ta.select();
      document.execCommand('copy');
    }

    // === Save Filter ===
    var loadedFilterId = null;

    function openSaveFilter() {
      document.getElementById('modal-save-filter').classList.remove('hidden');
      document.getElementById('modal-save-filter').classList.add('flex');
      document.getElementById('save-filter-name').focus();
      makeModalDraggable('save-modal-header', 'save-filter-modal');
    }
    function closeSaveFilter() {
      document.getElementById('modal-save-filter').classList.add('hidden');
      document.getElementById('modal-save-filter').classList.remove('flex');
    }
    function discardFilter() {
      loadedFilterId = null;
      document.getElementById('filter-loaded-name').classList.add('hidden');
      document.getElementById('btn-filter-save').classList.add('hidden');
      document.getElementById('btn-filter-discard').classList.add('hidden');
    }

    function getFilterConfig() {
      return {
        section: document.getElementById('section-select').value,
        subsection: document.getElementById('subsection-select').value,
        search_text: document.getElementById('search-input').value,
        search_neg: document.getElementById('search-neg-input').value,
        semantic_text: document.getElementById('search-semantic-input').value,
        nsfw_filter: getNsfwFilter(),
        min_confidence: parseFloat(document.getElementById('filter-confidence').value) / 100,
        hidden_kw_ids: Object.keys(hiddenKWs).map(Number)
      };
    }

    function applyFilterConfig(config) {
      var c = config || {};
      document.getElementById('section-select').value = c.section || '';
      document.getElementById('subsection-select').value = c.subsection || '';
      document.getElementById('search-input').value = c.search_text || '';
      document.getElementById('search-neg-input').value = c.search_neg || '';
      document.getElementById('search-semantic-input').value = c.semantic_text || '';
      var nsfw = c.nsfw_filter !== undefined ? c.nsfw_filter : '';
      document.querySelectorAll('input[name="nsfw-filter"]').forEach(function(r){ r.checked = r.value === nsfw; });
      document.getElementById('filter-confidence').value = Math.round((c.min_confidence || 0) * 100);
      document.getElementById('filter-confidence-num').value = Math.round((c.min_confidence || 0) * 100);
      // Restaurer les mots masqués (👁️)
      hiddenKWs = {};
      if (c.hidden_kw_ids && Array.isArray(c.hidden_kw_ids)) {
        c.hidden_kw_ids.forEach(function(id){ hiddenKWs[id] = true; });
      }
      // Charger les sous-sections si une section est sélectionnée
      if (c.section) {
        loadSubsections(c.section);
      }
      applyFilters(true);
    }

    async function saveCurrentFilter() {
      if (!loadedFilterId) return;
      var config = getFilterConfig();
      try {
        var res = await fetch(API + '/filters/' + loadedFilterId, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({config: config})
        });
        if (res.ok) {
          var pv = await fetch(API + '/filters/' + loadedFilterId + '/preview');
          var pd = pv.ok ? await pv.json() : null;
          var preview = pd && pd.keywords && pd.keywords.length > 0 ? ' | Apercu: ' + pd.keywords.slice(0,5).join(', ') : '';
          showModal('Filtre', 'Filtre mis a jour ! ' + (pd ? pd.total : '?') + ' mots-cles dans le cache.' + preview, 'success');
        } else {
          var err = await res.json().catch(function(){ return {}; });
          showModal('Erreur', err.error || '', 'error');
        }
      } catch (err) {
        showModal('Erreur', err.message || 'Une erreur est survenue', 'error');
      }
    }

    async function saveFilter() {
      var name = document.getElementById('save-filter-name').value.trim();
      if (!name) { showModal('Filtre', 'Donne un nom au filtre', 'error'); return; }
      var cat = document.getElementById('save-filter-cat').value.trim();
      var nsfw = document.querySelector('input[name="save-filter-nsfw"]:checked');
      var nsfwVal = nsfw ? parseInt(nsfw.value) : 0;
      var isPublic = document.getElementById('save-filter-public').checked ? 1 : 0;
      var config = getFilterConfig();
      try {
        var res = await fetch(API + '/filters', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name: name, category: cat, nsfw: nsfwVal, is_public: isPublic, config: config})
        });
        if (res.ok) {
          var data = await res.json();
          closeSaveFilter();
          document.getElementById('save-filter-name').value = '';
          document.getElementById('save-filter-cat').value = '';
          var pvw = data.preview && data.preview.length > 0 ? '\n\nApercu: ' + data.preview.join(', ') : '';
          showModal('Filtre', 'Sauvegarde ! ' + data.count + ' mots-cles dans le cache.' + pvw, 'success');
        } else {
          var err = await res.json().catch(function(){ return {}; });
          showModal('Erreur', err.error || 'Impossible de sauvegarder', 'error');
        }
      } catch (err) {
        showModal('Erreur', err.message || 'Une erreur est survenue', 'error');
      }
    }

    function openFilterListModal() {
      document.getElementById('modal-filter-pick').classList.remove('hidden');
      document.getElementById('modal-filter-pick').classList.add('flex');
      fpTargetId = -1;
      document.getElementById('fp-owner').value = 'mine';
      loadFilterList();
    }

    function loadFilterIntoPanel(filterId) {
      fetch(API + '/filters/' + filterId + '/preview').then(function(res){
        return res.json();
      }).then(function(data){
        if (data.filter_type === 'union') {
          // Union filter: show union info in the name, don't apply config
          resetFilters();
          loadedFilterId = filterId;
          var nameEl = document.getElementById('filter-loaded-name');
          var memberNames = (data.union_members || []).map(function(m){ return m.name; }).join(', ');
          nameEl.textContent = '[Union] ' + (data.name || '') + ' (' + (data.total || 0) + ' kw) → ' + memberNames;
          nameEl.classList.remove('hidden');
          document.getElementById('btn-filter-save').classList.add('hidden');
          document.getElementById('btn-filter-discard').classList.remove('hidden');
        } else {
          applyFilterConfig(data.config || {});
          loadedFilterId = filterId;
          var nameEl = document.getElementById('filter-loaded-name');
          nameEl.textContent = data.name || 'Filtre';
          nameEl.classList.remove('hidden');
          document.getElementById('btn-filter-save').classList.remove('hidden');
          document.getElementById('btn-filter-discard').classList.remove('hidden');
        }
        closeFilterPick();
      }).catch(function(){});
    }


    // === Presets IA + Styles + Enhance ===

    // -- Presets --

    function toggleMergedSettings() {
      var m = document.getElementById('modal-user-settings');
      var open = !m.classList.contains('hidden');
      if (open) { closeMergedSettings(); return; }
      m.classList.remove('hidden');
      m.classList.add('flex');
      makeModalDraggable('usettings-modal-header', 'usettings-modal');
      var providerBtn = m.querySelector('.tab-btn[data-tab="provider"]');
      switchSettingsTab('provider', providerBtn || m.querySelector('.tab-btn'));
      loadPresets();
      loadApiKeySettings();
      if (currentUser && currentUser.role === 'admin') {
        document.getElementById('preset-global-label').style.display = '';
      }
    }

    function closeMergedSettings() {
      document.getElementById('modal-user-settings').classList.add('hidden');
      document.getElementById('modal-user-settings').classList.remove('flex');
    }

    async function loadApiKeySettings() {
      loadApiKey();
    }

    async function _loadApiKeySettings() {
      var keyEl = document.getElementById('settings-api-key');
      var userEl = document.getElementById('settings-username');
      try {
        var me = await fetch(API + '/auth/me').then(function(r){ return safeJson(r); });
        if (me && me.username) userEl.textContent = me.username;
        var res = await fetch(API + '/auth/token');
        var data = await safeJson(res);
        if (data && data.token) keyEl.value = data.token;
      } catch {}
    }

    function switchSettingsTab(tab, btn) {
      document.querySelectorAll('#modal-user-settings .tab-content').forEach(function(el){ el.classList.add('hidden'); });
      document.querySelectorAll('#modal-user-settings .tab-btn').forEach(function(el){
        el.classList.remove('text-indigo-600', 'dark:text-indigo-400', 'border-indigo-500', 'dark:border-indigo-400');
        el.classList.add('text-slate-500', 'dark:text-slate-400', 'border-transparent');
      });
      document.getElementById('tab-' + tab).classList.remove('hidden');
      btn.classList.remove('text-slate-500', 'dark:text-slate-400', 'border-transparent');
      btn.classList.add('text-indigo-600', 'dark:text-indigo-400', 'border-indigo-500', 'dark:border-indigo-400');
    }

    async function loadStylesTab() {
      var el = document.getElementById('styles-tab-list');
      try {
        var res = await fetch(API + '/styles');
        var list = await safeJson(res);
        if (!Array.isArray(list)) { el.innerHTML = '<p class="text-xs text-slate-400">Aucun style</p>'; return; }
        var html = '';
        list.forEach(function(s){
          var name = s.name || '?';
          var author = s.owner_name || '?';
          var pub = s.is_public ? ' 🌐' : ' 🔒';
          var canEdit = s.user_id === (currentUser ? currentUser.id : '');
          html += '<div class="flex items-center justify-between px-2 py-1.5 rounded-md bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700">' +
            '<div><span class="text-xs font-medium text-slate-700 dark:text-slate-300">' + name + '</span>' +
            '<span class="text-xs text-slate-400 ml-2">par ' + author + pub + '</span></div>' +
            '<div class="flex gap-1.5">';
          if (canEdit) html += '<button onclick="editStyleTab(' + s.id + ')" class="text-xs text-indigo-400 hover:text-indigo-600 px-1.5 py-0.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20">Edit</button>';
          html += '<button onclick="deleteStyle(' + s.id + ')" class="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20">&times;</button></div></div>';
        });
        el.innerHTML = html || '<p class="text-xs text-slate-400">Aucun style</p>';
      } catch { el.innerHTML = '<p class="text-xs text-red-400">Erreur de chargement</p>'; }
    }

    function closeUserSettings() {
      document.getElementById('modal-user-settings').classList.add('hidden');
      document.getElementById('modal-user-settings').classList.remove('flex');
    }

    function checkPresetUrl() {
      var url = document.getElementById('preset-form-url').value.trim();
      var warn = document.getElementById('preset-url-warning');
      var isLocal = /(localhost|127\.0\.0\.\d+|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+)/i.test(url);
      if (isLocal) warn.classList.remove('hidden');
      else warn.classList.add('hidden');
    }

    function clearPresetForm() {
      document.getElementById('preset-form-name').value = '';
      document.getElementById('preset-form-url').value = '';
      document.getElementById('preset-form-key').value = '';
      document.getElementById('preset-form-model').value = '';
      document.getElementById('preset-form-global').checked = false;
      document.getElementById('preset-models-dropdown').classList.add('hidden');
      document.getElementById('preset-models-dropdown').innerHTML = '';
    }

    async function loadPresets() {
      try {
        var res = await fetch(API + '/presets');
        if (!res.ok) {
          var txt = await res.text().catch(function(){ return ''; });
          console.error('loadPresets failed:', res.status, txt.substring(0,200));
          return;
        }
        var presets = await res.json();
        renderPresetsList(presets);
        // Remplir le dropdown de l'enhancer
        var sel = document.getElementById('enhance-preset');
        sel.innerHTML = '<option value="">-- Preset IA --</option>';
        presets.forEach(function(p) {
          var opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name + (p.is_global ? ' 🌐' : '') + (p.is_client_side ? ' 🖥️' : '');
          sel.appendChild(opt);
        });
        // Restaurer si sauvegarde
        if (currentUser && currentUser.settings && currentUser.settings.enhancePresetId) {
          sel.value = currentUser.settings.enhancePresetId;
        }
      } catch (e) {}
    }

    function renderPresetsList(presets) {
      var el = document.getElementById('presets-list');
      if (!presets.length) { el.innerHTML = '<p class="text-xs text-slate-400">Aucun preset. Creez-en un !</p>'; return; }
      var html = '';
      presets.forEach(function(p) {
        var canEdit = (!p.is_global && p.user_id === (currentUser ? currentUser.id : '')) || (currentUser && currentUser.role === 'admin');
        html += '<div class="flex items-center justify-between py-1 px-2 rounded text-xs ' + (p.is_global ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'bg-slate-50 dark:bg-slate-800/50') + '">';
        html += '<div><span class="font-medium text-slate-700 dark:text-slate-200">' + p.name + '</span>';
        if (p.is_global) html += ' <span class="text-indigo-500">🌐 global</span>';
        if (p.is_client_side) html += ' <span class="text-amber-500">🖥️ client</span>';
        if (p.owner_name && !p.is_global) html += ' <span class="text-slate-400">(' + p.owner_name + ')</span>';
        html += '<br><span class="text-slate-400">' + p.model + ' @ ' + p.base_url + '</span></div>';
        html += '<div class="flex gap-1">';
        if (canEdit) {
          html += '<button onclick="editPreset(' + p.id + ')" class="text-xs text-indigo-500 hover:text-indigo-700">Edit</button>';
          html += '<button onclick="dupPreset(' + p.id + ')" class="text-xs text-slate-400 hover:text-slate-600">Dup</button>';
          html += '<button onclick="delPreset(' + p.id + ')" class="text-xs text-rose-400 hover:text-rose-600">Del</button>';
        }
        html += '</div></div>';
      });
      el.innerHTML = html;
    }

    function editPreset(id) {
      // Charger dans le formulaire (besoin de refaire un fetch)
      fetch(API + '/presets').then(function(r){ return r.json(); }).then(function(ps){
        var p = ps.find(function(x){ return x.id === id; });
        if (!p) return;
        document.getElementById('preset-form-name').value = p.name;
        document.getElementById('preset-form-url').value = p.base_url;
        document.getElementById('preset-form-model').value = p.model;
        document.getElementById('preset-form-key').value = '';
        document.getElementById('preset-form-global').checked = p.is_global;
        // Stocker l'ID pour un update
        document.getElementById('preset-form-name').dataset.editId = id;
      }).catch(function(){});
    }

    async function savePreset() {
      var name = document.getElementById('preset-form-name').value.trim();
      var url = document.getElementById('preset-form-url').value.trim();
      var key = document.getElementById('preset-form-key').value.trim();
      var model = document.getElementById('preset-form-model').value.trim();
      var isGlobal = document.getElementById('preset-form-global').checked ? 1 : 0;
      var isClient = document.getElementById('preset-form-client').checked ? 1 : 0;
      var editId = document.getElementById('preset-form-name').dataset.editId;

      if (!name) { showModal('Preset', 'Nom requis', 'error'); return; }
      if (!url) { showModal('Preset', 'URL requise', 'error'); return; }

      try {
        var body = { name: name, base_url: url, api_key: key, model: model, is_global: isGlobal, is_client_side: isClient };
        var method = 'POST';
        var endpoint = '/presets';
        if (editId) {
          method = 'PUT';
          endpoint = '/presets/' + editId;
          if (!key) delete body.api_key;  // garder l'ancienne cle si vide
        }
        var res = await fetch(API + endpoint, {
          method: method,
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        });
        if (!res.ok) throw await safeJson(res);
        clearPresetForm();
        document.getElementById('preset-form-name').dataset.editId = '';
        loadPresets();
        showModal('Preset', editId ? 'Preset mis a jour' : 'Preset cree', 'success');
      } catch (err) {
        showModal('Erreur', (err.error || err.message || 'Erreur'), 'error');
      }
    }

    async function dupPreset(id) {
      try {
        var res = await fetch(API + '/presets/' + id + '/duplicate', { method: 'POST' });
        if (!res.ok) throw await safeJson(res);
        loadPresets();
        showModal('Preset', 'Preset duplique', 'success');
      } catch (err) {
        showModal('Erreur', (err.error || ''), 'error');
      }
    }

    async function delPreset(id) {
      showConfirm('Supprimer', 'Supprimer ce preset ?', async function(ok){
        if (!ok) return;
        try {
          var res = await fetch(API + '/presets/' + id, { method: 'DELETE' });
          if (!res.ok) throw await safeJson(res);
          loadPresets();
        } catch (err) {}
      });
    }

    async function fetchModelsForForm() {
      var url = document.getElementById('preset-form-url').value.trim();
      var key = document.getElementById('preset-form-key').value.trim();
      var isClient = document.getElementById('preset-form-client').checked;
      if (!url) { showModal('URL', 'Saisis l\'URL du serveur d\'abord', 'error'); return; }

      try {
        var models;
        if (isClient) {
          // ── Mode client-side coche : appel direct depuis le navigateur ──────────
          // (necessite CORS active cote serveur LLM, defaut pour Ollama, LM Studio, etc.)
          var headers = {'Content-Type': 'application/json'};
          if (key) headers['Authorization'] = 'Bearer ' + key;
          var r = await fetch(url.replace(/\/+$/, '') + '/models', { headers: headers });
          if (!r.ok) {
            var errText = await r.text().catch(function(){ return ''; });
            throw { error: 'HTTP ' + r.status + (errText ? ': ' + errText.substring(0, 200) : ' — verifie que CORS est active sur le serveur LLM') };
          }
          var data = await r.json();
          // Format OpenAI standard : {data: [{id, owned_by}, ...]}
          // Certains serveurs (Ollama) utilisent {models: [{name, ...}]}
          var raw = (data && data.data) || (data && data.models) || [];
          models = raw.map(function(m) {
            if (typeof m === 'string') return { id: m, owned_by: '' };
            return { id: m.id || m.name || '', owned_by: m.owned_by || '' };
          });
        } else {
          // ── Mode cloud : le backend fait l'appel ──────────
          var r2 = await fetch(API + '/presets/list-models', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ base_url: url, api_key: key })
          });
          if (!r2.ok) throw await safeJson(r2);
          models = await safeJson(r2);
        }
        var dd = document.getElementById('preset-models-dropdown');
        dd.innerHTML = '';
        models.forEach(function(m) {
          var opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.id + (m.owned_by ? ' (' + m.owned_by + ')' : '');
          dd.appendChild(opt);
        });
        dd.classList.remove('hidden');
        dd.onchange = function() { document.getElementById('preset-form-model').value = this.value; };
        if (models.length === 0) showModal('Modeles', 'Aucun modele trouve', 'error');
      } catch (e) {
        showModal('Erreur', (e.error || e.message || 'Impossible de lister les modeles'), 'error');
      }
    }

    // -- Templates Prompt --

    var _tmplCache = {};

    function renderExamples(examples) {
      var container = document.getElementById('tmpl-examples-list');
      if (!examples || examples.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 italic">Aucun exemple</p>';
        return;
      }
      container.innerHTML = examples.map(function(ex, i) {
        return '<div class="flex items-start gap-1.5 p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">'
          + '<span class="flex-1 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap" style="word-break:break-word;">' + escapeHtml(ex) + '</span>'
          + '<button onclick="removeTemplateExample(' + i + ')" class="text-xs text-rose-400 hover:text-rose-600 p-0.5">✕</button>'
          + '</div>';
      }).join('');
    }

    function getExamples() {
      var items = document.querySelectorAll('#tmpl-examples-list > div');
      var examples = [];
      items.forEach(function(div) {
        var span = div.querySelector('span');
        if (span) examples.push(span.textContent);
      });
      return examples;
    }

    function addTemplateExample() {
      var input = document.getElementById('tmpl-example-input');
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      var examples = getExamples();
      examples.push(text);
      renderExamples(examples);
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'tmpl-example-input') {
        addTemplateExample();
      }
    });

    function removeTemplateExample(idx) {
      var examples = getExamples();
      examples.splice(idx, 1);
      renderExamples(examples);
    }

    async function loadTemplate() {
      var pt = document.getElementById('tmpl-type').value;
      var fmt = document.getElementById('tmpl-format').value;
      var sysEl = document.getElementById('tmpl-system-prompt');
      var lbl = document.getElementById('tmpl-source-label');
      try {
        var res = await fetch(API + '/prompts/templates?prompt_type=' + pt + '&output_format=' + fmt);
        var list = await safeJson(res);
        var tmpl = list.find(function(t){ return t.editable; }) || list.find(function(t){ return t.is_default; });
        if (tmpl) {
          sysEl.value = tmpl.system_prompt || '';
          renderExamples(tmpl.examples || []);
          lbl.textContent = tmpl.editable ? 'personnalise' : 'par defaut';
          _tmplCache[pt + ':' + fmt] = tmpl;
        } else {
          sysEl.value = '';
          renderExamples([]);
          lbl.textContent = 'aucun';
          _tmplCache[pt + ':' + fmt] = null;
        }
      } catch (err) {
        showModal('Erreur', 'Impossible de charger le template: ' + err.message, 'error');
      }
    }

    async function saveTemplate() {
      var pt = document.getElementById('tmpl-type').value;
      var fmt = document.getElementById('tmpl-format').value;
      var sysEl = document.getElementById('tmpl-system-prompt');
      var examples = getExamples();
      try {
        var res = await fetch(API + '/prompts/templates', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            prompt_type: pt,
            output_format: fmt,
            system_prompt: sysEl.value,
            examples: examples
          })
        });
        if (!res.ok) throw await safeJson(res);
        showModal('Template', 'Template personnalise sauvegarde !', 'success');
        loadTemplate();
      } catch (err) {
        showModal('Erreur', 'Impossible de sauvegarder: ' + err.message, 'error');
      }
    }

    async function resetTemplate() {
      var pt = document.getElementById('tmpl-type').value;
      var fmt = document.getElementById('tmpl-format').value;
      var cached = _tmplCache[pt + ':' + fmt];
      if (cached && cached.editable && cached.id) {
        try {
          await fetch(API + '/prompts/templates/' + cached.id, { method: 'DELETE' });
        } catch {}
      }
      try {
        var res = await fetch(API + '/prompts/templates/defaults');
        var defaults = await safeJson(res);
        var def = defaults.find(function(t){ return t.prompt_type === pt && t.output_format === fmt; });
        if (def) {
          document.getElementById('tmpl-system-prompt').value = def.system_prompt || '';
          renderExamples(def.examples || []);
          document.getElementById('tmpl-source-label').textContent = 'par defaut';
          _tmplCache[pt + ':' + fmt] = def;
        }
      } catch {}
    }

    function exportTemplate() {
      var pt = document.getElementById('tmpl-type').value;
      var fmt = document.getElementById('tmpl-format').value;
      var sys = document.getElementById('tmpl-system-prompt').value;
      var examples = getExamples();
      var data = {
        prompt_type: pt,
        output_format: fmt,
        system_prompt: sys,
        examples: examples
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'template_' + pt + '_' + fmt + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }

    document.addEventListener('change', function(e) {
      if (e.target.id === 'tmpl-type' || e.target.id === 'tmpl-format') {
        loadTemplate();
      }
    });

    // -- Styles --

    function openStylesModal() {
      document.getElementById('modal-styles').classList.remove('hidden');
      document.getElementById('modal-styles').classList.add('flex');
      makeModalDraggable('styles-modal-header', 'styles-modal');
      loadStyles();
    }

    function closeStylesModal() {
      document.getElementById('modal-styles').classList.add('hidden');
      document.getElementById('modal-styles').classList.remove('flex');
    }

    async function deleteStyle(id) {
      if (!confirm('Supprimer ce style ?')) return;
      try {
        var res = await fetch(API + '/styles/' + id, { method: 'DELETE' });
        if (!res.ok) throw await safeJson(res);
        if (document.getElementById('tab-styles') && !document.getElementById('tab-styles').classList.contains('hidden')) loadStylesTab();
        if (window.loadStyles) loadStyles();
      } catch (err) {
        showModal('Erreur', 'Impossible de supprimer: ' + (err.message || err.error || ''), 'error');
      }
    }

    async function loadStyles() {
      try {
        var r = await fetch(API + '/styles');
        if (!r.ok) {
          var txt2 = await r.text().catch(function(){ return ''; });
          console.error('loadStyles failed:', r.status, txt2.substring(0,200));
          return;
        }
        var styles = await r.json();
        renderStylesList(styles);
        var sel = document.getElementById('enhance-style');
        sel.innerHTML = '<option value="">-- Style --</option>';
        styles.forEach(function(s) {
          var opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name + (s.is_public ? '' : ' (prive)') + ' - ' + (s.owner_name || 'moi');
          sel.appendChild(opt);
        });
        if (currentUser && currentUser.settings && currentUser.settings.enhanceStyleId) {
          sel.value = currentUser.settings.enhanceStyleId;
        }
      } catch (e) {}
    }

    function renderStylesList(styles) {
      var el = document.getElementById('styles-list');
      if (!styles.length) { el.innerHTML = '<p class="text-xs text-slate-400">Aucun style. Creez-en un !</p>'; return; }
      var html = '';
      styles.forEach(function(s) {
        var canEdit = s.user_id === (currentUser ? currentUser.id : '');
        html += '<div class="flex items-center justify-between py-1 px-2 rounded text-xs bg-slate-50 dark:bg-slate-800/50">';
        html += '<div><span class="font-medium text-slate-700 dark:text-slate-200">' + s.name + '</span>';
        html += ' <span class="text-slate-400">' + (s.is_public ? '🌐 public' : '🔒 prive') + ' (' + (s.owner_name || 'moi') + ')</span>';
        html += '<br><span class="text-slate-400 text-xs italic">+ ' + s.style_text.substring(0, 60) + '</span>';
        if (s.negative_prompt) html += '<br><span class="text-rose-400 text-xs">- ' + s.negative_prompt.substring(0, 50) + '</span>';
        html += '</div>';
        if (canEdit) {
          html += '<div class="flex gap-1">';
          html += '<button onclick="editStyle(' + s.id + ')" class="text-xs text-indigo-400 hover:text-indigo-600">Edit</button>';
          html += '<button onclick="delStyle(' + s.id + ')" class="text-xs text-rose-400 hover:text-rose-600">Del</button>';
          html += '</div>';
        }
        html += '</div>';
      });
      el.innerHTML = html;
    }

    async function saveStyle() {
      var name = document.getElementById('style-form-name').value.trim();
      var text = document.getElementById('style-form-text').value.trim();
      var neg = document.getElementById('style-form-neg').value.trim();
      var isPublic = document.getElementById('style-form-public').checked ? 1 : 0;
      var editId = document.getElementById('style-form-name').dataset.editId;
      if (!name || !text) { showModal('Style', 'Nom et texte requis', 'error'); return; }
      try {
        var body = {name: name, style_text: text, negative_prompt: neg, is_public: isPublic};
        var endpoint = '/styles';
        var method = 'POST';
        if (editId) { endpoint = '/styles/' + editId; method = 'PUT'; }
        var r = await fetch(API + endpoint, {
          method: method,
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        });
        if (!r.ok) throw await safeJson(r);
        clearStyleForm();
        loadStyles();
        showModal('Style', editId ? 'Style mis a jour' : 'Style ajoute !', 'success');
      } catch (err) {
        showModal('Erreur', (err.error || ''), 'error');
      }
    }

    function editStyle(id) {
      fetch(API + '/styles').then(function(r){ return r.json(); }).then(function(styles){
        var s = styles.find(function(x){ return x.id === id; });
        if (!s) return;
        document.getElementById('style-form-name').value = s.name;
        document.getElementById('style-form-name').dataset.editId = id;
        document.getElementById('style-form-text').value = s.style_text;
        document.getElementById('style-form-neg').value = s.negative_prompt || '';
        document.getElementById('style-form-public').checked = s.is_public;
        document.getElementById('btn-style-save').textContent = 'Mettre a jour';
        document.getElementById('btn-style-clear').classList.remove('hidden');
      }).catch(function(){});
    }


    // --- Gestion des filtres ---

    function openManageFilters() {
      document.getElementById('modal-manage-filters').classList.remove('hidden');
      document.getElementById('modal-manage-filters').classList.add('flex');
      makeModalDraggable('mf-modal-header', 'mf-modal');
      mfSelected = {};
      var ub = document.getElementById('mf-union-btn');
      if (ub) ub.style.display = 'none';
      loadManageFilters();
    }

    function closeManageFilters() {
      document.getElementById('modal-manage-filters').classList.add('hidden');
      document.getElementById('modal-manage-filters').classList.remove('flex');
    }

    var mfSelected = {};

    function mfToggleSelect(id) {
      if (mfSelected[id]) delete mfSelected[id];
      else mfSelected[id] = true;
      document.getElementById('mf-union-btn').style.display = Object.keys(mfSelected).length >= 2 ? 'inline-flex' : 'none';
    }

    async function mfCreateUnion() {
      var ids = Object.keys(mfSelected).map(Number);
      if (ids.length < 2) { showModal('Union', 'Selectionne au moins 2 filtres', 'error'); return; }
      showPrompt('Union', 'Nom du filtre compose (union) :', 'Union: ...', async function(name) {
        if (!name) return;
        try {
          var res = await fetch(API + '/filters', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              name: name,
              filter_type: 'union',
              union_member_ids: ids,
              nsfw: 0,
              is_public: 0,
              category: '',
              config: {}
            })
          });
          if (res.ok) {
            showModal('Union', 'Filtre compose cree !', 'success');
            mfSelected = {};
            loadManageFilters();
          } else {
            var err = await safeJson(res);
            showModal('Erreur', err.error || 'Erreur', 'error');
          }
        } catch (err) {
          showModal('Erreur', err.message, 'error');
        }
      });
    }

    async function loadManageFilters() {
      try {
        var r = await fetch(API + '/filters');
        if (!r.ok) return;
        var filters = await r.json();
        var el = document.getElementById('mf-list');
        if (!filters.length) { el.innerHTML = '<p class="text-xs text-slate-400">Aucun filtre</p>'; return; }
        var html = '';
        html += '<div class="flex items-center gap-2 px-1 pb-2 border-b border-slate-200 dark:border-slate-700">';
        html += '<button id="mf-union-btn" onclick="mfCreateUnion()" class="hidden inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 transition dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50">&#x1f9ea; Creer une union</button>';
        html += '<span class="text-xs text-slate-400">(cochez 2+ filtres)</span></div>';
        filters.forEach(function(f) {
          var canEdit = f.user_id === (currentUser ? currentUser.id : '');
          var checked = mfSelected[f.id] ? 'checked' : '';
          var typeBadge = f.filter_type === 'union' ? '<span class="text-xs text-amber-500 font-medium">[Union]</span> ' : '<span class="text-xs text-slate-400">[Simple]</span> ';
          var membersHtml = '';
          if (f.filter_type === 'union' && f.union_members && f.union_members.length > 0) {
            membersHtml = '<br><span class="text-xs text-amber-500/70">→ ' + f.union_members.map(function(m){ return escapeHtml(m.name); }).join(', ') + '</span>';
          }
          html += '<div class="flex items-center justify-between py-1.5 px-2 rounded text-xs ' + (canEdit ? 'bg-slate-50 dark:bg-slate-800/50' : 'bg-slate-50/50 dark:bg-slate-800/30') + '">';
          html += '<div class="flex items-center gap-2 flex-1 min-w-0">';
          html += '<input type="checkbox" ' + checked + ' onchange="mfToggleSelect(' + f.id + ')" class="accent-indigo-500 flex-shrink-0">';
          html += '<div class="min-w-0"><span class="font-medium text-slate-700 dark:text-slate-200">' + escapeHtml(f.name) + '</span> ' + typeBadge;
          html += ' <span class="text-slate-400">' + (f.nsfw ? 'NSFW' : 'SFW') + (f.is_public ? ' public' : '') + '</span>';
          html += membersHtml + '</div></div>';
          html += '<div class="flex gap-1 flex-shrink-0">';
          if (canEdit) {
            html += '<button onclick="renameFilter(' + f.id + ')" class="text-xs text-indigo-400 hover:text-indigo-600">Edit</button>';
            html += '<button onclick="refreshFilterCache(' + f.id + ')" class="text-xs text-amber-400 hover:text-amber-600" title="Reconstruire le cache">&#x21bb;</button>';
            html += '<button onclick="deleteMFFilter(' + f.id + ')" class="text-xs text-rose-400 hover:text-rose-600">Del</button>';
          }
          html += '</div></div>';
        });
        el.innerHTML = html;
      } catch (e) {}
    }

    async function refreshFilterCache(id) {
      try {
        var r = await fetch(API + '/filters/' + id + '/refresh', { method: 'POST' });
        if (!r.ok) throw await safeJson(r);
        showModal('Cache', 'Cache du filtre regenere', 'success');
        loadManageFilters();
      } catch (err) {
        showModal('Erreur', err.error || 'Erreur', 'error');
      }
    }

    function renameFilter(id) {
      showPrompt('Renommer', 'Nouveau nom :', '', async function(name) {
        if (!name) return;
        try {
          var r = await fetch(API + '/filters/' + id, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name})
          });
          if (!r.ok) throw await safeJson(r);
          loadManageFilters();
          showModal('Filtre', 'Filtre renomme', 'success');
        } catch (err) {
          showModal('Erreur', err.error || '', 'error');
        }
      });
    }

    function deleteMFFilter(id) {
      showConfirm('Supprimer', 'Supprimer ce filtre ?', async function(ok) {
        if (!ok) return;
        try {
          var r = await fetch(API + '/filters/' + id, { method: 'DELETE' });
          if (!r.ok) throw await safeJson(r);
          loadManageFilters();
          showModal('Filtre', 'Filtre supprime', 'success');
        } catch (err) {
          showModal('Erreur', err.error || '', 'error');
        }
      });
    }

    async function previewFilterCache(filterId) {
      try {
        var r = await fetch(API + '/filters/' + filterId + '/preview');
        if (!r.ok) return;
        var d = await r.json();
        var kw = d.keywords && d.keywords.length > 0 ? d.keywords.slice(0,8).join(', ') : 'aucun' ;
        showModal('Cache du filtre', d.total + ' mots-cles dans le cache.\n\nEchantillon: ' + kw, 'success');
      } catch (e) {}
    }

    function clearStyleForm() {
      document.getElementById('style-form-name').value = '';
      document.getElementById('style-form-name').dataset.editId = '';
      document.getElementById('style-form-text').value = '';
      document.getElementById('style-form-neg').value = '';
      document.getElementById('style-form-public').checked = false;
      document.getElementById('btn-style-save').textContent = 'Ajouter';
      document.getElementById('btn-style-clear').classList.add('hidden');
    }

    function clearStyleFormTab() {
      document.getElementById('t-style-form-name').value = '';
      document.getElementById('t-style-form-name').dataset.editId = '';
      document.getElementById('t-style-form-text').value = '';
      document.getElementById('t-style-form-neg').value = '';
      document.getElementById('t-style-form-public').checked = false;
      document.getElementById('btn-t-style-save').textContent = 'Ajouter';
      document.getElementById('btn-t-style-clear').classList.add('hidden');
    }

    function editStyleTab(id) {
      fetch(API + '/styles').then(function(r){ return r.json(); }).then(function(styles){
        var s = styles.find(function(x){ return x.id === id; });
        if (!s) return;
        document.getElementById('t-style-form-name').value = s.name;
        document.getElementById('t-style-form-name').dataset.editId = id;
        document.getElementById('t-style-form-text').value = s.style_text;
        document.getElementById('t-style-form-neg').value = s.negative_prompt || '';
        document.getElementById('t-style-form-public').checked = s.is_public;
        document.getElementById('btn-t-style-save').textContent = 'Mettre a jour';
        document.getElementById('btn-t-style-clear').classList.remove('hidden');
      }).catch(function(){});
    }

    async function saveStyleTab() {
      var name = document.getElementById('t-style-form-name').value.trim();
      var text = document.getElementById('t-style-form-text').value.trim();
      var neg = document.getElementById('t-style-form-neg').value.trim();
      var isPublic = document.getElementById('t-style-form-public').checked ? 1 : 0;
      var editId = document.getElementById('t-style-form-name').dataset.editId;
      if (!name || !text) { showModal('Style', 'Nom et texte requis', 'error'); return; }
      try {
        var body = {name: name, style_text: text, negative_prompt: neg, is_public: isPublic};
        var endpoint = '/styles';
        var method = 'POST';
        if (editId) { endpoint = '/styles/' + editId; method = 'PUT'; }
        var r = await fetch(API + endpoint, {
          method: method,
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        });
        if (!r.ok) throw await safeJson(r);
        clearStyleFormTab();
        loadStylesTab();
        loadStyles();
        showModal('Style', editId ? 'Style mis a jour' : 'Style ajoute !', 'success');
      } catch (err) {
        showModal('Erreur', (err.error || ''), 'error');
      }
    }

    function delStyle(id) {
      showConfirm('Supprimer', 'Supprimer ce style ?', async function(ok){
        if (!ok) return;
        try {
          var r = await fetch(API + '/styles/' + id, { method: 'DELETE' });
          if (!r.ok) throw await safeJson(r);
          loadStyles();
        } catch (e) {
          showModal('Erreur', (e.error || e.message || 'Impossible de supprimer le style'), 'error');
        }
      });
    }

    // -- Enhance --

    /**
     * Appelle /api/enhance en mode client-side (LLM local).
     * Boucle multi-passes : pour chaque passe (1, 2, 3), on fait l'appel
     * Ollama local et on appelle /api/enhance/finish. Le backend peut
     * retourner awaiting_validation si une autre passe est necessaire.
     *
     * params: { text, preset_id, prompt_type, style_id, style_text,
     *           ep_elements, random_count, base_url, onProgress }
     * Retourne: { output, negative_prompt, model_used, debug_md }
     */
    async function callEnhanceLocalLLM(params) {
      var baseUrl = (params.base_url || '').replace(/\/+$/, '');
      if (!baseUrl) throw { error: 'URL du LLM local manquante' };

      // 1) /api/enhance/prepare : le backend construit le payload LLM passe 1
      if (params.onProgress) params.onProgress('Preparation du prompt (backend)...');
      var prepareBody = {
        text: params.text,
        preset_id: params.preset_id,
        prompt_type: params.prompt_type,
        style_id: params.style_id,
        style_text: params.style_text,
        ep_elements: params.ep_elements || [],
        random_count: params.random_count || 0
      };
      var prepareRes = await fetch(API + '/enhance/prepare', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(prepareBody)
      });
      if (!prepareRes.ok) {
        var err = await safeJson(prepareRes);
        throw { error: (err && err.error) || ('HTTP ' + prepareRes.status) };
      }
      var prep = await prepareRes.json();

      // 2) Boucle multi-passes
      var pass = 1;
      while (true) {
        if (params.onProgress) {
          if (pass === 1) params.onProgress('Appel LLM local (passe 1)...');
          else params.onProgress('Validation LLM local (passe ' + pass + ')...');
        }
        // Appel direct a Ollama local (ou tout LLM OpenAI-compatible)
        var llmUrl = baseUrl + '/chat/completions';
        var llmHeaders = {'Content-Type': 'application/json'};
        // Note : la cle API est deja dans llm_config.api_key, donc pas d'auth
        // explicite ici. Le backend l'a mise dans llm_config mais on ne l'utilise
        // pas car Ollama local n'en a pas besoin. Si un user met une cle custom
        // (ex: LM Studio avec auth), il faudrait l'ajouter ici.
        var llmRes = await fetch(llmUrl, {
          method: 'POST',
          headers: llmHeaders,
          body: JSON.stringify(prep.llm_request)
        });
        if (!llmRes.ok) {
          var errText = await llmRes.text().catch(function(){ return ''; });
          throw { error: 'LLM local erreur ' + llmRes.status + (errText ? ': ' + errText.substring(0, 200) : ' — verifie que CORS est active sur le serveur LLM') };
        }
        var llmResponse = await llmRes.json();

        // 3) /api/enhance/finish : le backend fait le post-traitement
        if (params.onProgress) params.onProgress('Post-traitement (backend)...');
        var finishRes = await fetch(API + '/enhance/finish', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            session_id: prep.session_id,
            llm_response: llmResponse,
            pass: pass
          })
        });
        if (!finishRes.ok) {
          var ferr = await safeJson(finishRes);
          throw { error: (ferr && ferr.error) || ('HTTP ' + finishRes.status) };
        }
        var fin = await finishRes.json();

        // 4) Statut
        if (fin.status === 'done') {
          if (params.onProgress) params.onProgress('Terminé !');
          return {
            output: fin.output,
            negative_prompt: fin.negative_prompt,
            model_used: fin.model_used,
            debug_md: fin.debug_md
          };
        }
        if (fin.status === 'awaiting_validation') {
          // Le backend veut une autre passe : reboucle avec le nouveau llm_request
          prep.llm_request = fin.llm_request;
          pass = fin.pass;
          continue;
        }
        // Statut inconnu
        throw { error: 'Statut inattendu du backend: ' + fin.status };
      }
    }

    async function doEnhance() {
      var text = document.getElementById('enhance-input').value.trim();
      var presetId = document.getElementById('enhance-preset').value;
      var promptType = document.getElementById('enhance-type').value;
      var styleId = document.getElementById('enhance-style').value;
      var useEP = document.getElementById('enhance-ep').checked;
      var useRandom = document.getElementById('enhance-random').checked;
      var randomCount = parseInt(document.getElementById('enhance-random-count').value) || 3;

      if (!text && !useEP) { showModal('Enhance', 'Saisis un texte ou active Elements Picker', 'error'); return; }

      var statusEl = document.getElementById('enhance-status');
      statusEl.textContent = 'Generation en cours...';
      statusEl.classList.remove('hidden');

      // Si Elements Picker active, generer et fusionner
      var epItems = [];
      if (useEP) {
        for (var i = 0; i < genElements.length; i++) {
          var el = genElements[i];
          if (el.type === 'filter' && el.filterId) epItems.push({type: 'filter', id: el.filterId});
          else if (el.type === 'text' && el.text) epItems.push({type: 'text', text: el.text});
        }
        // Afficher aussi dans l'output de l'Elements Picker
        try {
          var epRes = await fetch(API + '/generate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({elements: epItems})
          });
          if (epRes.ok) {
            var epData = await epRes.json();
            document.getElementById('gen-output').value = epData.prompt;
          }
        } catch (e) {}
      }

      // Recuperer le texte du style
      var styleText = '';
      if (styleId) {
        try {
          var sr = await fetch(API + '/styles');
          if (sr.ok) {
            var styles = await sr.json();
            var s = styles.find(function(x){ return x.id === parseInt(styleId); });
            if (s) styleText = s.style_text;
          }
        } catch (e) {}
      }

      // Verifier si le preset est client-side
      var isClientSide = false;
      var csUrl = '', csModel = '';
      if (presetId) {
        try {
          var pr = await fetch(API + '/presets');
          if (pr.ok) {
            var presets = await pr.json();
            var p = presets.find(function(x){ return x.id === parseInt(presetId); });
            if (p && p.is_client_side) {
              isClientSide = true;
              csUrl = p.base_url || '';
              csModel = p.model || '';
            }
          }
        } catch (e) {}
      }

      try {
        var data;
        if (isClientSide && csUrl) {
          // ── Mode client-side (LLM local) : boucle multi-passes ──────────
          // On utilise /api/enhance/prepare (construit le payload LLM cote backend
          // avec tous les templates/system_prompt/exemples), puis on fait les appels
          // Ollama local directement depuis le navigateur, puis /api/enhance/finish
          // orchestre les passes de validation.
          data = await callEnhanceLocalLLM({
            text: text,
            preset_id: presetId ? parseInt(presetId) : null,
            prompt_type: promptType,
            style_id: styleId ? parseInt(styleId) : null,
            style_text: styleText,
            ep_elements: epItems,
            random_count: useRandom ? randomCount : 0,
            base_url: csUrl,
            onProgress: function(msg) { statusEl.textContent = msg; }
          });
        } else {
          // Appel via backend (streaming ndjson : keepalive + result final)
          var body = {
            text: text,
            preset_id: presetId ? parseInt(presetId) : null,
            prompt_type: promptType,
            style_id: styleId ? parseInt(styleId) : null,
            style_text: styleText,
            ep_elements: epItems,
            random_count: useRandom ? randomCount : 0
          };
          var res = await fetch(API + '/enhance', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
          });
          if (!res.ok) throw await safeJson(res);
          // Lire les chunks ndjson et garder le dernier status='done'
          var text2 = await res.text();
          data = {output: ''};
          for (var i = 0; i < text2.split('\n').length; i++) {
            var line = text2.split('\n')[i];
            if (!line.trim()) continue;
            try {
              var chunk = JSON.parse(line);
              if (chunk.status === 'done') {
                data = chunk;
              } else if (chunk.status === 'error') {
                throw {error: chunk.error || 'Erreur LLM'};
              }
            } catch (e) {
              if (e && e.error) throw e;
              // sinon ignorer la ligne (parse error)
            }
          }
        }
        document.getElementById('enhance-output').value = data.output;
        document.getElementById('btn-copy-enhance').classList.remove('hidden');
        document.getElementById('btn-toggle-view').classList.remove('hidden');
        statusEl.classList.add('hidden');
        saveEnhancerSettings();
      } catch (err) {
        statusEl.classList.add('hidden');
        showModal('Erreur', (err.error || 'Erreur de generation'), 'error');
      }
    }

    function copyEnhanceOutput() {
      var el = document.getElementById('enhance-output');
      el.select();
      document.execCommand('copy');
      showModal('Copie', 'Prompt copie !', 'success');
    }

    function toggleEnhanceView() {
      var ta = document.getElementById('enhance-output');
      var div = document.getElementById('enhance-output-rendered');
      var btn = document.getElementById('btn-toggle-view');
      if (div.classList.contains('hidden')) {
        // Passer en mode rendu (texte brut, sauts de ligne)
        var raw = ta.value;
        div.innerHTML = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        ta.classList.add('hidden');
        div.classList.remove('hidden');
        btn.textContent = 'Brut';
      } else {
        div.classList.add('hidden');
        ta.classList.remove('hidden');
        btn.textContent = 'Rendu';
      }
    }

    // Charger presets et styles au demarrage
    async function loadEnhancerConfig() {
      await loadPresets();
      await loadStyles();
      // Restaurer les autres preferences sauvegardees
      if (currentUser && currentUser.settings) {
        var s = currentUser.settings;
        if (s.enhanceType) document.getElementById('enhance-type').value = s.enhanceType;
        if (s.enhanceInput) document.getElementById('enhance-input').value = s.enhanceInput;
        if (s.enhanceEP) document.getElementById('enhance-ep').checked = s.enhanceEP;
        if (s.enhanceRandom) {
          document.getElementById('enhance-random').checked = s.enhanceRandom;
          document.getElementById('enhance-random-count').disabled = !s.enhanceRandom;
          if (s.enhanceRandomCount) document.getElementById('enhance-random-count').value = s.enhanceRandomCount;
        }
        if (s.enhanceOutput) {
          document.getElementById('enhance-output').value = s.enhanceOutput;
          document.getElementById('btn-copy-enhance').classList.remove('hidden');
          document.getElementById('btn-toggle-view').classList.remove('hidden');
        }
      }
      // Sauvegarde auto au changement
      var elPreset = document.getElementById('enhance-preset');
      var elType = document.getElementById('enhance-type');
      var elStyle = document.getElementById('enhance-style');
      var elInput = document.getElementById('enhance-input');
      elPreset.onchange = saveEnhancerSettings;
      elType.onchange = saveEnhancerSettings;
      elStyle.onchange = saveEnhancerSettings;
      elInput.oninput = function() { clearTimeout(elInput._saveTimer); elInput._saveTimer = setTimeout(saveEnhancerSettings, 800); };
      // Toggle random count
      var randCb = document.getElementById('enhance-random');
      var randNum = document.getElementById('enhance-random-count');
      if (randCb && randNum) {
        randCb.onchange = function() { randNum.disabled = !this.checked; };
        randNum.disabled = !randCb.checked;
      }
    }

    var _saveSettingsBusy = false;
    async function saveEnhancerSettings() {
      if (_saveSettingsBusy || !currentUser) return;
      _saveSettingsBusy = true;
      var settings = currentUser.settings || {};
      settings.enhancePresetId = document.getElementById('enhance-preset').value || null;
      settings.enhanceStyleId = document.getElementById('enhance-style').value || null;
      settings.enhanceType = document.getElementById('enhance-type').value;
      settings.enhanceEP = document.getElementById('enhance-ep').checked;
      settings.enhanceRandom = document.getElementById('enhance-random').checked;
      settings.enhanceRandomCount = document.getElementById('enhance-random-count').value;
      settings.enhanceInput = document.getElementById('enhance-input').value;
      settings.enhanceOutput = document.getElementById('enhance-output').value || null;
      try {
        var r = await fetch(API + '/settings', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(settings)
        });
        if (r.ok) currentUser.settings = settings;
      } catch (e) {}
      _saveSettingsBusy = false;
    }


    // === Modale generique ===
    var modalCallback = null;
    var modalType = '';

    function showModal(title, msg, type) {
      document.getElementById('modal-generic-title').textContent = title;
      document.getElementById('modal-generic-body').textContent = msg;
      document.getElementById('modal-generic-input-area').classList.add('hidden');
      document.getElementById('modal-generic-cancel').classList.add('hidden');
      document.getElementById('modal-generic-ok').textContent = 'OK';
      var header = document.getElementById('modal-generic-header');
      if (type === 'error') {
        var okBtn = document.getElementById('modal-generic-ok');
        okBtn.className = 'px-3 py-1.5 text-sm font-medium bg-rose-600 text-white rounded-md hover:bg-rose-500';
        header.className = header.className.replace('bg-slate-50','bg-rose-50').replace('dark:bg-slate-800/80','dark:bg-rose-900/20');
      } else if (type === 'success') {
        var okBtn = document.getElementById('modal-generic-ok');
        okBtn.className = 'px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-500';
        header.className = header.className.replace('bg-slate-50','bg-emerald-50').replace('dark:bg-slate-800/80','dark:bg-emerald-900/20');
      } else {
        var okBtn = document.getElementById('modal-generic-ok');
        okBtn.className = 'px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-500';
      }
      modalType = type || '';
      modalCallback = null;
      document.getElementById('modal-generic').classList.remove('hidden');
      document.getElementById('modal-generic').classList.add('flex');
    }

    function showConfirm(title, msg, cb) {
      document.getElementById('modal-generic-title').textContent = title;
      document.getElementById('modal-generic-body').textContent = msg;
      document.getElementById('modal-generic-input-area').classList.add('hidden');
      document.getElementById('modal-generic-cancel').classList.remove('hidden');
      document.getElementById('modal-generic-ok').textContent = 'Oui';
      document.getElementById('modal-generic-ok').className = 'px-3 py-1.5 text-sm font-medium bg-rose-600 text-white rounded-md hover:bg-rose-500';
      modalType = 'confirm';
      modalCallback = cb;
      document.getElementById('modal-generic').classList.remove('hidden');
      document.getElementById('modal-generic').classList.add('flex');
    }

    function showPrompt(title, msg, placeholder, cb) {
      document.getElementById('modal-generic-title').textContent = title;
      document.getElementById('modal-generic-body').textContent = msg;
      document.getElementById('modal-generic-input-area').classList.remove('hidden');
      document.getElementById('modal-generic-input').value = '';
      document.getElementById('modal-generic-input').placeholder = placeholder || '';
      document.getElementById('modal-generic-input').focus();
      document.getElementById('modal-generic-cancel').classList.remove('hidden');
      document.getElementById('modal-generic-ok').textContent = 'OK';
      document.getElementById('modal-generic-ok').className = 'px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-500';
      modalType = 'prompt';
      modalCallback = cb;
      document.getElementById('modal-generic').classList.remove('hidden');
      document.getElementById('modal-generic').classList.add('flex');
    }

    function closeModal() {
      document.getElementById('modal-generic').classList.add('hidden');
      document.getElementById('modal-generic').classList.remove('flex');
      var header = document.getElementById('modal-generic-header');
      header.className = 'border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between cursor-grab dark:border-slate-700 dark:bg-slate-800/80 select-none';
      modalCallback = null;
    }

    function modalOK() {
      var result = null;
      if (modalType === 'confirm') result = true;
      if (modalType === 'prompt') result = document.getElementById('modal-generic-input').value.trim() || null;
      var cb = modalCallback;
      closeModal();
      if (cb && result !== null) cb(result);
    }

    // Drag pour la modale generique
    document.addEventListener('DOMContentLoaded', function() {
      makeModalDraggable('modal-generic-header', 'modal-generic');
    });

    // === Panneau Admin ===
    function toggleAdmin() {
      var panel = document.getElementById('admin-panel');
      var isOpen = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      if (!isOpen) {
        loadAdminUsers();
        loadOllamaConfig();
      }
    }

    function toggleMembers() {
      var panel = document.getElementById('members-panel');
      panel.classList.remove('hidden');
      loadMembersList();
    }

    function closeMembers() {
      document.getElementById('members-panel').classList.add('hidden');
    }

    function closeMemberDetail() {
      document.getElementById('modal-member-detail').classList.add('hidden');
      document.getElementById('modal-member-detail').classList.remove('flex');
    }

    async function openMemberDetail(userId) {
      var modal = document.getElementById('modal-member-detail');
      var body = document.getElementById('member-detail-body');
      var nameEl = document.getElementById('member-detail-name');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      makeModalDraggable('member-detail-header', 'member-detail-modal');
      body.innerHTML = '<p class="text-xs text-slate-400">Chargement...</p>';
      try {
        var res = await fetch(API + '/members/' + userId);
        if (!res.ok) { body.innerHTML = '<p class="text-xs text-red-400">Erreur</p>'; return; }
        var m = await safeJson(res);
        nameEl.textContent = m.display_name || m.username || 'Membre';
        var avatarHtml = m.avatar_url
          ? '<img src="' + m.avatar_url + '" class="w-20 h-20 rounded-full mx-auto border-2 border-slate-300 dark:border-slate-600">'
          : '<div class="w-20 h-20 rounded-full bg-slate-500 mx-auto flex items-center justify-center text-2xl text-white">' + escapeHtml((m.display_name || m.username || '?')[0]) + '</div>';
        var statsHtml = '<div class="grid grid-cols-2 gap-2 text-center text-xs">'
          + '<div class="bg-slate-50 dark:bg-slate-700/50 rounded p-2"><span class="block text-lg font-bold text-indigo-600 dark:text-indigo-400">' + (m.filter_count || 0) + '</span><span class="text-slate-500">filtres</span></div>'
          + '<div class="bg-slate-50 dark:bg-slate-700/50 rounded p-2"><span class="block text-lg font-bold text-indigo-600 dark:text-indigo-400">' + (m.prompt_count || 0) + '</span><span class="text-slate-500">prompts</span></div>'
          + '</div>';
        var favHtml = '';
        if (m.favorite_type || m.favorite_style) {
          favHtml = '<div class="text-xs space-y-1"><p class="text-slate-500 font-semibold mb-1">Preferes</p>';
          if (m.favorite_type) favHtml += '<p><span class="text-slate-400">Type :</span> <span class="text-slate-700 dark:text-slate-300">' + m.favorite_type.toUpperCase() + '</span></p>';
          if (m.favorite_style) favHtml += '<p><span class="text-slate-400">Style :</span> <span class="text-slate-700 dark:text-slate-300">' + escapeHtml(m.favorite_style) + '</span></p>';
          favHtml += '</div>';
        }
        var promptsHtml = '<p class="text-xs text-slate-500 font-semibold">Derniers prompts</p>';
        if (m.recent_prompts && m.recent_prompts.length > 0) {
          promptsHtml += '<div class="space-y-1 max-h-80 overflow-y-auto">';
          m.recent_prompts.forEach(function(p) {
            var text = p.output_text || '';
            var date = p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : '';
            promptsHtml += '<div class="text-xs p-2 rounded bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700">'
              + '<span class="text-indigo-500 font-medium">' + (p.prompt_type || '').toUpperCase() + '</span>'
              + ' <span class="text-slate-400">' + date + '</span><br>'
              + '<span class="text-slate-600 dark:text-slate-400" style="word-break:break-word;">' + escapeHtml(text) + '</span></div>';
          });
          promptsHtml += '</div>';
        } else {
          promptsHtml += '<p class="text-xs text-slate-400 italic">Aucun prompt genere</p>';
        }
        body.innerHTML = '<div class="space-y-3">'
          + '<div class="text-center">' + avatarHtml + '</div>'
          + '<div class="text-center text-xs text-slate-500">' + (m.role === 'admin' ? 'Admin' : 'Membre') + '</div>'
          + statsHtml
          + (favHtml ? '<hr class="border-slate-200 dark:border-slate-700">' + favHtml : '')
          + '<hr class="border-slate-200 dark:border-slate-700">'
          + promptsHtml
          + '</div>';
      } catch (err) {
        body.innerHTML = '<p class="text-xs text-red-400">Erreur : ' + err.message + '</p>';
      }
    }

    // === Settings (API Key) ===

    function toggleSettings() {
      toggleMergedSettings();
    }

    function closeSettings() {
      closeMergedSettings();
    }

    async function loadApiKey() {
      var nameEl = document.getElementById('settings-username');
      if (currentUser) nameEl.textContent = currentUser.display_name || currentUser.username;
      var input = document.getElementById('settings-api-key');
      input.value = 'Chargement...';
      try {
        var res = await fetch(API + '/auth/token');
        if (!res.ok) throw new Error('Erreur ' + res.status);
        var data = await res.json();
        if (data.token) {
          input.value = data.token;
        } else {
          input.value = 'Erreur : pas de token';
        }
      } catch (err) {
        input.value = 'Erreur : ' + err.message;
      }
    }

    async function regenerateApiKey() {
      if (!confirm('Regénérer la clé API ? L\'ancienne clé ne fonctionnera plus.')) return;
      var statusEl = document.getElementById('settings-key-status');
      statusEl.className = 'text-xs mt-2 text-amber-500';
      statusEl.textContent = 'Regénération...';
      statusEl.classList.remove('hidden');
      try {
        var res = await fetch(API + '/auth/token', { method: 'POST' });
        if (!res.ok) throw new Error('Erreur ' + res.status);
        var data = await res.json();
        document.getElementById('settings-api-key').value = data.token || '';
        statusEl.className = 'text-xs mt-2 text-emerald-500';
        statusEl.textContent = 'Nouvelle clé générée !';
      } catch (err) {
        statusEl.className = 'text-xs mt-2 text-rose-500';
        statusEl.textContent = 'Erreur : ' + err.message;
      }
    }

    function copyApiKey() {
      var input = document.getElementById('settings-api-key');
      input.select();
      input.setSelectionRange(0, 99999);
      navigator.clipboard.writeText(input.value).then(function() {
        var statusEl = document.getElementById('settings-key-status');
        statusEl.className = 'text-xs mt-2 text-emerald-500';
        statusEl.textContent = 'Copié !';
        statusEl.classList.remove('hidden');
        setTimeout(function() { statusEl.classList.add('hidden'); }, 2000);
      }).catch(function() {
        document.execCommand('copy');
      });
    }

    async function loadMembersList() {
      var container = document.getElementById('members-list');
      container.innerHTML = '<p class="text-sm text-slate-400">Chargement...</p>';
      try {
        var res = await fetch(API + '/members');
        if (!res.ok) {
          container.innerHTML = '<p class="text-sm text-rose-500">Erreur ' + res.status + '</p>';
          return;
        }
        var users = await res.json();
        container.innerHTML = users.map(function(u) {
          var avatar = u.avatar
            ? '<img src="https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=32" class="w-6 h-6 rounded-full inline-block">'
            : '<span class="w-6 h-6 rounded-full bg-slate-500 inline-flex items-center justify-center text-xs text-white">' + escapeHtml((u.display_name || u.username)[0]) + '</span>';
          var badge = u.role === 'admin'
            ? '<span class="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">admin</span>'
            : '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400">user</span>';
          return '<div class="flex items-center gap-2.5 p-2 rounded bg-slate-50 dark:bg-slate-700/30 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition" onclick="openMemberDetail(\'' + u.id + '\')">'
            + avatar + ' '
            + '<span class="flex-1 text-sm text-slate-700 dark:text-slate-300">' + escapeHtml(u.display_name || u.username) + '</span>'
            + ' ' + badge
            + '</div>';
        }).join('');
      } catch (err) {
        container.innerHTML = '<p class="text-sm text-rose-500">Erreur reseau</p>';
      }
    }

    async function loadAdminUsers() {
      var container = document.getElementById('admin-users-list');
      container.innerHTML = '<p class="text-sm text-slate-400">Chargement...</p>';
      try {
        var res = await fetch(API + '/admin/users');
        if (!res.ok) {
          var err = await res.json().catch(function(){ return {}; });
          container.innerHTML = '<p class="text-sm text-rose-500">Erreur ' + res.status + ' : ' + (err.error || 'Acces refuse') + '</p>';
          return;
        }
        var users = await res.json();
        container.innerHTML = users.map(function(u) {
          var isYou = currentUser && u.id === currentUser.id;
          var badge = u.role === 'admin'
            ? '<span class="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">admin</span>'
            : '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400">user</span>';
          var avatar = u.avatar
            ? '<img src="https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=32" class="w-6 h-6 rounded-full inline-block">'
            : '<span class="w-6 h-6 rounded-full bg-slate-500 inline-flex items-center justify-center text-xs text-white">' + escapeHtml((u.display_name || u.username)[0]) + '</span>';
          var actions = '';
          if (u.role === 'user') {
            actions += '<button class="text-xs text-indigo-500 hover:text-indigo-400 transition" onclick="changeRole(\'' + u.id + '\',\'admin\')">Promouvoir</button>';
          } else if (!isYou) {
            actions += '<button class="text-xs text-amber-500 hover:text-amber-400 transition" onclick="changeRole(\'' + u.id + '\',\'user\')">Retrograder</button>';
          }
          if (!isYou) {
            actions += ' <button class="text-xs text-rose-500 hover:text-rose-400 transition" onclick="deleteUser(\'' + u.id + '\')">Supprimer</button>';
          }
          var youTag = isYou ? ' <span class="text-xs text-slate-400">(toi)</span>' : '';
          return '<div class="flex items-center gap-2.5 p-2 rounded bg-slate-50 dark:bg-slate-700/30">'
            + avatar + ' '
            + '<span class="flex-1 text-sm text-slate-700 dark:text-slate-300">' + escapeHtml(u.display_name || u.username) + youTag + '</span>'
            + ' ' + badge
            + (actions ? ' <span class="text-xs text-slate-400">|</span> ' + actions : '')
            + '</div>';
        }).join('');
      } catch (err) {
        container.innerHTML = '<p class="text-sm text-rose-500">Erreur reseau : ' + (err.message || 'impossible') + '</p>';
      }
    }

    async function changeRole(userId, role) {
      try {
        var res = await fetch(API + '/admin/users/' + encodeURIComponent(userId) + '/role', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({role: role})
        });
        if (res.ok) loadAdminUsers();
      } catch (err) {
        showModal('Erreur', err.message || 'Action impossible', 'error');
      }
    }

    async function deleteUser(userId) {
      showConfirm('Suppression', 'Supprimer cet utilisateur et tous ses mots-cles ?', async function(ok) {
        if (!ok) return;
        try {
          var res = await fetch(API + '/admin/users/' + encodeURIComponent(userId), {method: 'DELETE'});
          if (res.ok) loadAdminUsers();
        } catch (err) {
          showModal('Erreur', err.message || 'Une erreur est survenue', 'error');
        }
      });
    }

    async function loadOllamaConfig() {
      try {
        var res = await fetch(API + '/admin/settings/ollama');
        if (!res.ok) return;
        var data = await res.json();
        document.getElementById('admin-ollama-url').value = data.url || 'http://localhost:11434';
        document.getElementById('admin-ollama-model').value = data.model || 'nomic-embed-text';
        var st = document.getElementById('admin-ollama-status');
        st.textContent = 'OK';
        st.className = 'text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400';
      } catch (err) {
        var st = document.getElementById('admin-ollama-status');
        st.textContent = 'Erreur';
        st.className = 'text-xs px-2 py-1 rounded bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400';
      }
    }

    async function saveOllamaConfig() {
      var url = document.getElementById('admin-ollama-url').value.trim();
      var model = document.getElementById('admin-ollama-model').value.trim();
      if (!url || !model) { showModal('Config', 'URL et modele requis', 'error'); return; }
      try {
        var res = await fetch(API + '/admin/settings/ollama', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({url: url, model: model})
        });
        if (res.ok) {
          var st = document.getElementById('admin-ollama-status');
          st.textContent = 'Sauvegarde OK';
          st.className = 'text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400';
        } else {
          var err = await res.json();
          showModal('Erreur', err.error || '', 'error');
        }
      } catch (err) {
        showModal('Erreur', err.message || '', 'error');
      }
    }

    async function adminClearDb() {
      showConfirm('Vider la BDD', 'Vider la base de donnees ? Cette action est irreversible.', async function(ok) {
        if (!ok) return;
        try {
          var res = await fetch(API + '/admin/db/clear', {method: 'POST'});
          if (res.ok) {
            toggleAdmin();
            await checkAuth();
            await checkData();
          }
        } catch (err) {
          showModal('Erreur', err.message || 'Action impossible', 'error');
        }
      });
    }

    // === Layout panneaux redimensionnables ===
    function initResizablePanels() {
      var dividerV = document.getElementById('divider-v');
      var dividerH = document.getElementById('divider-h');
      var panelLeft = document.getElementById('panel-left');
      var panelRightTop = document.getElementById('panel-right-top');

      if (dividerV) {
        dividerV.addEventListener('mousedown', function(e) {
          e.preventDefault();
          var startX = e.clientX;
          var startW = panelLeft.offsetWidth;
          var parentW = document.getElementById('panels-container').offsetWidth;

          function onMove(ev) {
            var dx = ev.clientX - startX;
            var pct = Math.max(15, Math.min(85, (startW + dx) / parentW * 100));
            panelLeft.style.width = pct + '%';
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveLayout();
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      if (dividerH) {
        dividerH.addEventListener('mousedown', function(e) {
          e.preventDefault();
          var startY = e.clientY;
          var startH = panelRightTop.offsetHeight;
          var parentH = panelRightTop.parentElement.offsetHeight;

          function onMove(ev) {
            var dy = ev.clientY - startY;
            var pct = Math.max(10, Math.min(90, (startH + dy) / parentH * 100));
            panelRightTop.style.height = pct + '%';
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveLayout();
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }
    }

    function saveLayout() {
      if (!currentUser) return;
      var leftPct = Math.round(parseFloat(document.getElementById('panel-left').style.width) || 50);
      var topPct = Math.round(parseFloat(document.getElementById('panel-right-top').style.height) || 50);
      var settings = (currentUser.settings || {});
      settings.layout = { left_width: leftPct, right_top_height: topPct };
      // Save to server (fire and forget)
      fetch(API + '/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(settings)
      }).catch(function(){});
    }

    function loadLayout() {
      if (!currentUser || !currentUser.settings) return;
      var layout = currentUser.settings.layout;
      if (!layout) return;
      var panelLeft = document.getElementById('panel-left');
      var panelRightTop = document.getElementById('panel-right-top');
      if (layout.left_width && panelLeft) panelLeft.style.width = layout.left_width + '%';
      if (layout.right_top_height && panelRightTop) panelRightTop.style.height = layout.right_top_height + '%';
    }

    // === Colonnes redimensionnables ===
    var colResizeActive = null;

    function initColResize() {
      var headers = document.querySelectorAll('#table-header-row th');
      // Initialiser les largeurs si pas encore fait (en px explicite)
      if (!headers[0] || headers[0].style.width) return;
      var widths = [200, 400, 180, 100]; // valeurs par defaut
      for (var i = 0; i < headers.length; i++) {
        var w = headers[i].offsetWidth || widths[i] || 150;
        headers[i].style.width = w + 'px';
      }

      headers.forEach(function(th, idx) {
        if (idx === headers.length - 1) return;
        if (th.querySelector('.col-resize-handle')) return;
        var handle = document.createElement('div');
        handle.className = 'col-resize-handle';
        handle.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();  // empecher le drag des modales
          var next = headers[idx + 1];
          colResizeActive = {
            th: th, nextTh: next,
            startX: e.clientX,
            w: th.offsetWidth,
            wNext: next.offsetWidth,
            idx: idx
          };
          document.body.classList.add('col-resizing');
        }, true);  // capturer en phase de capture
        th.appendChild(handle);
      });
    }

    document.addEventListener('mousemove', function(e) {
      if (!colResizeActive) return;
      var dx = e.clientX - colResizeActive.startX;
      var w = Math.max(50, colResizeActive.w + dx);
      var wNext = Math.max(50, colResizeActive.wNext - dx);
      var i = colResizeActive.idx;
      colResizeActive.th.style.width = w + 'px';
      colResizeActive.nextTh.style.width = wNext + 'px';
      // Appliquer aux cellules
      var rows = document.querySelectorAll('#table-body tr');
      for (var r = 0; r < rows.length; r++) {
        var tds = rows[r].children;
        if (tds[i]) tds[i].style.width = w + 'px';
        if (tds[i+1]) tds[i+1].style.width = wNext + 'px';
      }
    });

    document.addEventListener('mouseup', function() {
      if (colResizeActive) {
        colResizeActive = null;
        document.body.classList.remove('col-resizing');
        saveColWidths();
      }
    });

    function saveColWidths() {
      if (!currentUser) return;
      var headers = document.querySelectorAll('#table-header-row th');
      var widths = {};
      headers.forEach(function(th, idx) {
        var txt = th.textContent.trim().toLowerCase().replace(/[^a-z]/g, '') || 'col' + idx;
        widths[txt] = th.offsetWidth;
      });
      var settings = (currentUser.settings || {});
      settings.columns = widths;
      fetch(API + '/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(settings)
      }).catch(function(){});
    }

    function loadColWidths() {
      if (!currentUser || !currentUser.settings || !currentUser.settings.columns) return;
      var headers = document.querySelectorAll('#table-header-row th');
      var cols = currentUser.settings.columns;
      headers.forEach(function(th, idx) {
        var txt = th.textContent.trim().toLowerCase().replace(/[^a-z]/g, '') || 'col' + idx;
        var w = cols[txt];
        if (w && w > 50) {
          th.style.width = w + 'px';
          var rows = document.querySelectorAll('#table-body tr');
          for (var r = 0; r < rows.length; r++) {
            var td = rows[r].children[idx];
            if (td) td.style.width = w + 'px';
          }
        }
      });
    }

    // Drag unifie pour toutes les modales
    function makeModalDraggable(headerId, modalId) {
      var drag = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
      var header = document.getElementById(headerId);
      var modal = document.getElementById(modalId);
      if (!header || !modal) return;
      header.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.tagName === 'INPUT') return;
        drag.active = true;
        var rect = modal.getBoundingClientRect();
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.origX = rect.left;
        drag.origY = rect.top;
        modal.style.position = 'fixed';
        modal.style.left = rect.left + 'px';
        modal.style.top = rect.top + 'px';
        modal.style.transform = 'none';
        modal.style.margin = '0';
        header.style.cursor = 'grabbing';
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!drag.active) return;
        var dx = e.clientX - drag.startX;
        var dy = e.clientY - drag.startY;
        modal.style.left = (drag.origX + dx) + 'px';
        modal.style.top = (drag.origY + dy) + 'px';
      });
      document.addEventListener('mouseup', function() {
        if (drag.active) {
          drag.active = false;
          header.style.cursor = 'grab';
        }
      });
    }

    function makeModalResizable(modalId, opts) {
      opts = opts || {};
      var minW = opts.minW || 400;
      var minH = opts.minH || 300;
      var maxW = opts.maxW || window.innerWidth * 0.9;
      var maxH = opts.maxH || window.innerHeight * 0.9;
      var modal = document.getElementById(modalId);
      if (!modal) return;
      var directions = ['n','s','e','w','ne','nw','se','sw'];
      var handles = {};
      directions.forEach(function(dir) {
        var h = document.createElement('div');
        h.className = 'modal-resize-handle ' + dir;
        modal.appendChild(h);
        handles[dir] = h;
      });
      var resize = { active: false, dir: '', startX: 0, startY: 0, startW: 0, startH: 0, startL: 0, startT: 0 };
      function getStyle(name) { return parseFloat(modal.style[name]) || 0; }
      directions.forEach(function(dir) {
        handles[dir].addEventListener('mousedown', function(e) {
          e.preventDefault();
          var rect = modal.getBoundingClientRect();
          resize.active = true;
          resize.dir = dir;
          resize.startX = e.clientX;
          resize.startY = e.clientY;
          resize.startW = rect.width;
          resize.startH = rect.height;
          resize.startL = rect.left;
          resize.startT = rect.top;
          modal.classList.add('modal-resizing');
        });
      });
      document.addEventListener('mousemove', function(e) {
        if (!resize.active) return;
        var dir = resize.dir;
        var dx = e.clientX - resize.startX;
        var dy = e.clientY - resize.startY;
        var newW = resize.startW;
        var newH = resize.startH;
        var newL = resize.startL;
        var newT = resize.startT;
        if (dir.indexOf('e') >= 0) newW = Math.min(maxW, Math.max(minW, resize.startW + dx));
        if (dir.indexOf('w') >= 0) {
          newW = Math.min(maxW, Math.max(minW, resize.startW - dx));
          newL = resize.startL + (resize.startW - newW);
        }
        if (dir.indexOf('s') >= 0) newH = Math.min(maxH, Math.max(minH, resize.startH + dy));
        if (dir.indexOf('n') >= 0) {
          newH = Math.min(maxH, Math.max(minH, resize.startH - dy));
          newT = resize.startT + (resize.startH - newH);
        }
        modal.style.width = newW + 'px';
        modal.style.height = newH + 'px';
        modal.style.left = newL + 'px';
        modal.style.top = newT + 'px';
        // Update max-height on modal-body if present
        var body = modal.querySelector('.modal-body');
        if (body) {
          var header = modal.querySelector('[id$="-header"]') || modal.querySelector('[class*="header"]');
          var headerH = header ? header.offsetHeight : 0;
          body.style.maxHeight = (newH - headerH - 2) + 'px';
        }
      });
      document.addEventListener('mouseup', function() {
        if (resize.active) {
          resize.active = false;
          modal.classList.remove('modal-resizing');
        }
      });
    }

    // Initialiser le drag pour toutes les modales + panneaux
    document.addEventListener('DOMContentLoaded', function() {
      makeModalDraggable('admin-modal-header', 'admin-modal');
      makeModalDraggable('import-modal-header', 'import-modal');
      makeModalDraggable('members-modal-header', 'members-modal');
      makeModalResizable('usettings-modal', { minW: 480, minH: 400 });
      initResizablePanels();
    });
    // === Import / Export ===
    function openImport() {
      var el = document.getElementById('modal-import');
      el.classList.remove('hidden');
      el.classList.add('flex');
      document.getElementById('import-status').classList.add('hidden');
      document.getElementById('import-loading').classList.add('hidden');
    }
    function closeImport() {
      var el = document.getElementById('modal-import');
      el.classList.add('hidden');
      el.classList.remove('flex');
      document.getElementById('import-status').classList.add('hidden');
    }

    function handleFile(e) {
      const file = e.target.files?.[0];
      if (file) sendImport(file);
    }
    function handleDrop(e) {
      e.preventDefault();
      $('drop-zone').classList.remove('border-indigo-400','bg-indigo-50/30');
      const file = e.dataTransfer.files?.[0];
      if (file && file.name.endsWith('.md')) {
        sendImport(file);
      } else {
        showImportStatus(false, 'Déposez un fichier .md uniquement.');
      }
    }

    async function sendImport(file) {
      $('import-loading').classList.remove('hidden');
      $('import-status').classList.add('hidden');
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch(`${API}/import`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `Erreur ${res.status}`);
        showImportStatus(true, data.message || `${data.imported} importes` + (data.updated ? `, ${data.updated} mis a jour` : '') + (data.duplicates_skipped ? `, ${data.duplicates_skipped} ignores` : '') + '.');
        await checkData();
      } catch (err) {
        showImportStatus(false, err.message || 'Erreur lors de l\'import');
      } finally {
        $('import-loading').classList.add('hidden');
      }
    }

    function showImportStatus(ok, message) {
      const el = $('import-status');
      el.classList.remove('hidden');
      el.className = 'mt-4 text-sm rounded-md p-3 border ' + (ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200');
      el.textContent = message;
    }

    async function doExport() {
      try {
        const res = await fetch(`${API}/export`);
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Keywords-Export.md';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        showModal('Erreur', 'Export impossible : ' + err.message, 'error');
      }
    }
  