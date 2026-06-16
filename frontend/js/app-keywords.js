
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

    function esc(str) {
      if (typeof str !== 'string') return '';
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }


// ── Keywords Manager ─────────────────────────────────────────────

let kwEditingId = null;

function kwLoadList() {
    const search = document.getElementById('kw-filter-search').value.trim();
    const scope = document.getElementById('kw-filter-scope').value;
    const section = document.getElementById('kw-filter-section').value;
    const nsfw = document.getElementById('kw-filter-nsfw').value;

    const params = new URLSearchParams();
    if (search) params.append('q', search);
    if (scope) params.append('scope', scope);
    if (section) params.append('section', section);
    if (nsfw !== '') params.append('nsfw', nsfw);

    // Charger les sections pour le dropdown
    fetch(API + '/sections')
        .then(r => r.json())
        .then(sections => {
            const sel = document.getElementById('kw-filter-section');
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">Toutes sections</option>';
            sections.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.section_id;
                opt.textContent = s.section_id + '. ' + s.section_title;
                sel.appendChild(opt);
            });
            sel.value = currentVal;

            // Peupler les datalists section + sous-section
            var dlSection = document.getElementById('kw-section-list');
            dlSection.innerHTML = '';
            sections.forEach(s => {
                var opt = document.createElement('option');
                opt.value = s.section_id;
                opt.textContent = s.section_id + '. ' + s.section_title;
                dlSection.appendChild(opt);
            });
            // Charger les sous-sections pour le datalist
            fetch(API + '/subsections')
                .then(r => r.json())
                .then(subs => {
                    var dlSub = document.getElementById('kw-subsection-list');
                    dlSub.innerHTML = '';
                    subs.forEach(sub => {
                        var opt = document.createElement('option');
                        opt.value = sub.subsection_id;
                        opt.textContent = sub.subsection_id + ' — ' + sub.subsection_title;
                        dlSub.appendChild(opt);
                    });
                }).catch(() => {});
        }).catch(() => {});

    const list = document.getElementById('kw-list');
    list.innerHTML = '<p class="text-xs text-slate-400">Chargement...</p>';

    fetch(API + '/keywords?' + params.toString())
        .then(r => r.json())
        .then(data => {
            renderKwList(data);
        })
        .catch(() => {
            list.innerHTML = '<p class="text-xs text-rose-400">Erreur de chargement</p>';
        });

    // Vérifier si l'utilisateur est KW editor pour afficher le bouton pending
    checkKwEditorStatus();
}

function renderKwList(keywords) {
    const list = document.getElementById('kw-list');
    if (!keywords || keywords.length === 0) {
        list.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Aucun mot-clé trouvé</p>';
        return;
    }
    list.innerHTML = '';
    keywords.forEach(kw => {
        const privacyIcon = kw.privacy_status === 'public' ? '🌐' : (kw.privacy_status === 'public_pending' ? '🟡' : '🔒');
        const nsfwBadge = kw.nsfw ? '<span class="text-rose-400 text-[10px]">NSFW</span>' : '';
        const ownerLabel = kw.user_id ? '' : '<span class="text-[10px] text-slate-400">[global]</span>';
        const preview = (kw.description || '').substring(0, 60);

        const row = document.createElement('div');
        row.className = 'flex items-center gap-1.5 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer transition text-xs';
        row.innerHTML = '<span class="text-xs">' + privacyIcon + '</span>'
            + '<span class="flex-1 min-w-0"><strong class="text-slate-800 dark:text-slate-200">' + esc(kw.keyword) + '</strong>'
            + ' <span class="text-slate-400">' + esc(preview) + (preview.length >= 60 ? '...' : '') + '</span>'
            + '</span>'
            + nsfwBadge + ' ' + ownerLabel;
        row.onclick = () => kwEdit(kw);

        // Boutons actions
        const actions = document.createElement('div');
        actions.className = 'flex gap-1 shrink-0';

        const editBtn = document.createElement('button');
        editBtn.textContent = '✎';
        editBtn.className = 'text-slate-400 hover:text-indigo-500 p-0.5 text-xs';
        editBtn.title = 'Éditer';
        editBtn.onclick = (e) => { e.stopPropagation(); kwEdit(kw); };
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑';
        delBtn.className = 'text-slate-400 hover:text-rose-500 p-0.5 text-xs';
        delBtn.title = 'Supprimer';
        delBtn.onclick = (e) => { e.stopPropagation(); kwDelete(kw.id); };
        actions.appendChild(delBtn);

        row.appendChild(actions);
        list.appendChild(row);
    });
}

function kwEdit(kw) {
    kwEditingId = kw.id;
    document.getElementById('kw-form-title').textContent = '✎ Modifier ' + esc(kw.keyword);
    document.getElementById('kw-form-keyword').value = kw.keyword || '';
    document.getElementById('kw-form-desc').value = kw.description || '';
    document.getElementById('kw-form-section-id').value = kw.section_id || '';
    document.getElementById('kw-form-section-title').value = kw.section_title || '';
    document.getElementById('kw-form-subsection-id').value = kw.subsection_id || '';
    document.getElementById('kw-form-subsection-title').value = kw.subsection_title || '';
    document.getElementById('kw-form-nsfw').checked = !!kw.nsfw;
    document.getElementById('kw-form-privacy').value = kw.privacy_status || 'private';
    document.getElementById('btn-kw-save').textContent = 'Sauvegarder';
    document.getElementById('btn-kw-clear').classList.remove('hidden');
}

function kwAddNew() {
    kwEditingId = null;
    document.getElementById('kw-form-title').textContent = 'Nouveau mot-clé';
    document.getElementById('kw-form-keyword').value = '';
    document.getElementById('kw-form-desc').value = '';
    document.getElementById('kw-form-section-id').value = '';
    document.getElementById('kw-form-section-title').value = '';
    document.getElementById('kw-form-subsection-id').value = '';
    document.getElementById('kw-form-subsection-title').value = '';
    document.getElementById('kw-form-nsfw').checked = false;
    document.getElementById('kw-form-privacy').value = 'private';
    document.getElementById('btn-kw-save').textContent = 'Ajouter';
    document.getElementById('btn-kw-clear').classList.add('hidden');
}

function kwClearForm() {
    kwAddNew();
}

async function kwSave() {
    const keyword = document.getElementById('kw-form-keyword').value.trim();
    const description = document.getElementById('kw-form-desc').value.trim();
    const section_id = document.getElementById('kw-form-section-id').value.trim();
    const section_title = document.getElementById('kw-form-section-title').value.trim();
    const subsection_id = document.getElementById('kw-form-subsection-id').value.trim();
    const subsection_title = document.getElementById('kw-form-subsection-title').value.trim();
    const nsfw = document.getElementById('kw-form-nsfw').checked ? 1 : 0;
    const privacy = document.getElementById('kw-form-privacy').value;

    if (!keyword || !description) {
        showModal('Erreur', 'Mot-clé et description requis', 'error');
        return;
    }

    const body = {
        keyword, description,
        section_id, section_title,
        subsection_id, subsection_title,
        nsfw, privacy_status: privacy
    };

    try {
        let res;
        if (kwEditingId) {
            res = await fetch(API + '/keywords/' + kwEditingId, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            });
        } else {
            res = await fetch(API + '/keywords', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            });
        }
        const data = await safeJson(res);
        if (!res.ok) {
            showModal('Erreur', data.error || 'Erreur inconnue', 'error');
            return;
        }
        showModal('Succès', kwEditingId ? 'Mot-clé mis à jour' : 'Mot-clé créé', 'success');
        kwAddNew();
        kwLoadList();
    } catch (e) {
        showModal('Erreur', e.message, 'error');
    }
}

async function kwDelete(id) {
    showConfirm('Confirmer', 'Supprimer ce mot-clé ?', async (ok) => {
        if (!ok) return;
        try {
            const res = await fetch(API + '/keywords/' + id, { method: 'DELETE' });
            const data = await safeJson(res);
            if (!res.ok) {
                showModal('Erreur', data.error || 'Erreur', 'error');
                return;
            }
            if (kwEditingId === id) kwAddNew();
            kwLoadList();
        } catch (e) {
            showModal('Erreur', e.message, 'error');
        }
    });
}

async function kwCheckDuplicates() {
    const keyword = document.getElementById('kw-form-keyword').value.trim();
    if (!keyword) {
        showModal('Info', 'Entre d\'abord un mot-clé pour vérifier les doublons', 'info');
        return;
    }
    try {
        const res = await fetch(API + '/keywords/check-duplicates', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({keyword, threshold: 0.85})
        });
        const data = await safeJson(res);
        if (!res.ok) {
            showModal('Erreur', data.error || 'Erreur', 'error');
            return;
        }
        let msg = '';
        if (data.exact_matches && data.exact_matches.length > 0) {
            msg += '⚠️ <b>Doublons exacts :</b><br>';
            data.exact_matches.forEach(m => {
                msg += '• ' + esc(m.keyword) + ' (' + m.privacy_status + ')<br>';
            });
        }
        if (data.semantic_matches && data.semantic_matches.length > 0) {
            msg += '<br>🔍 <b>Similaires (≥85%) :</b><br>';
            data.semantic_matches.forEach(m => {
                msg += '• ' + esc(m.keyword) + ' (' + (m.similarity * 100).toFixed(0) + '%)<br>';
            });
        }
        if (!msg) msg = '✅ Aucun doublon trouvé';
        showModal('Résultat vérification', msg, data.exact_matches.length > 0 ? 'warning' : 'success');
    } catch (e) {
        showModal('Erreur', e.message, 'error');
    }
}

// ── Bulk Import ─────────────────────────────────────────────────

function kwOpenBulkImport() {
    document.getElementById('modal-bulk-import').classList.remove('hidden');
    document.getElementById('modal-bulk-import').classList.add('flex');
    document.getElementById('bi-text').value = '';
    document.getElementById('bi-result').classList.add('hidden');
    makeModalDraggable('bi-modal-header', 'bi-modal');
}

let _bulkParsedLines = null;
let _bulkFileContent = '';
let _bulkRowIdCounter = 0;
let _bulkExistingSet = null; // Set of LOWER(keyword) from DB

function closeBulkImport() {
    document.getElementById('modal-bulk-import').classList.add('hidden');
    document.getElementById('modal-bulk-import').classList.remove('flex');
    document.getElementById('bi-preview').classList.add('hidden');
    document.getElementById('bi-preview').innerHTML = '';
    document.getElementById('bi-result').classList.add('hidden');
    document.getElementById('bi-dropzone-text').textContent = 'Clique pour choisir un fichier';
    document.getElementById('bi-filename').classList.add('hidden');
    document.getElementById('bi-filename').textContent = '';
    document.getElementById('btn-bi-confirm').classList.add('hidden');
    document.getElementById('bi-file').value = '';
    _bulkParsedLines = null;
    _bulkFileContent = '';
    _bulkExistingSet = null;
}

function kwBulkFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('bi-filename').textContent = '📄 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' Ko)';
    document.getElementById('bi-filename').classList.remove('hidden');
    document.getElementById('bi-dropzone-text').textContent = 'Clique pour changer de fichier';
    document.getElementById('bi-result').classList.add('hidden');

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        _bulkFileContent = text;
        _parseAndShowPreview(text);
    };
    reader.onerror = function() {
        showModal('Erreur', 'Impossible de lire le fichier', 'error');
    };
    reader.readAsText(file);
}

function _parseAndShowPreview(text) {
    const previewDiv = document.getElementById('bi-preview');
    const resultDiv = document.getElementById('bi-result');
    resultDiv.classList.add('hidden');
    _bulkExistingSet = null; // Reset duplicate cache

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const rows = [];
    const errors = [];

    _bulkRowIdCounter = 0;

    lines.forEach((line, i) => {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 2) {
            errors.push({ line: i + 1, text: line, reason: 'Format invalide : besoin keyword | description au minimum' });
            return;
        }
        const keyword = parts[0];
        const description = parts[1];
        const sectionId = parts[2] || '';
        const subsectionId = parts[3] || '';
        const nsfw = (parts[4] === '1') ? 1 : 0;
        if (!keyword || !description) {
            errors.push({ line: i + 1, text: line, reason: 'keyword ou description vide' });
            return;
        }
        rows.push({
            id: ++_bulkRowIdCounter,
            keyword, description, sectionId, subsectionId, nsfw,
        });
    });

    _bulkParsedLines = rows;

    // Construire le DOM
    previewDiv.innerHTML = '';
    previewDiv.classList.remove('hidden');

    // Barre d'actions
    const toolbar = document.createElement('div');
    toolbar.className = 'px-2 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-xs font-medium flex items-center gap-2';
    toolbar.innerHTML = '<span>✅ <span id="bi-valid-count">' + rows.length + '</span> ligne(s) valide(s)'
        + (errors.length > 0 ? ' · ⚠️ ' + errors.length + ' erreur(s)' : '')
        + '</span>';
    const dupBtn = document.createElement('button');
    dupBtn.textContent = '🔍 Vérifier doublons';
    dupBtn.className = 'ml-auto px-2 py-0.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-400 transition';
    dupBtn.onclick = _bulkCheckDuplicates;
    toolbar.appendChild(dupBtn);
    previewDiv.appendChild(toolbar);

    // Erreurs de parsing
    if (errors.length > 0) {
        const errDiv = document.createElement('div');
        errDiv.className = 'mt-2 p-2 bg-rose-50 dark:bg-rose-900/30 rounded border border-rose-200 dark:border-rose-800 text-xs';
        errDiv.innerHTML = '<p class="text-rose-600 dark:text-rose-400 font-medium mb-1">⚠️ ' + errors.length + ' erreur(s) de parsing :</p>';
        errors.forEach(e => {
            const p = document.createElement('p');
            p.className = 'text-rose-500 text-[10px]';
            p.textContent = 'Ligne ' + e.line + ' : ' + e.reason;
            errDiv.appendChild(p);
            const code = document.createElement('code');
            code.className = 'text-rose-400 text-[10px] block ml-2';
            code.textContent = e.text.substring(0, 80);
            errDiv.appendChild(code);
        });
        previewDiv.appendChild(errDiv);
    }

    // Tableau editable
    if (rows.length > 0) {
        const table = document.createElement('table');
        table.className = 'w-full text-xs border-collapse mt-2';
        table.innerHTML = '<thead><tr class="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">'
            + '<th class="px-1 py-1 text-center w-6"></th>'
            + '<th class="px-2 py-1 text-left">Keyword</th>'
            + '<th class="px-2 py-1 text-left">Description</th>'
            + '<th class="px-2 py-1 text-left w-16">Section</th>'
            + '<th class="px-2 py-1 text-left w-20">Sous-section</th>'
            + '<th class="px-2 py-1 text-center w-12">NSFW</th>'
            + '<th class="px-1 py-1 text-center w-6"></th>'
            + '</tr></thead>';
        const tbody = document.createElement('tbody');

        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.id = 'bi-row-' + r.id;
            tr.className = 'border-b border-slate-100 dark:border-slate-700';
            tr.dataset.id = r.id;

            // Checkbox
            const tdCheck = document.createElement('td');
            tdCheck.className = 'px-1 py-1 text-center';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.className = 'bi-row-cb';
            cb.dataset.rowId = r.id;
            cb.onchange = _bulkUpdateCount;
            tdCheck.appendChild(cb);

            // Keyword (editable)
            const tdKw = document.createElement('td');
            tdKw.className = 'px-2 py-1';
            const kwInput = document.createElement('input');
            kwInput.type = 'text';
            kwInput.value = r.keyword;
            kwInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            kwInput.dataset.rowId = r.id;
            kwInput.dataset.field = 'keyword';
            kwInput.oninput = _bulkUpdateRow;
            tdKw.appendChild(kwInput);

            // Description (editable)
            const tdDesc = document.createElement('td');
            tdDesc.className = 'px-2 py-1';
            const descInput = document.createElement('input');
            descInput.type = 'text';
            descInput.value = r.description;
            descInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            descInput.dataset.rowId = r.id;
            descInput.dataset.field = 'description';
            descInput.oninput = _bulkUpdateRow;
            tdDesc.appendChild(descInput);

            // Section
            const tdSec = document.createElement('td');
            tdSec.className = 'px-2 py-1';
            const secInput = document.createElement('input');
            secInput.type = 'text';
            secInput.value = r.sectionId;
            secInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            secInput.dataset.rowId = r.id;
            secInput.dataset.field = 'sectionId';
            secInput.oninput = _bulkUpdateRow;
            secInput.setAttribute('list', 'kw-section-list');
            tdSec.appendChild(secInput);

            // Subsection
            const tdSub = document.createElement('td');
            tdSub.className = 'px-2 py-1';
            const subInput = document.createElement('input');
            subInput.type = 'text';
            subInput.value = r.subsectionId;
            subInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            subInput.dataset.rowId = r.id;
            subInput.dataset.field = 'subsectionId';
            subInput.oninput = _bulkUpdateRow;
            subInput.setAttribute('list', 'kw-subsection-list');
            tdSub.appendChild(subInput);

            // NSFW toggle
            const tdNsfw = document.createElement('td');
            tdNsfw.className = 'px-2 py-1 text-center';
            const nsCb = document.createElement('input');
            nsCb.type = 'checkbox';
            nsCb.checked = !!r.nsfw;
            nsCb.className = 'bi-row-nsfw';
            nsCb.dataset.rowId = r.id;
            nsCb.onchange = _bulkUpdateRow;
            tdNsfw.appendChild(nsCb);

            // Delete button
            const tdDel = document.createElement('td');
            tdDel.className = 'px-1 py-1 text-center';
            const delBtn = document.createElement('button');
            delBtn.textContent = '×';
            delBtn.className = 'text-rose-400 hover:text-rose-600 text-xs font-bold px-1';
            delBtn.title = 'Supprimer cette ligne';
            delBtn.onclick = function() { _bulkDeleteRow(r.id); };
            tdDel.appendChild(delBtn);

            tr.append(tdCheck, tdKw, tdDesc, tdSec, tdSub, tdNsfw, tdDel);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        previewDiv.appendChild(table);
    }

    document.getElementById('btn-bi-confirm').classList.remove('hidden');
}

function _bulkUpdateCount() {
    const cbs = document.querySelectorAll('.bi-row-cb');
    const checked = Array.from(cbs).filter(cb => cb.checked).length;
    document.getElementById('bi-valid-count').textContent = checked;
}

function _bulkUpdateRow(e) {
    const input = e.target;
    const id = parseInt(input.dataset.rowId);
    const field = input.dataset.field;
    const row = _bulkParsedLines.find(r => r.id === id);
    if (row) {
        if (field === 'nsfw') {
            row.nsfw = input.checked ? 1 : 0;
        } else {
            row[field] = input.value;
        }
        // Si le keyword change, invalider le cache doublon
        if (field === 'keyword') {
            const tr = document.getElementById('bi-row-' + id);
            if (tr) tr.classList.remove('bg-rose-100', 'dark:bg-rose-900/30', 'line-through', 'opacity-60');
            const cb = tr?.querySelector('.bi-row-cb');
            if (cb) cb.disabled = false;
            _bulkExistingSet = null; // Invalider le cache
        }
    }
}

function _bulkDeleteRow(id) {
    _bulkParsedLines = _bulkParsedLines.filter(r => r.id !== id);
    const tr = document.getElementById('bi-row-' + id);
    if (tr) tr.remove();
    _bulkUpdateCount();
}

async function _bulkCheckDuplicates() {
    const dupBtn = document.querySelector('#bi-preview button');
    if (dupBtn) dupBtn.textContent = '🔍 Vérification...';

    try {
        // Charger les keywords existants
        const res = await fetch(API + '/keywords?scope=public&limit=5000');
        const existing = await safeJson(res);
        if (!Array.isArray(existing)) return;

        _bulkExistingSet = new Set(existing.map(kw => kw.keyword.toLowerCase()));

        let dupCount = 0;
        _bulkParsedLines.forEach(r => {
            const tr = document.getElementById('bi-row-' + r.id);
            if (!tr) return;
            const cb = tr.querySelector('.bi-row-cb');
            if (_bulkExistingSet.has(r.keyword.toLowerCase())) {
                tr.classList.add('bg-rose-100', 'dark:bg-rose-900/30', 'line-through', 'opacity-60');
                if (cb) {
                    cb.checked = false;
                    cb.disabled = true;
                }
                dupCount++;
            } else {
                tr.classList.remove('bg-rose-100', 'dark:bg-rose-900/30', 'line-through', 'opacity-60');
                if (cb) cb.disabled = false;
            }
        });

        _bulkUpdateCount();
        if (dupBtn) dupBtn.textContent = '🔍 Vérifier doublons';
        showModal('Résultat', dupCount > 0
            ? '⚠️ ' + dupCount + ' doublon(s) trouvé(s) et désactivé(s). Vérifie et confirme si nécessaire.'
            : '✅ Aucun doublon trouvé !',
            dupCount > 0 ? 'warning' : 'success');
    } catch (e) {
        if (dupBtn) dupBtn.textContent = '🔍 Vérifier doublons';
        showModal('Erreur', e.message || 'Erreur de vérification', 'error');
    }
}

async function kwBulkConfirm() {
    if (!_bulkParsedLines || _bulkParsedLines.length === 0) {
        showModal('Erreur', 'Sélectionne d\'abord un fichier', 'error');
        return;
    }

    // Reconstruire le texte à partir des données éditées
    const selectedRows = _bulkParsedLines.filter(r => {
        const tr = document.getElementById('bi-row-' + r.id);
        if (!tr) return false;
        const cb = tr.querySelector('.bi-row-cb');
        return cb && cb.checked;
    });

    if (selectedRows.length === 0) {
        showModal('Erreur', 'Aucune ligne sélectionnée pour l\'import', 'error');
        return;
    }

    // Reconstruire le format texte
    const text = selectedRows.map(r =>
        r.keyword + ' | ' + r.description + ' | ' + r.sectionId + ' | ' + r.subsectionId + ' | ' + r.nsfw
    ).join('\n');

    const privacy = document.getElementById('bi-privacy').value;

    try {
        const res = await fetch(API + '/keywords/bulk', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text, privacy_status: privacy})
        });
        const data = await safeJson(res);
        const resultDiv = document.getElementById('bi-result');
        resultDiv.classList.remove('hidden');
        if (res.ok) {
            resultDiv.className = 'text-xs p-2 rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300';
            resultDiv.innerHTML = '✅ <b>' + data.message + '</b>';
            if (data.errors && data.errors.length > 0) {
                resultDiv.innerHTML += '<br><br><b>Erreurs :</b><br>' + data.errors.slice(0, 10).join('<br>');
            }
            kwLoadList();
            setTimeout(() => closeBulkImport(), 3000);
        } else {
            resultDiv.className = 'text-xs p-2 rounded border border-rose-300 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700 text-rose-800 dark:text-rose-300';
            resultDiv.innerHTML = '❌ ' + (data.error || 'Erreur inconnue');
        }
    } catch (e) {
        showModal('Erreur', e.message, 'error');
    }
}

// ── Scan des doublons ─────────────────────────────────────────

async function kwOpenDuplicateScan() {
    showModal('🔍 Scan en cours', 'Analyse de la base à la recherche de doublons...<br><span style="font-size:11px;color:#888;">Cela peut prendre quelques secondes.</span>', 'info');

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s max
        const res = await fetch(API + '/keywords/scan-duplicates', { signal: controller.signal });
        clearTimeout(timeout);
        
        const data = await safeJson(res);
        if (!res.ok) {
            showModal('Erreur', data.error || 'Erreur de scan (HTTP ' + res.status + ')', 'error');
            return;
        }

        let html = '';

        // Stats
        html += '<div class="text-xs mb-3">';
        html += '<p>🔍 <b>' + data.exact_count + '</b> groupe(s) de doublons exacts trouvés';
        if (data.semantic_count > 0) {
            html += ' · <b>' + data.semantic_count + '</b> groupe(s) de doublons sémantiques (≥85%)';
        }
        html += '</p></div>';

        if (data.exact_count === 0 && data.semantic_count === 0) {
            html = '<p class="text-emerald-600 dark:text-emerald-400 text-sm">✅ Aucun doublon trouvé dans la base !</p>';
        } else {
            // Exact duplicates
            if (data.exact_duplicates && data.exact_duplicates.length > 0) {
                html += '<h4 class="text-xs font-semibold text-rose-600 dark:text-rose-400 mb-1">⚠️ Doublons exacts</h4>';
                data.exact_duplicates.forEach(g => {
                    html += '<div class="mb-1.5 p-1.5 bg-rose-50 dark:bg-rose-900/20 rounded border border-rose-200 dark:border-rose-800 text-xs">';
                    html += '<span class="font-medium">' + esc(g.normalized) + '</span> ×' + g.count;
                    html += '<div class="text-slate-500">' + g.keywords.map(k => esc(k)).join(' · ') + '</div>';
                    html += '</div>';
                });
            }

            // Semantic duplicates
            if (data.semantic_groups && data.semantic_groups.length > 0) {
                html += '<h4 class="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1 mt-3">🔍 Doublons sémantiques (≥85%)</h4>';
                data.semantic_groups.forEach(group => {
                    html += '<div class="mb-1.5 p-1.5 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800 text-xs">';
                    group.forEach((item, idx) => {
                        const simPct = (item.similarity * 100).toFixed(0);
                        const label = idx === 0 ? '🎯 Référence' : '🔗 ' + simPct + '% similaire';
                        html += '<div>' + label + ' : <b>' + esc(item.keyword) + '</b> <span class="text-slate-400">' + esc(item.description.substring(0, 60)) + '</span></div>';
                    });
                    html += '</div>';
                });
            }
        }

        showModal('🔍 Résultat du scan des doublons', html, data.exact_count > 0 ? 'warning' : 'success');
    } catch (e) {
        showModal('Erreur', e.message || 'Erreur de scan', 'error');
    }
}

// ── Export ──────────────────────────────────────────────────────

function kwExport() {
    const scope = document.getElementById('kw-filter-scope').value || 'public';
    window.open(API + '/keywords/export?scope=' + scope, '_blank');
}

// ── Moderation (KW editors) — Multi-selection ──────────────────

let _pendingSelected = new Set();
let _pendingLastClicked = null;
let _pendingData = [];
let isKwEditor = false;

async function checkKwEditorStatus() {
    try {
        const res = await fetch(API + '/keywords/pending');
        if (res.status === 403) {
            document.getElementById('kw-btn-pending').classList.add('hidden');
            document.getElementById('kw-pending-section').classList.add('hidden');
            isKwEditor = false;
            return;
        }
        isKwEditor = true;
        document.getElementById('kw-privacy-public-opt').disabled = false;
        document.getElementById('kw-btn-pending').classList.remove('hidden');
    } catch {
        isKwEditor = false;
    }
}

function _pendingUpdateButtons() {
    var count = _pendingSelected.size;
    var appBtn = document.getElementById('kw-pending-approve-btn');
    var rejBtn = document.getElementById('kw-pending-reject-btn');
    if (appBtn) { appBtn.textContent = '✅ Valider (' + count + ')'; appBtn.disabled = count === 0; }
    if (rejBtn) { rejBtn.textContent = '❌ Rejeter (' + count + ')'; rejBtn.disabled = count === 0; }
}

function _pendingToggle(id, e) {
    var tr = document.getElementById('kw-pending-row-' + id);
    if (!tr) return;

    if (e.shiftKey && _pendingLastClicked !== null) {
        var ids = _pendingData.map(function(x) { return x.id; });
        var startIdx = ids.indexOf(_pendingLastClicked);
        var endIdx = ids.indexOf(id);
        if (startIdx !== -1 && endIdx !== -1) {
            var from = Math.min(startIdx, endIdx);
            var to = Math.max(startIdx, endIdx);
            if (!e.ctrlKey && !e.metaKey) _pendingSelected.clear();
            for (var i = from; i <= to; i++) _pendingSelected.add(ids[i]);
        }
    } else if (e.ctrlKey || e.metaKey) {
        if (_pendingSelected.has(id)) _pendingSelected.delete(id);
        else _pendingSelected.add(id);
    } else {
        _pendingSelected.clear();
        _pendingSelected.add(id);
    }
    _pendingLastClicked = id;
    _pendingRenderRows();
    _pendingUpdateButtons();
}

function _pendingRenderRows() {
    _pendingData.forEach(function(kw) {
        var tr = document.getElementById('kw-pending-row-' + kw.id);
        if (!tr) return;
        var selected = _pendingSelected.has(kw.id);
        tr.classList.toggle('ring-2', selected);
        tr.classList.toggle('ring-indigo-400', selected);
        tr.classList.toggle('bg-indigo-50', selected);
        tr.classList.toggle('dark:bg-indigo-900/30', selected);
        tr.classList.toggle('bg-amber-50', !selected);
        tr.classList.toggle('dark:bg-amber-900/20', !selected);
        var cb = tr.querySelector('.kw-pending-cb');
        if (cb) cb.checked = selected;
    });
}

function _pendingSelectAll() {
    _pendingSelected = new Set(_pendingData.map(function(x) { return x.id; }));
    _pendingRenderRows();
    _pendingUpdateButtons();
}

function _pendingSelectNone() {
    _pendingSelected.clear();
    _pendingRenderRows();
    _pendingUpdateButtons();
}

function _pendingSelectInvert() {
    var all = _pendingData.map(function(x) { return x.id; });
    _pendingSelected = new Set(all.filter(function(id) { return !_pendingSelected.has(id); }));
    _pendingRenderRows();
    _pendingUpdateButtons();
}

async function _pendingBulkReview(action) {
    if (_pendingSelected.size === 0) return;

    var ids = [..._pendingSelected];
    var notes = '';
    if (action === 'reject') {
        notes = await new Promise(function(resolve) {
            showPrompt('Rejeter', 'Raison du rejet (optionnelle) :', '', function(n) { resolve(n || ''); });
        });
    }

    var done = 0;
    var errors = 0;
    for (var i = 0; i < ids.length; i++) {
        try {
            var res = await fetch(API + '/keywords/' + ids[i] + '/review', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({action: action, notes: notes})
            });
            var data = await safeJson(res);
            if (res.ok) {
                done++;
                var tr = document.getElementById('kw-pending-row-' + ids[i]);
                if (tr) {
                    tr.style.transition = 'opacity 0.3s';
                    tr.style.opacity = '0';
                    setTimeout(function() { if (tr.parentNode) tr.remove(); }, 300);
                }
            } else {
                errors++;
            }
        } catch(e) {
            errors++;
        }
    }

    _pendingSelected.clear();
    _pendingData = _pendingData.filter(function(kw) { return !ids.includes(kw.id); });
    _pendingUpdateButtons();
    kwLoadList();

    var list = document.getElementById('kw-pending-list');
    if (list.children.length === 0) {
        list.innerHTML = '<p class="text-xs text-slate-400">Rien en attente ✅</p>';
    }

    showModal('Terminé', done + '/' + ids.length + ' traités' + (errors > 0 ? ', ' + errors + ' erreur(s)' : ''), errors > 0 ? 'warning' : 'success');
}

async function kwLoadPending() {
    if (!isKwEditor) return;
    var section = document.getElementById('kw-pending-section');
    var list = document.getElementById('kw-pending-list');
    section.classList.remove('hidden');
    list.innerHTML = '<p class="text-xs text-slate-400">Chargement...</p>';
    _pendingSelected.clear();
    _pendingLastClicked = null;

    try {
        var res = await fetch(API + '/keywords/pending');
        var data = await safeJson(res);
        if (!res.ok || !Array.isArray(data)) {
            list.innerHTML = '<p class="text-xs text-rose-400">Erreur</p>';
            return;
        }
        if (data.length === 0) {
            list.innerHTML = '<p class="text-xs text-slate-400">Rien en attente ✅</p>';
            return;
        }

        _pendingData = data;
        list.innerHTML = '';

        // Toolbar : select all/none/invert + bulk actions
        var toolbar = document.createElement('div');
        toolbar.className = 'flex items-center gap-1.5 mb-2 flex-wrap';

        function mkBtn(text, cls, fn) {
            var b = document.createElement('button');
            b.textContent = text;
            b.className = 'px-2 py-0.5 text-xs rounded ' + cls;
            b.onclick = fn;
            return b;
        }

        toolbar.appendChild(mkBtn('☐ All', 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200', _pendingSelectAll));
        toolbar.appendChild(mkBtn('☐ None', 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200', _pendingSelectNone));
        toolbar.appendChild(mkBtn('🔄 Invert', 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200', _pendingSelectInvert));

        var approveBtn = mkBtn('✅ Valider (0)', 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40', function() { _pendingBulkReview('approve'); });
        approveBtn.id = 'kw-pending-approve-btn';
        approveBtn.disabled = true;
        toolbar.appendChild(approveBtn);

        var rejectBtn = mkBtn('❌ Rejeter (0)', 'bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-40', function() { _pendingBulkReview('reject'); });
        rejectBtn.id = 'kw-pending-reject-btn';
        rejectBtn.disabled = true;
        toolbar.appendChild(rejectBtn);

        list.appendChild(toolbar);

        // Lignes
        data.forEach(function(kw) {
            var row = document.createElement('div');
            row.id = 'kw-pending-row-' + kw.id;
            row.className = 'flex items-center gap-1.5 p-1.5 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs cursor-pointer select-none';
            row.onclick = function(e) { _pendingToggle(kw.id, e); };

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'kw-pending-cb shrink-0';
            cb.onclick = function(e) { e.stopPropagation(); _pendingToggle(kw.id, e); };

            var label = document.createElement('span');
            label.className = 'flex-1';
            label.innerHTML = '<strong>' + esc(kw.keyword) + '</strong> <span class="text-slate-400">par ' + esc(kw.creator_name || '?') + '</span>';

            var editBtn = document.createElement('button');
            editBtn.textContent = '✎';
            editBtn.className = 'px-1.5 py-0.5 text-xs border border-slate-300 rounded hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700';
            editBtn.title = 'Voir/Modifier';
            editBtn.onclick = function(e) {
                e.stopPropagation();
                kwEdit(kw);
                document.getElementById('kw-form-keyword').scrollIntoView({behavior: 'smooth'});
            };

            var approveBtn = document.createElement('button');
            approveBtn.textContent = '✅';
            approveBtn.className = 'px-1.5 py-0.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-500';
            approveBtn.title = 'Valider';
            approveBtn.onclick = function(e) {
                e.stopPropagation();
                _pendingSelected.clear();
                _pendingSelected.add(kw.id);
                _pendingBulkReview('approve');
            };

            var rejectBtn = document.createElement('button');
            rejectBtn.textContent = '❌';
            rejectBtn.className = 'px-1.5 py-0.5 text-xs bg-rose-600 text-white rounded hover:bg-rose-500';
            rejectBtn.title = 'Rejeter';
            rejectBtn.onclick = function(e) {
                e.stopPropagation();
                _pendingSelected.clear();
                _pendingSelected.add(kw.id);
                _pendingBulkReview('reject');
            };

            row.append(cb, label, editBtn, approveBtn, rejectBtn);
            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<p class="text-xs text-rose-400">Erreur: ' + e.message + '</p>';
    }
}

// ── Initialisation ───────────────────────────────────────────────

// Charger la liste au premier affichage de l'onglet
// On utilise un observer simple sur la visibilité du conteneur
document.addEventListener('DOMContentLoaded', function() {
    // Pas de chargement auto, on attend le clic sur l'onglet.
    // Le switchMainTab appelle kwLoadList() quand l'onglet keywords est activé
});

// Hook dans switchMainTab : on surcharge l'appel pour detecter l'onglet keywords
// (fait dans app-core.js via un event custom)

