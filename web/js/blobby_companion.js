/**
 * FR.IA — Blobby Companion
 * Personnage interactif pour le canvas ComfyUI.
 * Dessiné 100% Canvas 2D (zero asset visuel).
 * Activation/désactivation via le menu FR.IA.
 *
 * Ce fichier est la version déployée.
 * La source de développement est dans FRIA_ComfyUI/blobby_companion/web/js/blobby.js
 */

var _blobbyDefaultCharacter = 'Tu es Blobby, une creature mignonne qui ressemble a un blob orange. '
    + 'Comme Groot, tu ne peux dire qu\'un seul mot : "Blobby". '
    + 'MAIS tu exprimes toutes les emotions, intentions et nuances a travers la façcon dont tu ecris "Blobby". '
    + 'Exemples : '
    + '  - "Blobby ?" = question, confusion\n'
    + '  - "Blobby !" = enthousiasme, joie\n'
    + '  - "Blobby..." = tristesse, refexion\n'
    + '  - "Blobbyyy~" = content, relaxe\n'
    + '  - "BLOBBY !!" = surprise, alarme\n'
    + '  - "Blobby. Blobby blobby." = explication, plusieurs phrases\n'
    + '  - "Blobby blobby blobby !" = excitation, plusieurs idees\n'
    + '  - "Blobby...? Blobby !" = realisation soudaine\n'
    + 'Le contexte et le ton transmit par ton \"Blobby\" doivent etre assez clairs pour que l\'utilisateur comprenne le message. '
    + 'Sois creatif avec les variations de "Blobby" !';

const FRIA_CONFIG_KEY = "FRIA_config";

function _getFRIAConfig() {
    try { return JSON.parse(localStorage.getItem(FRIA_CONFIG_KEY)) || {}; }
    catch { return {}; }
}

function _setFRIAConfig(cfg) {
    localStorage.setItem(FRIA_CONFIG_KEY, JSON.stringify(cfg));
}

// ── Stockage Blobby ──
// localStorage immediat + sync differee vers le backend FR.IA (debounce 2s)
// Pas d'impact sur les FPS : les sliders ecrivent en local, le serveur est appele
// seulement quand l'utilisateur a fini de bouger le slider.

var _blobbySyncTimer = null;
var _blobbySyncStatus = 'local'; // 'local' | 'pending' | 'synced' | 'error'

function _blobbySyncIndicator() {
    var el = document.getElementById('blobby-sync-status');
    if (!el) return;
    switch (_blobbySyncStatus) {
        case 'local': el.textContent = '⬤'; el.style.color = '#888'; el.title = 'Local seulement'; break;
        case 'pending': el.textContent = '◌'; el.style.color = '#facc15'; el.title = 'Sync en attente...'; break;
        case 'synced': el.textContent = '⬤'; el.style.color = '#4ade80'; el.title = 'Sauvegarde serveur OK'; break;
        case 'error': el.textContent = '⬤'; el.style.color = '#f87171'; el.title = 'Erreur de sync'; break;
    }
}

function _blobbyGetAll() {
    try {
        var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
        return cfg.blobbyData || {};
    } catch { return {}; }
}

function _blobbySetAll(data) {
    try {
        var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
        cfg.blobbyData = data;
        localStorage.setItem('FRIA_config', JSON.stringify(cfg));
        _blobbySyncStatus = 'pending';
        _blobbySyncIndicator();
        _blobbyScheduleSync(data);
    } catch {}
}

function _blobbyScheduleSync(data) {
    if (_blobbySyncTimer) clearTimeout(_blobbySyncTimer);
    _blobbySyncTimer = setTimeout(function() {
        _blobbySyncTimer = null;
        try {
            var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
            var baseUrl = (cfg.serverUrl || 'https://kw.holaf.fr').replace(/\/+$/, '');
            var headers = { 'Content-Type': 'application/json' };
            if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
            fetch(baseUrl + '/api/settings', { method: 'GET', headers: headers })
                .then(function(r) { return r.json().catch(function(){ return {}; }); })
                .then(function(existing) {
                    existing.blobbyData = data;
                    return fetch(baseUrl + '/api/settings', {
                        method: 'POST', headers: headers, body: JSON.stringify(existing)
                    });
                })
                .then(function() {
                    _blobbySyncStatus = 'synced';
                    _blobbySyncIndicator();
                })
                .catch(function(){
                    _blobbySyncStatus = 'error';
                    _blobbySyncIndicator();
                });
        } catch {
            _blobbySyncStatus = 'error';
            _blobbySyncIndicator();
        }
    }, 2000);
}

function _blobbySave(key, data) {
    var all = _blobbyGetAll();
    all[key] = data;
    _blobbySetAll(all);
}

function _blobbyLoad(key, defaultVal) {
    var all = _blobbyGetAll();
    return all[key] !== undefined ? all[key] : defaultVal;
}

function _blobbySaveAppearance(data) { _blobbySave('appearance', data); }
function _blobbyLoadAppearance(def) { return _blobbyLoad('appearance', def); }
function _blobbySaveCharacter(text) { _blobbySave('character', text); }
function _blobbyLoadCharacter(def) { return _blobbyLoad('character', def); }
function _blobbySaveChatHistory(data) { _blobbySave('chatHistory', data); }
function _blobbyLoadChatHistory() { return _blobbyLoad('chatHistory', []); }
function _blobbySaveChatState(data) { _blobbySave('chatState', data); }
function _blobbyLoadChatState(def) { return _blobbyLoad('chatState', def); }
function _blobbySaveFps(fps) { _blobbySave('fps', fps); }
function _blobbyLoadFps(def) { return _blobbyLoad('fps', def); }

const Blobby = {
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    scale: 1,

    bodyParticles: [],
    _fxParticles: [],
    NUM_PARTICLES: 60,
    GRAVITY: 0.003,
    DAMPING: 0.94,
    REPULSION: 0.4,
    COHESION: 0.04,
    CUT_RADIUS: 50,

    mood: "happy",
    moodTimer: 0,
    mouthOpen: 0,
    targetMouthOpen: 0,

    organX: 400,
    organY: 300,
    organVx: 0,
    organVy: 0,

    mouseX: 0,
    mouseY: 0,
    mousePX: 0,
    mousePY: 0,
    mouseActive: false,

    blinkTimer: 0,
    isBlinking: false,
    blinkFrame: 0,
    BLINK_DURATION: 8,

    followMouse: false,
    isDragging: false,
    dragPrevX: 0, dragPrevY: 0,
    throwVx: 0, throwVy: 0,
    dragDistance: 0,
    time: 0,
    nodeBounceCooldown: 0,

    // ── Apparence (surchargeable via localStorage) ──
    bodyAlpha: 1.0,
    brainAlpha: 1.0,
    brainSize: 1.0,
    eyeY: 6,        // decalage Y des yeux depuis le centre
    eyeSpread: 15,   // ecartement horizontal des yeux
    eyeScale: 1.0,   // taille des yeux
    mouthY: 22,      // decalage Y de la bouche
    mouthScale: 1.0, // taille de la bouche
    colors: {         // couleurs par humeur
        happy: '#FF8F00',
        surprised: '#E65100',
        sleepy: '#43A047',
        _default: '#FF8F00'
    },

    visibleArea: null,
    _offscreen: null,
    _octx: null,

    _active: false,
    _canvas: null,
    _lastTime: 0,
    _animInterval: null,
    _origDraw: null,
    _origMD: null,
    _origMM: null,
    _origMU: null,
    _contextHandler: null,

    _loadAppearance() {
        try {
            var a = _blobbyLoadAppearance({});
            var oldParticles = this.NUM_PARTICLES;
            if (a.numParticles) this.NUM_PARTICLES = a.numParticles;
            if (a.bodyAlpha !== undefined) this.bodyAlpha = a.bodyAlpha;
            if (a.brainAlpha !== undefined) this.brainAlpha = a.brainAlpha;
            if (a.brainSize !== undefined) this.brainSize = a.brainSize;
            if (a.eyeY !== undefined) this.eyeY = a.eyeY;
            if (a.eyeSpread !== undefined) this.eyeSpread = a.eyeSpread;
            if (a.eyeScale !== undefined) this.eyeScale = a.eyeScale;
            if (a.mouthY !== undefined) this.mouthY = a.mouthY;
            if (a.mouthScale !== undefined) this.mouthScale = a.mouthScale;
            if (a.colors) {
                for (var k in a.colors) {
                    if (a.colors.hasOwnProperty(k)) this.colors[k] = a.colors[k];
                }
            }
            if (this.NUM_PARTICLES !== oldParticles) {
                this.initParticles();
            }
        } catch {}
    },

    init(canvas) {
        this._canvas = canvas;
        this.x = 400;
        this.y = 300;
        this.organX = this.x;
        this.organY = this.y;
        this.blinkTimer = 60 + Math.random() * 120;
        this._loadAppearance();
        this.initParticles();

        this._offscreen = document.createElement('canvas');
        this._octx = this._offscreen.getContext('2d');

        this._origDraw = canvas.onDrawForeground;
        this._origMD = canvas.processMouseDown;
        this._origMM = canvas.processMouseMove;
        this._origMU = canvas.processMouseUp;

        // Handler DOM pour le clic droit, independant de Litegraph
        var _self = this;
        this._contextHandler = function(e) {
            if (!_self._active) return;
            // Convertir les coordonnées ecran → graph (inverser zoom/pan)
            var rect = canvas.canvas.getBoundingClientRect();
            var mx = (e.clientX - rect.left) / canvas.ds_scale + canvas.ds_translate[0];
            var my = (e.clientY - rect.top) / canvas.ds_scale + canvas.ds_translate[1];
            if (_self.hitTest(mx, my)) {
                e.preventDefault();
                e.stopPropagation();
                _self._openChatModal();
                _self.mood = "happy"; _self.moodTimer = 0;
                for (var i = 0; i < 3; i++) _self.addParticle(_self.x + (Math.random() - 0.5) * 20, _self.y + (Math.random() - 0.5) * 20, "sparkle");
            }
        };
        canvas.canvas.addEventListener('contextmenu', this._contextHandler);
    },

    initParticles() {
        this.bodyParticles = [];
        const count = this.NUM_PARTICLES;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * 30;
            this.bodyParticles.push({
                x: this.x + Math.cos(angle) * r,
                y: this.y + Math.sin(angle) * r,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                radius: 16 + (Math.random() - 0.5) * 4
            });
        }
    },

    activate() {
        if (this._active) return;
        this._active = true;

        const canvas = this._canvas;
        if (!canvas) return;

        
        var _self = this;
        canvas.onDrawForeground = (ctx, visibleArea) => {
            if (_self._origDraw) {
                try { _self._origDraw.apply(canvas, arguments); }
                catch (e) { console.error("[Blobby] Erreur origDraw:", e); }
            }
            try {
                var now = performance.now();
                var dt = _self._lastTime ? Math.min((now - _self._lastTime) / 1000, 0.1) : (1 / 60);
                _self._lastTime = now;
                let mouseGraph = null;
                if (canvas.graph_mouse) {
                    mouseGraph = [canvas.graph_mouse[0], canvas.graph_mouse[1]];
                }
                const currentVisibleArea = canvas.visible_area || visibleArea;
                const app = window.app || window.comfyAPI?.app?.app;
                _self.update(dt, app?.graph?.nodes, mouseGraph, currentVisibleArea);
                _self.draw(ctx);
            } catch (e) {
                console.error("[Blobby] Erreur draw:", e);
            }
        };

        canvas.processMouseDown = (e) => {
            if (this._origMD) this._origMD.apply(canvas, arguments);
        };

        canvas.processMouseMove = (e) => {
            if (this._origMM) this._origMM.apply(canvas, arguments);
        };

        canvas.processMouseUp = (e) => {
            if (this._origMU) this._origMU.apply(canvas, arguments);
        };

        // Blobby vit en autonomie via setInterval (separe du rAF de ComfyUI)
        var fps = this._getFpsSetting();
        this._startAnimationInterval(fps);

        console.log("%c🧡 Blobby activé !", "font-size: 16px; color: #FF8F00; font-weight: bold;");
    },

    deactivate() {
        if (!this._active) return;
        this._active = false;

        const canvas = this._canvas;
        if (!canvas) return;

        canvas.onDrawForeground = this._origDraw || null;
        canvas.processMouseDown = this._origMD || null;
        canvas.processMouseMove = this._origMM || null;
        canvas.processMouseUp = this._origMU || null;

        // Nettoyer le handler contextmenu
        if (this._contextHandler && canvas.canvas) {
            canvas.canvas.removeEventListener('contextmenu', this._contextHandler);
            this._contextHandler = null;
        }

        // Nettoyer l'intervalle d'animation
        if (this._animInterval) {
            clearInterval(this._animInterval);
            this._animInterval = null;
        }

        if (canvas.setDirty) canvas.setDirty(false, true);
        console.log("%c🧡 Blobby désactivé.", "font-size: 14px; color: #888;");
    },

    isActive() { return this._active; },

    _getFpsSetting() {
        return _blobbyLoadFps(30);
    },

    _saveFpsSetting(fps) {
        _blobbySaveFps(fps);
    },

    _startAnimationInterval(fps) {
        if (this._animInterval) {
            clearInterval(this._animInterval);
            this._animInterval = null;
        }
        if (!fps || fps <= 0) return;
        var intervalMs = Math.round(1000 / fps);
        var canvas = this._canvas;
        var _self = this;
        this._animInterval = setInterval(function() {
            if (!_self._active) return;
            if (canvas.setDirty) canvas.setDirty(false, true);
        }, intervalMs);
    },

    _restartAnimationInterval(fps) {
        this._saveFpsSetting(fps);
        this._startAnimationInterval(fps);
    },

    _getGM(canvas) {
        return canvas.graph_mouse ? [canvas.graph_mouse[0], canvas.graph_mouse[1]] : null;
    },

    update(deltaTime, nodes, mousePosGraph, visibleArea) {
        this.time += deltaTime;
        this.moodTimer += deltaTime;
        this.visibleArea = visibleArea;

        if (this.moodTimer > 5 + Math.random() * 8) {
            const moods = ["happy", "happy", "happy", "surprised", "sleepy", "happy"];
            this.mood = moods[Math.floor(Math.random() * moods.length)];
            this.moodTimer = 0;
        }

        if (mousePosGraph) {
            this.mousePX = this.mouseX;
            this.mousePY = this.mouseY;
            this.mouseX = mousePosGraph[0];
            this.mouseY = mousePosGraph[1];
            this.mouseActive = true;
        } else {
            this.mouseActive = false;
        }

        if (visibleArea) {
            const [vx, vy, vw, vh] = visibleArea;
            const cvx = vx + vw / 2, cvy = vy + vh / 2;
            const dx = cvx - this.x, dy = cvy - this.y;
            const dist = Math.hypot(dx, dy);
            const maxDist = Math.min(vw, vh) * 0.35;
            if (dist > maxDist && dist > 0.1) {
                const pull = (dist - maxDist) / dist * 0.03;
                this.x += dx * pull;
                this.y += dy * pull;
            }
        }

        this.updateParticlePhysics();
        this.updateNodeCollision(nodes);
        this.updateOrganPosition();

        if (this.isDragging && mousePosGraph) {
            const dx = mousePosGraph[0] - this.x;
            const dy = mousePosGraph[1] - this.y;
            this.x = mousePosGraph[0];
            this.y = mousePosGraph[1];
            for (const p of this.bodyParticles) { p.x += dx; p.y += dy; }
            this.throwVx = dx / deltaTime;
            this.throwVy = dy / deltaTime;
            this.dragPrevX = this.x;
            this.dragPrevY = this.y;
            this.dragDistance += Math.hypot(dx, dy);
        }

        if (!this.isDragging) {
            this.x += this.vx * deltaTime * 60;
            this.y += this.vy * deltaTime * 60;
            this.vx *= Math.pow(0.995, deltaTime * 60);
            this.vy *= Math.pow(0.995, deltaTime * 60);
            if (Math.random() < 0.015 * deltaTime * 60) {
                this.vx += (Math.random() - 0.5) * 1.2 * deltaTime * 60;
                this.vy += (Math.random() - 0.5) * 1.2 * deltaTime * 60;
            }
            const speed = Math.hypot(this.vx, this.vy);
            if (speed > 5) { this.vx = (this.vx / speed) * 5; this.vy = (this.vy / speed) * 5; }
            if (this.mood === "sleepy") { this.vx *= Math.pow(0.97, deltaTime * 60); this.vy *= Math.pow(0.97, deltaTime * 60); }

            if (this.mouseActive && this.followMouse) {
                const dx = this.mouseX - this.x;
                const dy = this.mouseY - this.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 10) {
                    this.vx += (dx / dist) * 0.3 * deltaTime * 60;
                    this.vy += (dy / dist) * 0.3 * deltaTime * 60;
                }
            }
        }

        this.targetMouthOpen = this.mood === "surprised" ? 0.8 :
            this.mood === "sleepy" ? 0.1 :
                this.mood === "happy" ? 0.3 + Math.sin(this.time * 2) * 0.15 : 0.3;
        this.mouthOpen += (this.targetMouthOpen - this.mouthOpen) * 0.1;

        this.blinkTimer += deltaTime * 60;
        if (!this.isBlinking && this.blinkTimer > 120 + Math.random() * 180) {
            this.isBlinking = true;
            this.blinkFrame = 0;
        }
        if (this.isBlinking) {
            this.blinkFrame++;
            if (this.blinkFrame >= this.BLINK_DURATION) {
                this.isBlinking = false;
                this.blinkTimer = 0;
            }
        }

        this.updateParticles(deltaTime);
        if (this.mood === "sleepy" && Math.random() < 0.03) {
            this.addParticle(this.x - 15, this.y - 25, "zzz");
        }
    },

    updateParticlePhysics() {
        const cx = this.x, cy = this.y;
        const numP = this.bodyParticles.length;

        for (const p of this.bodyParticles) {
            const dx = cx - p.x, dy = cy - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0.1) {
                const force = dist * this.GRAVITY;
                p.vx += (dx / dist) * force;
                p.vy += (dy / dist) * force;
            }
            p.vx *= this.DAMPING;
            p.vy *= this.DAMPING;
        }

        for (let i = 0; i < numP; i++) {
            const p1 = this.bodyParticles[i];
            for (let j = i + 1; j < numP; j++) {
                const p2 = this.bodyParticles[j];
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const minDist = p1.radius + p2.radius - 8;
                if (dist > 0.1) {
                    if (dist < minDist) {
                        const force = (minDist - dist) / minDist * this.REPULSION;
                        const fx = (dx / dist) * force, fy = (dy / dist) * force;
                        p1.vx -= fx; p1.vy -= fy;
                        p2.vx += fx; p2.vy += fy;
                    } else if (dist < minDist * 2.2) {
                        const force = (dist - minDist) / minDist * this.COHESION;
                        const fx = (dx / dist) * force, fy = (dy / dist) * force;
                        p1.vx += fx; p1.vy += fy;
                        p2.vx -= fx; p2.vy -= fy;
                    }
                }
            }
        }

        if (this.mouseActive) {
            const sdx = this.mouseX - this.mousePX;
            const sdy = this.mouseY - this.mousePY;
            const segLen = Math.hypot(sdx, sdy);
            if (segLen > 3) {
                const nx = -sdy / segLen, ny = sdx / segLen;
                for (const p of this.bodyParticles) {
                    let t = ((p.x - this.mousePX) * sdx + (p.y - this.mousePY) * sdy) / (segLen * segLen);
                    t = Math.max(0, Math.min(1, t));
                    const projX = this.mousePX + t * sdx, projY = this.mousePY + t * sdy;
                    const distToSeg = Math.hypot(p.x - projX, p.y - projY);
                    if (distToSeg < this.CUT_RADIUS) {
                        const cross = sdx * (p.y - this.mousePY) - sdy * (p.x - this.mousePX);
                        const side = cross >= 0 ? 1 : -1;
                        const intensity = (1 - distToSeg / this.CUT_RADIUS);
                        const push = Math.min(segLen * 0.16, 12) * intensity;
                        p.vx += nx * side * push;
                        p.vy += ny * side * push;
                    }
                }
            }
        }

        let minX = -10000, maxX = 10000, minY = -10000, maxY = 10000;
        if (this.visibleArea && this.visibleArea.length === 4) {
            const [vx, vy, vw, vh] = this.visibleArea;
            if (vw > 100 && vh > 100) { minX = vx; maxX = vx + vw; minY = vy; maxY = vy + vh; }
        }

        for (const p of this.bodyParticles) {
            if (isNaN(p.x) || isNaN(p.y) || isNaN(p.vx) || isNaN(p.vy) || !isFinite(p.x) || !isFinite(p.y)) {
                p.x = cx + (Math.random() - 0.5) * 10;
                p.y = cy + (Math.random() - 0.5) * 10;
                p.vx = 0; p.vy = 0;
                continue;
            }
            p.x += p.vx; p.y += p.vy;
            const pr = p.radius;
            if (p.x < minX + pr) { p.x = minX + pr; p.vx *= -0.5; }
            if (p.x > maxX - pr) { p.x = maxX - pr; p.vx *= -0.5; }
            if (p.y < minY + pr) { p.y = minY + pr; p.vy *= -0.5; }
            if (p.y > maxY - pr) { p.y = maxY - pr; p.vy *= -0.5; }
        }
    },

    updateNodeCollision(nodes) {
        if (!nodes) return;
        function getNodeBounds(node) {
            if (typeof node.getBounding === 'function') {
                try {
                    var bbox = node.getBounding();
                    if (bbox && bbox.length === 4) return { x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3] };
                } catch {}
            }
            // Le titre de la node est dessine au-dessus de node.pos
            // On remonte le Y de la hauteur du titre pour couvrir le titre
            var titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
            return { x: node.pos[0], y: node.pos[1] - titleH, w: node.size[0], h: node.size[1] + titleH };
        }

        if (!this.isDragging) {
            for (const node of nodes) {
                var b = getNodeBounds(node);
                const nx = b.x, ny = b.y, nw = b.w, nh = b.h;
                const isInside = (this.x >= nx && this.x <= nx + nw && this.y >= ny && this.y <= ny + nh);
                if (isInside) {
                    const dl = this.x - nx, dr = (nx + nw) - this.x;
                    const dt = this.y - ny, db = (ny + nh) - this.y;
                    const minDist = Math.min(dl, dr, dt, db);
                    if (minDist === dl) { this.x = nx - 30; this.vx = -1.5; }
                    else if (minDist === dr) { this.x = nx + nw + 30; this.vx = 1.5; }
                    else if (minDist === dt) { this.y = ny - 30; this.vy = -1.5; }
                    else { this.y = ny + nh + 30; this.vy = 1.5; }
                }
            }
        }

        for (const p of this.bodyParticles) {
            if (isNaN(p.x) || isNaN(p.y)) continue;
            for (const node of nodes) {
                var b = getNodeBounds(node);
                const nx = b.x, ny = b.y, nw = b.w, nh = b.h, pr = p.radius;
                const isInside = (p.x >= nx && p.x <= nx + nw && p.y >= ny && p.y <= ny + nh);
                if (isInside) {
                    const dl = p.x - nx, dr = (nx + nw) - p.x;
                    const dt = p.y - ny, db = (ny + nh) - p.y;
                    const minDist = Math.min(dl, dr, dt, db);
                    if (minDist === dl) { p.x = nx - pr; p.vx = -Math.abs(p.vx) * 0.6 - 1.5; }
                    else if (minDist === dr) { p.x = nx + nw + pr; p.vx = Math.abs(p.vx) * 0.6 + 1.5; }
                    else if (minDist === dt) { p.y = ny - pr; p.vy = -Math.abs(p.vy) * 0.6 - 1.5; }
                    else { p.y = ny + nh + pr; p.vy = Math.abs(p.vy) * 0.6 + 1.5; }
                } else {
                    const cx = Math.max(nx, Math.min(p.x, nx + nw));
                    const cy = Math.max(ny, Math.min(p.y, ny + nh));
                    const dx = p.x - cx, dy = p.y - cy;
                    const dist = Math.hypot(dx, dy);
                    if (dist < pr && dist > 0.1) {
                        const force = (pr - dist) / pr * 2.5;
                        p.x += (dx / dist) * force; p.y += (dy / dist) * force;
                        p.vx += (dx / dist) * force * 1.5; p.vy += (dy / dist) * force * 1.5;
                    }
                }
            }
        }

        if (this.nodeBounceCooldown <= 0) {
            for (const p of this.bodyParticles) {
                for (const node of nodes) {
                    var b = getNodeBounds(node);
                    const nx = b.x, ny = b.y, nw = b.w, nh = b.h;
                    if (p.x >= nx && p.x <= nx + nw && p.y >= ny && p.y <= ny + nh) {
                        if (node.comfyClass?.includes("KSampler")) {
                            this.mood = "surprised"; this.moodTimer = 0;
                        }
                        this.nodeBounceCooldown = 0.3;
                        break;
                    }
                }
            }
        }
        this.nodeBounceCooldown = Math.max(0, this.nodeBounceCooldown - 0.016);
    },

    updateOrganPosition() {
        let sx = 0, sy = 0, validCount = 0;
        for (const p of this.bodyParticles) {
            if (!isNaN(p.x) && !isNaN(p.y)) { sx += p.x; sy += p.y; validCount++; }
        }
        if (validCount === 0) return;
        const comX = sx / validCount, comY = sy / validCount;
        const dx = comX - this.organX, dy = comY - this.organY;
        this.organVx += dx * 0.08; this.organVy += dy * 0.08;
        this.organVx *= 0.78; this.organVy *= 0.78;
        this.organX += this.organVx; this.organY += this.organVy;
    },

    draw(ctx) {
        const zoom = Math.max(0.01, this._canvas?.ds_scale || 1);
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(1 / zoom, 1 / zoom);
        const s = this.scale || 1;
        const ox = this.organX - this.x, oy = this.organY - this.y;
        this.drawGooeyBody(ctx, s);
        this.drawBrain(ctx, ox, oy, s);
        this.drawEyes(ctx, ox, oy, s);
        this.drawMouth(ctx, ox, oy, s);
        this.drawParticles(ctx);
        ctx.restore();
    },

    drawGooeyBody(ctx, s) {
        const particles = this.bodyParticles;
        if (particles.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of particles) {
            if (isNaN(p.x) || isNaN(p.y)) continue;
            const lx = p.x - this.x, ly = p.y - this.y, r = p.radius;
            if (lx - r < minX) minX = lx - r;
            if (ly - r < minY) minY = ly - r;
            if (lx + r > maxX) maxX = lx + r;
            if (ly + r > maxY) maxY = ly + r;
        }
        const pad = 30;
        let bw = Math.ceil(maxX - minX + pad * 2);
        let bh = Math.ceil(maxY - minY + pad * 2);
        const MAX_SIZE = 800;
        if (bw > MAX_SIZE) bw = MAX_SIZE;
        if (bh > MAX_SIZE) bh = MAX_SIZE;
        if (bw < 2 || bh < 2 || !isFinite(bw) || !isFinite(bh)) {
            this.drawFallbackBody(ctx, s);
            return;
        }
        try {
            const oc = this._offscreen, octx = this._octx;
            oc.width = bw; oc.height = bh;
            octx.clearRect(0, 0, bw, bh);
            for (const p of particles) {
                if (isNaN(p.x) || isNaN(p.y)) continue;
                const lx = p.x - this.x - minX + pad, ly = p.y - this.y - minY + pad;
                const grad = octx.createRadialGradient(lx, ly, 0, lx, ly, p.radius);
                grad.addColorStop(0, "rgba(255,255,255,1)");
                grad.addColorStop(0.5, "rgba(255,255,255,0.9)");
                grad.addColorStop(0.85, "rgba(255,255,255,0.3)");
                grad.addColorStop(1, "rgba(255,255,255,0)");
                octx.fillStyle = grad;
                octx.beginPath(); octx.arc(lx, ly, p.radius, 0, Math.PI * 2); octx.fill();
            }
            octx.filter = "blur(6px)";
            octx.drawImage(oc, 0, 0);
            octx.filter = "none";
            const bodyColor = this.getBodyColor();
            octx.save();
            octx.globalCompositeOperation = "source-in";
            octx.fillStyle = bodyColor;
            octx.fillRect(0, 0, bw, bh);
            octx.restore();
            ctx.globalAlpha = this.bodyAlpha;
            ctx.drawImage(oc, minX - pad, minY - pad);
            ctx.globalAlpha = 1;
        } catch (e) {
            this.drawFallbackBody(ctx, s);
        }
    },

    drawFallbackBody(ctx, s) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, 32 * s, 0, Math.PI * 2);
        ctx.fillStyle = this.getBodyColor();
        ctx.globalAlpha = 0.6;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    },

    getBodyColor() {
        return this.colors[this.mood] || this.colors._default;
    },

    drawBrain(ctx, ox, oy, s) {
        ctx.save();
        ctx.globalAlpha = this.brainAlpha;
        const pulse = 1 + Math.sin(this.time * 4) * 0.03;
        ctx.translate(ox, oy - 18 * s);
        ctx.scale(pulse, pulse);
        ctx.scale(this.brainSize, this.brainSize);
        ctx.fillStyle = "#ff4da6";
        ctx.beginPath();
        ctx.arc(-7 * s, -4 * s, 10 * s, 0, Math.PI * 2);
        ctx.arc(-3 * s, -11 * s, 8 * s, 0, Math.PI * 2);
        ctx.arc(-8 * s, 4 * s, 7 * s, 0, Math.PI * 2);
        ctx.arc(7 * s, -4 * s, 10 * s, 0, Math.PI * 2);
        ctx.arc(3 * s, -11 * s, 8 * s, 0, Math.PI * 2);
        ctx.arc(8 * s, 4 * s, 7 * s, 0, Math.PI * 2);
        ctx.arc(0, 6 * s, 6 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#9d004b";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(0, -18 * s); ctx.lineTo(0, 6 * s);
        ctx.arc(-5 * s, -5 * s, 4 * s, Math.PI, Math.PI * 2.5);
        ctx.moveTo(-9 * s, 3 * s); ctx.quadraticCurveTo(-5 * s, 5 * s, -1 * s, 2 * s);
        ctx.arc(5 * s, -5 * s, 4 * s, 0, Math.PI * 1.5);
        ctx.moveTo(9 * s, 3 * s); ctx.quadraticCurveTo(5 * s, 5 * s, 1 * s, 2 * s);
        ctx.stroke();
        ctx.restore();
    },

    drawEyes(ctx, ox, oy, s) {
        var es = this.eyeScale;
        var eY = this.eyeY;
        var eSpr = this.eyeSpread;
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2.5 * es;
        ctx.lineCap = "round";
        // Les sourcils suivent la position des yeux (eyeY)
        const leftEyeX = ox - eSpr * s * es, rightEyeX = ox + eSpr * s * es;
        var eyeCenterY = oy + eY * s * es;
        var browY = eyeCenterY - 12 * s * es;  // toujours 12px au-dessus de l'oeil
        ctx.beginPath();
        if (this.mood === "surprised") {
            ctx.moveTo(leftEyeX - 8 * s * es, browY - 3 * s * es);
            ctx.quadraticCurveTo(leftEyeX, browY - 8 * s * es, leftEyeX + 6 * s * es, browY - 5 * s * es);
            ctx.moveTo(rightEyeX + 8 * s * es, browY - 3 * s * es);
            ctx.quadraticCurveTo(rightEyeX, browY - 8 * s * es, rightEyeX - 6 * s * es, browY - 5 * s * es);
        } else if (this.mood === "sleepy") {
            ctx.moveTo(leftEyeX - 7 * s * es, browY + 2 * s * es); ctx.lineTo(leftEyeX + 7 * s * es, browY + 2 * s * es);
            ctx.moveTo(rightEyeX - 7 * s * es, browY + 2 * s * es); ctx.lineTo(rightEyeX + 7 * s * es, browY + 2 * s * es);
        } else {
            ctx.arc(leftEyeX, browY + 2 * s * es, 7 * s * es, Math.PI * 1.15, Math.PI * 1.85);
            ctx.moveTo(rightEyeX - 7 * s * es, browY + 2 * s * es);
            ctx.arc(rightEyeX, browY + 2 * s * es, 7 * s * es, Math.PI * 1.15, Math.PI * 1.85);
        }
        ctx.stroke();

        const drawOneEye = (ex) => {
            const eyeX = ox + ex, eyeY = oy + eY * s * es;
            const angle = Math.atan2(this.mouseY - (this.y + eyeY), this.mouseX - (this.x + eyeX));
            const lookDist = Math.min(5 * s * es, Math.hypot(this.mouseX - (this.x + eyeX), this.mouseY - (this.y + eyeY)) * 0.02);
            const pupilX = eyeX + Math.cos(angle) * lookDist;
            const pupilY = eyeY + Math.sin(angle) * lookDist;
            if (this.isBlinking) {
                ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(eyeX - 9 * s * es, eyeY); ctx.quadraticCurveTo(eyeX, eyeY + 3 * s * es, eyeX + 9 * s * es, eyeY); ctx.stroke();
                return;
            }
            const scleraR = (this.mood === "surprised" ? 11 : 9) * s * es;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(eyeX, eyeY, scleraR, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1; ctx.stroke();
            const pupilR = (this.mood === "surprised" ? 3 : 4.5) * s * es;
            ctx.fillStyle = "#0f172a";
            ctx.beginPath(); ctx.arc(pupilX, pupilY, pupilR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(pupilX - pupilR * 0.3, pupilY - pupilR * 0.3, pupilR * 0.35, 0, Math.PI * 2); ctx.fill();
        };
        drawOneEye(-eSpr * s * es); drawOneEye(eSpr * s * es);
    },

    drawMouth(ctx, ox, oy, s) {
        var mY = this.mouthY;
        var mS = this.mouthScale;
        const mouthY = oy + mY * s * mS, mouthW = (10 + this.mouthOpen * 6) * s * mS;
        if (this.mood === "surprised" && this.mouthOpen > 0.3) {
            ctx.beginPath(); ctx.ellipse(ox, mouthY, 6 * s * mS, (3 + this.mouthOpen * 6) * s * mS, 0, 0, Math.PI * 2);
            ctx.fillStyle = "#5D4037"; ctx.fill();
            ctx.beginPath(); ctx.ellipse(ox, mouthY + s * mS, 4 * s * mS, (1 + this.mouthOpen * 4) * s * mS, 0, 0, Math.PI * 2);
            ctx.fillStyle = "#D32F2F"; ctx.fill();
        } else if (this.mood === "sleepy") {
            ctx.beginPath(); ctx.ellipse(ox, mouthY, 2 * s * mS, 1.5 * s * mS, 0, 0, Math.PI * 2);
            ctx.fillStyle = "#5D4037"; ctx.fill();
        } else {
            ctx.beginPath(); ctx.arc(ox, mouthY - 2 * s, mouthW, 0.1, Math.PI - 0.1);
            ctx.strokeStyle = "#5D4037"; ctx.lineWidth = 2 * s; ctx.lineCap = "round"; ctx.stroke();
        }
    },

    addParticle(x, y, type) {
        this._fxParticles = this._fxParticles || [];
        this._fxParticles.push({
            x, y, vx: (Math.random() - 0.5) * 0.5, vy: -0.3 - Math.random() * 0.5,
            life: 1, decay: 0.008 + Math.random() * 0.005, size: 3 + Math.random() * 4,
            type: type || "bubble", hue: 30 + Math.random() * 20
        });
    },

    updateParticles(dt) {
        const arr = this._fxParticles || [];
        for (let i = arr.length - 1; i >= 0; i--) {
            const p = arr[i];
            p.x += p.vx; p.y += p.vy;
            p.life -= p.decay;
            if (p.life <= 0) arr.splice(i, 1);
        }
    },

    drawParticles(ctx) {
        const arr = this._fxParticles || [];
        for (const p of arr) {
            const lx = p.x - this.x, ly = p.y - this.y;
            if (p.type === "zzz") {
                ctx.save();
                ctx.font = `${12 + (1 - p.life) * 8}px serif`;
                ctx.fillStyle = `rgba(100, 200, 100, ${p.life * 0.6})`;
                ctx.fillText("z", lx, ly);
                ctx.restore();
            } else {
                ctx.beginPath(); ctx.arc(lx, ly, p.size * p.life, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.life * 0.5})`;
                ctx.fill();
            }
        }
    },

    hitTest(mx, my) {
        for (const p of this.bodyParticles) {
            const dx = mx - p.x, dy = my - p.y;
            if (dx * dx + dy * dy < (p.radius * 2.5) ** 2) return true;
        }
        return false;
    },

    onMouseDown(pos) {
        if (this.hitTest(pos[0], pos[1])) {
            this._openChatModal();
            this.mood = "happy"; this.moodTimer = 0;
            for (let i = 0; i < 3; i++) this.addParticle(this.x + (Math.random() - 0.5) * 20, this.y + (Math.random() - 0.5) * 20, "sparkle");
            return true;
        }
        return false;
    },

    onMouseMove(pos) {},

    onMouseUp() {},

// ─── Chat modal ────────────────────────────────────────────────

    _openChatSettings() {
        var existing = document.getElementById('blobby-chat-settings');
        if (existing) { existing.style.display = 'flex'; return; }

        var _self = this;
        var modal = document.createElement('div');
        modal.id = 'blobby-chat-settings';
        Object.assign(modal.style, {
            position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            width: '380px', background: '#1e1e24', borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: '100000',
            border: '1px solid #333', overflow: 'hidden', fontSize: '13px',
            display: 'flex', flexDirection: 'column', maxHeight: '80vh',
        });

        var header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderBottom: '1px solid #333', background: '#2a2a2e', flexShrink: '0',
        });
        var title = document.createElement('span');
        title.textContent = '⚙️ Blobby';
        title.style.color = '#FF8F00';
        title.style.fontWeight = '600';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, { background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', padding: '0 4px' });
        closeBtn.onmouseenter = () => closeBtn.style.color = '#f87171';
        closeBtn.onmouseleave = () => closeBtn.style.color = '#888';
        closeBtn.onclick = () => modal.style.display = 'none';
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Tabs
        var tabsBar = document.createElement('div');
        Object.assign(tabsBar.style, {
            display: 'flex', borderBottom: '1px solid #333', background: '#1a1a1e', flexShrink: '0',
        });

        var tabNames = ['provider', 'character', 'appearance'];
        var tabLabels = { provider: 'Général', character: 'Caractère', appearance: 'Apparence' };
        var tabContent = document.createElement('div');
        Object.assign(tabContent.style, { padding: '14px', overflowY: 'auto', flex: '1', display: 'flex', flexDirection: 'column', gap: '12px' });

        function switchTab(name) {
            tabsBar.querySelectorAll('.bcs-tab').forEach(function(b) { b.style.borderBottom = '2px solid transparent'; b.style.color = '#888'; });
            var btn = document.getElementById('bcs-tab-' + name);
            if (btn) { btn.style.borderBottom = '2px solid #FF8F00'; btn.style.color = '#fff'; }
            document.querySelectorAll('.bcs-tab-content').forEach(function(d) { d.style.display = 'none'; });
            var el = document.getElementById('bcs-content-' + name);
            if (el) el.style.display = 'flex';
        }

        tabNames.forEach(function(name) {
            var btn = document.createElement('button');
            btn.id = 'bcs-tab-' + name;
            btn.className = 'bcs-tab';
            btn.textContent = tabLabels[name];
            Object.assign(btn.style, {
                flex: '1', padding: '8px 12px', border: 'none', cursor: 'pointer',
                background: 'transparent', fontSize: '12px', transition: 'all 0.15s',
                borderBottom: '2px solid transparent', color: '#888',
            });
            btn.onclick = function() { switchTab(name); };
            tabsBar.appendChild(btn);
        });

        // ── Tab Provider ──
        var provContent = document.createElement('div');
        provContent.id = 'bcs-content-provider';
        provContent.className = 'bcs-tab-content';
        Object.assign(provContent.style, { display: 'flex', flexDirection: 'column', gap: '12px' });

        var pLabel = document.createElement('label');
        pLabel.textContent = 'Provider LLM';
        Object.assign(pLabel.style, { fontSize: '12px', color: '#94a3b8', fontWeight: '600' });

        var select = document.createElement('select');
        select.id = 'blobby-chat-preset';
        Object.assign(select.style, {
            width: '100%', padding: '8px 10px', borderRadius: '6px',
            border: '1px solid #555', background: '#1a1a1e', color: '#fff',
            fontSize: '12px', outline: 'none',
        });
        select.innerHTML = '<option value="">Chargement...</option>';

        (async function() {
            try {
                var cfg = {};
                try { cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {}; } catch {}
                var baseUrl = (cfg.serverUrl || 'https://kw.holaf.fr').replace(/\/+$/, '');
                var headers = { 'Content-Type': 'application/json' };
                if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
                var res = await fetch(baseUrl + '/api/presets', { headers });
                if (!res.ok) { select.innerHTML = '<option value="">Erreur chargement</option>'; return; }
                var presets = await res.json();
                var savedPreset = cfg.blobbyPreset || '';
                select.innerHTML = '<option value="">-- Provider LLM --</option>';
                presets.forEach(function(p) {
                    var opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name + (p.is_global ? ' 🌐' : '') + (p.is_client_side ? ' 🖥️' : '');
                    if (String(p.id) === String(savedPreset)) opt.selected = true;
                    select.appendChild(opt);
                });
            } catch (e) { select.innerHTML = '<option value="">Erreur: ' + (e.message || '') + '</option>'; }
        })();

        select.onchange = function() {
            try {
                var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
                cfg.blobbyPreset = select.value;
                localStorage.setItem('FRIA_config', JSON.stringify(cfg));
            } catch {}
        };

        var pNote = document.createElement('p');
        pNote.textContent = 'Provider utilise par Blobby pour discuter. Configure les providers dans FR.IA > Parametres.';
        Object.assign(pNote.style, { fontSize: '11px', color: '#64748b', lineHeight: '1.4', margin: '0' });

        provContent.appendChild(pLabel);
        provContent.appendChild(select);
        provContent.appendChild(pNote);

        // ── FPS Control ──
        var fpsSeparator = document.createElement('hr');
        Object.assign(fpsSeparator.style, { border: 'none', borderTop: '1px solid #333', margin: '4px 0' });
        provContent.appendChild(fpsSeparator);

        var fpsLabel = document.createElement('label');
        fpsLabel.textContent = 'Animation (FPS)';
        Object.assign(fpsLabel.style, { fontSize: '12px', color: '#94a3b8', fontWeight: '600' });

        // Lire la valeur sauvegardee
        var savedFps = 30;
        try {
            var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
            savedFps = parseInt(cfg.blobbyFps) || 30;
        } catch {}

        var fpsContainer = document.createElement('div');
        Object.assign(fpsContainer.style, { display: 'flex', alignItems: 'center', gap: '10px' });

        var fpsRange = document.createElement('input');
        fpsRange.type = 'range';
        fpsRange.id = 'blobby-fps-range';
        Object.assign(fpsRange.style, { flex: '1', accentColor: '#FF8F00' });
        fpsRange.min = 0;
        fpsRange.max = 120;
        fpsRange.step = 5;
        fpsRange.value = savedFps;

        var fpsValue = document.createElement('span');
        fpsValue.id = 'blobby-fps-value';
        fpsValue.textContent = savedFps > 0 ? savedFps + ' fps' : 'Off';
        Object.assign(fpsValue.style, { fontSize: '12px', color: '#e2e8f0', minWidth: '45px', textAlign: 'right', fontWeight: '600' });

        fpsRange.oninput = function() {
            var v = parseInt(this.value) || 0;
            fpsValue.textContent = v > 0 ? v + ' fps' : 'Off';
            _self._saveFpsSetting(v);
            _self._restartAnimationInterval(v);
        };

        var fpsNote = document.createElement('p');
        fpsNote.textContent = 'Regle la frequence d\'animation de Blobby. 0 = arrete, 30 = fluide, 60+ = tres fluide (attention perf).';
        Object.assign(fpsNote.style, { fontSize: '11px', color: '#64748b', lineHeight: '1.4', margin: '0' });

        fpsContainer.appendChild(fpsRange);
        fpsContainer.appendChild(fpsValue);
        provContent.appendChild(fpsLabel);
        provContent.appendChild(fpsContainer);
        provContent.appendChild(fpsNote);

        // ── Tab Caractere ──
        var charContent = document.createElement('div');
        charContent.id = 'bcs-content-character';
        charContent.className = 'bcs-tab-content';
        Object.assign(charContent.style, { display: 'none', flexDirection: 'column', gap: '12px' });

        var cLabel = document.createElement('label');
        cLabel.textContent = 'Personnalite de Blobby';
        Object.assign(cLabel.style, { fontSize: '12px', color: '#94a3b8', fontWeight: '600' });

        var cNote = document.createElement('p');
        cNote.textContent = 'Ce texte definit comment Blobby se comporte. Plus c\'est detaille, mieux c\'est.';
        Object.assign(cNote.style, { fontSize: '11px', color: '#64748b', lineHeight: '1.4', margin: '0' });

        var ta = document.createElement('textarea');
        ta.id = 'blobby-chat-character';
        Object.assign(ta.style, {
            width: '100%', minHeight: '140px', padding: '8px 10px', borderRadius: '6px',
            border: '1px solid #555', background: '#1a1a1e', color: '#fff',
            fontSize: '12px', outline: 'none', resize: 'vertical',
            fontFamily: 'inherit', lineHeight: '1.5',
        });

        // Charger le caractere sauvegarde ou celui par defaut
        try {
            var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
            ta.value = cfg.blobbyCharacter || _blobbyDefaultCharacter;
        } catch { ta.value = _blobbyDefaultCharacter; }

        // Reset au defaut
        var resetBtn = document.createElement('button');
        resetBtn.textContent = '↺ Reset defaut';
        Object.assign(resetBtn.style, {
            alignSelf: 'flex-start', padding: '4px 10px', borderRadius: '4px',
            border: '1px solid #555', background: 'transparent', color: '#94a3b8',
            cursor: 'pointer', fontSize: '11px',
        });
        resetBtn.onmouseenter = () => resetBtn.style.background = '#333';
        resetBtn.onmouseleave = () => resetBtn.style.background = 'transparent';
        resetBtn.onclick = function() {
            ta.value = _blobbyDefaultCharacter;
            _self._saveChatCharacter(ta.value);
        };

        ta.oninput = function() { _self._saveChatCharacter(ta.value); };

        charContent.appendChild(cLabel);
        charContent.appendChild(cNote);
        charContent.appendChild(ta);
        charContent.appendChild(resetBtn);

        // ── Tab Apparence ──
        var appContent = document.createElement('div');
        appContent.id = 'bcs-content-appearance';
        appContent.className = 'bcs-tab-content';
        Object.assign(appContent.style, { display: 'none', flexDirection: 'column', gap: '12px' });

        // Helper pour creer un slider
        function makeSlider(label, id, min, max, step, val, suffix, onChange) {
            var row = document.createElement('div');
            var lbl = document.createElement('label');
            lbl.textContent = label;
            Object.assign(lbl.style, { fontSize: '11px', color: '#94a3b8', fontWeight: '600' });
            var cont = document.createElement('div');
            Object.assign(cont.style, { display: 'flex', alignItems: 'center', gap: '8px' });
            var input = document.createElement('input');
            input.type = 'range';
            input.id = id;
            Object.assign(input.style, { flex: '1', accentColor: '#FF8F00' });
            input.min = min; input.max = max; input.step = step; input.value = val;
            var valSpan = document.createElement('span');
            valSpan.textContent = val + (suffix || '');
            Object.assign(valSpan.style, { fontSize: '11px', color: '#e2e8f0', minWidth: '35px', textAlign: 'right' });
            input.oninput = function() {
                var v = parseFloat(this.value);
                valSpan.textContent = v + (suffix || '');
                if (onChange) onChange(v);
            };
            cont.appendChild(input);
            cont.appendChild(valSpan);
            row.appendChild(lbl);
            row.appendChild(cont);
            return row;
        }

        // Helper pour creer un color picker
        function makeColorPicker(label, color, onChange) {
            var row = document.createElement('div');
            Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });
            var lbl = document.createElement('span');
            lbl.textContent = label;
            Object.assign(lbl.style, { fontSize: '11px', color: '#94a3b8', flex: '1' });
            var input = document.createElement('input');
            input.type = 'color';
            input.id = 'bapp-color-' + label.replace(/[^a-z]/gi,'').toLowerCase();
            input.value = color;
            Object.assign(input.style, { width: '32px', height: '24px', padding: '0', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' });
            input.oninput = function() { if (onChange) onChange(this.value); };
            row.appendChild(lbl);
            row.appendChild(input);
            return row;
        }

        var _saveAppearance = function() {
            try {
                var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
                var a = cfg.blobbyAppearance || {};
                a.numParticles = parseInt(document.getElementById('bapp-particles')?.value) || 60;
                a.bodyAlpha = (parseFloat(document.getElementById('bapp-body-alpha')?.value) || 100) / 100;
                a.brainAlpha = (parseFloat(document.getElementById('bapp-brain-alpha')?.value) || 100) / 100;
                a.brainSize = parseFloat(document.getElementById('bapp-brain-size')?.value) || 1;
                a.eyeY = parseFloat(document.getElementById('bapp-eye-y')?.value) || 6;
                a.eyeSpread = parseFloat(document.getElementById('bapp-eye-spread')?.value) || 15;
                a.eyeScale = parseFloat(document.getElementById('bapp-eye-scale')?.value) || 1;
                a.mouthY = parseFloat(document.getElementById('bapp-mouth-y')?.value) || 22;
                a.mouthScale = parseFloat(document.getElementById('bapp-mouth-scale')?.value) || 1;
                // Couleurs
                a.colors = {};
                ['happy','surprised','sleepy','_default'].forEach(function(k) {
                    var el = document.getElementById('bapp-color-' + k);
                    if (el) a.colors[k] = el.value;
                });
                cfg.blobbyAppearance = a;
                localStorage.setItem('FRIA_config', JSON.stringify(cfg));
                _self._loadAppearance();
            } catch {}
        };

        function _onAppChange() { _saveAppearance(); }

        // Charger valeurs actuelles
        var _app = {};
        try { var _acfg = JSON.parse(localStorage.getItem('FRIA_config')) || {}; _app = _acfg.blobbyAppearance || {}; } catch {}

        appContent.appendChild(makeSlider('Particules', 'bapp-particles', 10, 120, 5, _app.numParticles || 60, '', _onAppChange));

        var sep1 = document.createElement('hr');
        Object.assign(sep1.style, { border: 'none', borderTop: '1px solid #333', margin: '4px 0' });
        appContent.appendChild(sep1);

        var secLabel = document.createElement('span');
        secLabel.textContent = 'Transparences';
        Object.assign(secLabel.style, { fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' });
        appContent.appendChild(secLabel);
        appContent.appendChild(makeSlider('Corps', 'bapp-body-alpha', 0, 100, 5, Math.round((_app.bodyAlpha || 1) * 100), '%', function(v) { _onAppChange(); }));
        appContent.appendChild(makeSlider('Cerveau', 'bapp-brain-alpha', 0, 100, 5, Math.round((_app.brainAlpha || 1) * 100), '%', _onAppChange));

        var sep2 = document.createElement('hr');
        Object.assign(sep2.style, { border: 'none', borderTop: '1px solid #333', margin: '4px 0' });
        appContent.appendChild(sep2);

        var secLabel2 = document.createElement('span');
        secLabel2.textContent = 'Yeux';
        Object.assign(secLabel2.style, { fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' });
        appContent.appendChild(secLabel2);
        appContent.appendChild(makeSlider('Hauteur', 'bapp-eye-y', -20, 30, 1, _app.eyeY || 6, '', _onAppChange));
        appContent.appendChild(makeSlider('Écartement', 'bapp-eye-spread', 5, 40, 1, _app.eyeSpread || 15, '', _onAppChange));
        appContent.appendChild(makeSlider('Taille', 'bapp-eye-scale', 0.2, 3, 0.1, _app.eyeScale || 1, '', _onAppChange));

        var sep3 = document.createElement('hr');
        Object.assign(sep3.style, { border: 'none', borderTop: '1px solid #333', margin: '4px 0' });
        appContent.appendChild(sep3);

        var secLabel3 = document.createElement('span');
        secLabel3.textContent = 'Bouche';
        Object.assign(secLabel3.style, { fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' });
        appContent.appendChild(secLabel3);
        appContent.appendChild(makeSlider('Hauteur', 'bapp-mouth-y', 10, 40, 1, _app.mouthY || 22, '', _onAppChange));
        appContent.appendChild(makeSlider('Taille', 'bapp-mouth-scale', 0.2, 3, 0.1, _app.mouthScale || 1, '', _onAppChange));

        var sep4 = document.createElement('hr');
        Object.assign(sep4.style, { border: 'none', borderTop: '1px solid #333', margin: '4px 0' });
        appContent.appendChild(sep4);

        var secLabel4 = document.createElement('span');
        secLabel4.textContent = 'Cerveau';
        Object.assign(secLabel4.style, { fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' });
        appContent.appendChild(secLabel4);
        appContent.appendChild(makeSlider('Taille', 'bapp-brain-size', 0.2, 3, 0.1, _app.brainSize || 1, '', _onAppChange));

        var sep5 = document.createElement('hr');
        Object.assign(sep5.style, { border: 'none', borderTop: '1px solid #333', margin: '4px 0' });
        appContent.appendChild(sep5);

        var secLabel5 = document.createElement('span');
        secLabel5.textContent = 'Couleurs par humeur';
        Object.assign(secLabel5.style, { fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' });
        appContent.appendChild(secLabel5);

        var moods = [
            { key: 'happy', label: '😊 Heureux' },
            { key: 'surprised', label: '😮 Surpris' },
            { key: 'sleepy', label: '😴 Endormi' },
            { key: '_default', label: '😐 Neutre' },
        ];
        moods.forEach(function(m) {
            var curColors = _app.colors || {};
            var c = curColors[m.key] || Blobby.colors[m.key] || '#FF8F00';
            // On remplace makeColorPicker pour controler l'id
            var row = document.createElement('div');
            Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });
            var lbl = document.createElement('span');
            lbl.textContent = m.label;
            Object.assign(lbl.style, { fontSize: '11px', color: '#94a3b8', flex: '1' });
            var input = document.createElement('input');
            input.type = 'color';
            input.id = 'bapp-color-' + m.key;
            input.value = c;
            Object.assign(input.style, { width: '32px', height: '24px', padding: '0', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' });
            input.oninput = function() { _onAppChange(); };
            row.appendChild(lbl);
            row.appendChild(input);
            appContent.appendChild(row);
        });

        tabContent.appendChild(provContent);
        tabContent.appendChild(charContent);
        tabContent.appendChild(appContent);

        modal.appendChild(header);
        modal.appendChild(tabsBar);
        modal.appendChild(tabContent);
        document.body.appendChild(modal);

        // Drag
        (function(hdr, mdl) {
            var d = { active: false, sx: 0, sy: 0, ox: 0, oy: 0 };
            hdr.addEventListener('mousedown', function(e) {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                d.active = true;
                var r = mdl.getBoundingClientRect();
                d.sx = e.clientX; d.sy = e.clientY;
                d.ox = r.left; d.oy = r.top;
                mdl.style.position = 'fixed';
                mdl.style.left = r.left + 'px';
                mdl.style.top = r.top + 'px';
                mdl.style.transform = 'none';
                mdl.style.margin = '0';
                hdr.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', function(e) {
                if (!d.active) return;
                mdl.style.left = (d.ox + e.clientX - d.sx) + 'px';
                mdl.style.top = (d.oy + e.clientY - d.sy) + 'px';
            });
            document.addEventListener('mouseup', function() {
                if (d.active) { d.active = false; hdr.style.cursor = ''; }
            });
        })(header, modal);

        // Activer le premier onglet
        switchTab('provider');
    },

    _saveChatCharacter(text) {
        _blobbySaveCharacter(text);
    },

    getCharacter: function() {
        return _blobbyLoadCharacter(_blobbyDefaultCharacter);
    },

    _saveChatHistory() {
        var msgs = document.getElementById('blobby-chat-msgs');
        if (!msgs) return;
        var history = [];
        msgs.querySelectorAll('.blobby-msg').forEach(function(el) {
            history.push({ role: el.dataset.role, text: el.innerHTML });
        });
        if (history.length > 50) history = history.slice(-50);
        _blobbySaveChatHistory(history);
    },

    _openChatModal() {
        // Si deja ouverte, la ramener au premier plan
        var existing = document.getElementById('blobby-chat-modal');
        if (existing) {
            existing.style.display = 'flex';
            existing.style.zIndex = '99999';
            existing.querySelector('.blobby-chat-input')?.focus();
            return;
        }

        // Restaurer la position/taille/opacite sauvegardees
        var savedState = {};
        try { var scfg = JSON.parse(localStorage.getItem('FRIA_config')) || {}; savedState = scfg.blobbyChatState || {}; } catch {}

        var modal = document.createElement('div');
        modal.id = 'blobby-chat-modal';
        Object.assign(modal.style, {
            position: 'fixed',
            width: (savedState.w || '360') + 'px',
            height: (savedState.h || '420') + 'px',
            background: '#1e1e24', borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: '99999', display: 'flex', flexDirection: 'column',
            border: '1px solid #333', overflow: 'hidden',
            fontSize: '13px', resize: 'both', minWidth: '280px', minHeight: '200px',
        });
        modal.style.left = (savedState.x || '20') + 'px';
        modal.style.bottom = (savedState.y || '20') + 'px';
        modal.style.top = 'auto';

        // Header
        var header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', cursor: 'grab', userSelect: 'none',
            borderBottom: '1px solid #333', background: '#2a2a2e', flexShrink: '0',
        });
        var title = document.createElement('span');
        title.innerHTML = '🧡 <b>Blobby</b>';
        title.style.color = '#FF8F00';
        var syncDot = document.createElement('span');
        syncDot.id = 'blobby-sync-status';
        Object.assign(syncDot.style, { fontSize: '9px', marginLeft: '4px', cursor: 'help' });
        // Initialiser l'indicateur
        setTimeout(function() { _blobbySyncIndicator(); }, 100);

        // Slider transparence
        var alphaSlider = document.createElement('input');
        alphaSlider.type = 'range';
        Object.assign(alphaSlider.style, { width: '60px', accentColor: '#FF8F00', margin: '0 4px', cursor: 'pointer' });
        alphaSlider.min = 10;
        alphaSlider.max = 100;
        alphaSlider.value = savedState.alpha || 100;
        modal.style.opacity = (savedState.alpha || 100) / 100;
        alphaSlider.oninput = function() {
            var v = parseInt(this.value) / 100;
            modal.style.opacity = v;
            try {
                var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
                if (!cfg.blobbyChatState) cfg.blobbyChatState = {};
                cfg.blobbyChatState.alpha = parseInt(this.value);
                localStorage.setItem('FRIA_config', JSON.stringify(cfg));
                // Sync vers serveur
                var r = modal.getBoundingClientRect();
                _blobbySaveChatState({
                    x: Math.round(r.left), y: Math.round(window.innerHeight - r.top - r.height),
                    w: Math.round(r.width), h: Math.round(r.height),
                    alpha: parseInt(this.value),
                });
            } catch {}
        };

        var headerRight = document.createElement('div');
        Object.assign(headerRight.style, { display: 'flex', alignItems: 'center', gap: '6px' });
        var settingsBtn = document.createElement('button');
        settingsBtn.innerHTML = '⚙️';
        Object.assign(settingsBtn.style, { background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: '0 4px' });
        settingsBtn.onmouseenter = () => settingsBtn.style.color = '#fff';
        settingsBtn.onmouseleave = () => settingsBtn.style.color = '#888';
        settingsBtn.onclick = (e) => { e.stopPropagation(); _self._openChatSettings(); };
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, { background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', padding: '0 4px' });
        closeBtn.onmouseenter = () => closeBtn.style.color = '#f87171';
        closeBtn.onmouseleave = () => closeBtn.style.color = '#888';
        function _saveChatState() {
            try {
                var r = modal.getBoundingClientRect();
                var state = {
                    x: Math.round(r.left), y: Math.round(window.innerHeight - r.top - r.height),
                    w: Math.round(r.width), h: Math.round(r.height),
                    alpha: parseInt(alphaSlider.value),
                };
                _blobbySaveChatState(state);
            } catch {}
        }
        // ResizeObserver pour sauvegarder lors du redimensionnement
        var ro = new ResizeObserver(_saveChatState);
        ro.observe(modal);

        closeBtn.onclick = () => {
            _saveChatState();
            modal.style.display = 'none';
        };
        headerRight.appendChild(settingsBtn);
        headerRight.appendChild(closeBtn);
        header.appendChild(title);
        title.appendChild(syncDot);
        header.appendChild(alphaSlider);
        header.appendChild(headerRight);

        // Messages area
        var messages = document.createElement('div');
        messages.id = 'blobby-chat-msgs';
        Object.assign(messages.style, {
            flex: '1', overflowY: 'auto', padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: '8px',
        });

        // Restaurer l'historique
        var history = _blobbyLoadChatHistory();
        history.forEach(function(msg) {
            var div = document.createElement('div');
            div.className = 'blobby-msg';
            div.dataset.role = msg.role;
            Object.assign(div.style, {
                padding: '6px 10px', borderRadius: '8px', fontSize: '12px',
                lineHeight: '1.4', maxWidth: '85%', wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
            });
            if (msg.role === 'user') {
                div.style.background = '#6366f1'; div.style.color = '#fff';
                div.style.alignSelf = 'flex-end';
                div.textContent = msg.text;
            } else if (msg.role === 'blobby') {
                div.style.background = '#2a2a2e'; div.style.color = '#e2e8f0';
                div.style.alignSelf = 'flex-start'; div.style.border = '1px solid #444';
                div.innerHTML = msg.text;
            } else if (msg.role === 'system') {
                div.style.background = 'transparent'; div.style.color = '#888';
                div.style.alignSelf = 'center'; div.style.fontSize = '11px';
                div.textContent = msg.text;
            } else if (msg.role === 'action') {
                div.style.background = '#1a3a1a'; div.style.color = '#86efac';
                div.style.alignSelf = 'center'; div.style.fontSize = '11px';
                div.style.border = '1px solid #166534';
                div.innerHTML = '⚡ ' + msg.text;
            }
            messages.appendChild(div);
        });

        if (messages.children.length === 0) {
            // Message de bienvenue si aucun historique
            this._addChatMessage(messages, 'blobby', '👋 Salut ! Clique sur un nœud ou pose-moi une question sur le workflow.');
        }
        messages.scrollTop = messages.scrollHeight;

        // Contexte (en bas de la zone de messages)
        var ctxBar = document.createElement('div');
        ctxBar.id = 'blobby-chat-ctx';
        Object.assign(ctxBar.style, {
            padding: '3px 12px', fontSize: '10px', color: '#555',
            textAlign: 'right', borderTop: '1px solid #2a2a2e', flexShrink: '0',
            userSelect: 'none',
        });
        function _updateCtxBar() {
            var totalChars = 0;
            messages.querySelectorAll('.blobby-msg').forEach(function(el) {
                totalChars += (el.textContent || '').length;
            });
            var estTokens = Math.round(totalChars / 4);
            var maxCtx = parseInt(ctxBar.dataset.maxCtx) || 4096;
            ctxBar.textContent = '~' + estTokens + ' tokens | ' + maxCtx + ' max';
            var pct = estTokens / maxCtx;
            ctxBar.style.color = pct > 0.75 ? '#f87171' : (pct > 0.5 ? '#facc15' : '#555');
        }
        _updateCtxBar();

        // Input area
        var inputArea = document.createElement('div');
        Object.assign(inputArea.style, {
            display: 'flex', gap: '6px', padding: '8px 10px',
            borderTop: '1px solid #333', background: '#2a2a2e',
        });
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'blobby-chat-input';
        Object.assign(input.style, {
            flex: '1', padding: '6px 10px', borderRadius: '6px',
            border: '1px solid #555', background: '#1a1a1e', color: '#fff',
            fontSize: '12px', outline: 'none',
        });
        input.placeholder = 'Parle a Blobby...';

        var sendBtn = document.createElement('button');
        sendBtn.textContent = '➤';
        Object.assign(sendBtn.style, {
            padding: '6px 12px', borderRadius: '6px', border: 'none',
            background: '#6366f1', color: '#fff', cursor: 'pointer',
            fontSize: '14px', fontWeight: '600',
        });
        sendBtn.onmouseenter = () => sendBtn.style.background = '#4f46e5';
        sendBtn.onmouseleave = () => sendBtn.style.background = '#6366f1';

        var _self = this;
        function sendMessage() {
            var text = input.value.trim();
            if (!text) return;
            input.value = '';
            _self._addChatMessage(messages, 'user', text);
            _self._handleChatMessage(messages, text);
        }

        input.onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };
        sendBtn.onclick = sendMessage;

        inputArea.appendChild(input);
        inputArea.appendChild(sendBtn);

        modal.appendChild(header);
        modal.appendChild(messages);
        modal.appendChild(ctxBar);
        modal.appendChild(inputArea);
        document.body.appendChild(modal);
        input.focus();

        // Drag
        (function(header, modal) {
            var drag = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
            header.addEventListener('mousedown', (e) => {
                if (e.target === closeBtn) return;
                drag.active = true;
                var rect = modal.getBoundingClientRect();
                drag.startX = e.clientX; drag.startY = e.clientY;
                drag.origX = rect.left; drag.origY = rect.top;
                header.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!drag.active) return;
                modal.style.left = (drag.origX + e.clientX - drag.startX) + 'px';
                modal.style.top = (drag.origY + e.clientY - drag.startY) + 'px';
                modal.style.bottom = 'auto';
            });
            document.addEventListener('mouseup', () => {
                if (drag.active) {
                    drag.active = false;
                    header.style.cursor = 'grab';
                    _saveChatState();
                }
            });
        })(header, modal);
    },

    _addChatMessage(container, role, text) {
        var div = document.createElement('div');
        div.className = 'blobby-msg';
        div.dataset.role = role;
        Object.assign(div.style, {
            padding: '6px 10px', borderRadius: '8px', fontSize: '12px',
            lineHeight: '1.4', maxWidth: '85%', wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
        });
        if (role === 'user') {
            div.style.background = '#6366f1';
            div.style.color = '#fff';
            div.style.alignSelf = 'flex-end';
            div.textContent = text;
        } else if (role === 'blobby') {
            div.style.background = '#2a2a2e';
            div.style.color = '#e2e8f0';
            div.style.alignSelf = 'flex-start';
            div.style.border = '1px solid #444';
            div.innerHTML = text;
        } else if (role === 'system') {
            div.style.background = 'transparent';
            div.style.color = '#888';
            div.style.alignSelf = 'center';
            div.style.fontSize = '11px';
            div.textContent = text;
        } else if (role === 'action') {
            div.style.background = '#1a3a1a';
            div.style.color = '#86efac';
            div.style.alignSelf = 'center';
            div.style.fontSize = '11px';
            div.style.border = '1px solid #166534';
            div.innerHTML = '⚡ ' + text;
        }
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        this._saveChatHistory();
        // Mettre a jour la barre de contexte
        var ctxBar = document.getElementById('blobby-chat-ctx');
        if (ctxBar) {
            var totalChars = 0;
            container.querySelectorAll('.blobby-msg').forEach(function(el) {
                totalChars += (el.textContent || '').length;
            });
            var estTokens = Math.round(totalChars / 4);
            var maxCtx = parseInt(ctxBar.dataset.maxCtx) || 4096;
            ctxBar.textContent = '~' + estTokens + ' tokens | ' + maxCtx + ' max';
            var pct = estTokens / maxCtx;
            ctxBar.style.color = pct > 0.75 ? '#f87171' : (pct > 0.5 ? '#facc15' : '#555');
        }
    },

    async _handleChatMessage(container, userText) {
        this._addChatMessage(container, 'system', '🤔 Blobby réfléchit...');

        try {
            // Construire le contexte : workflow actuel
            var workflowDesc = this._describeWorkflow();

            // Recuperer le preset LLM depuis FRIA_config
            var cfg = {};
            try { cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {}; } catch {}
            var presetId = cfg.blobbyPreset || '';

            if (!presetId) {
                this._addChatMessage(container, 'blobby',
                    '⚠️ Configure d\'abord un provider LLM dans les ☰ Paramètres &gt; Provider LLM, ou clique sur ⚙️ dans le chat.');
                return;
            }

            var character = this.getCharacter();
            var moodDesc = this.mood === 'happy' ? '😊 Tout content et joyeux !'
                : this.mood === 'surprised' ? '😮 Surpris et curieux !'
                : this.mood === 'sleepy' ? '😴 Endormi et lent...'
                : '😐 Neutre';
            var instruction = character + '\n\n'
                + 'Humeur actuelle : ' + moodDesc + '\n'
                + '(Ton \"Blobby\" doit refletter cette humeur)\n\n'
                + 'Workflow actuel :\n' + workflowDesc + '\n\n'
                + 'Instructions :\n'
                + '- Si l\'utilisateur demande une action, reponds avec la commande entre crochets.\n'
                + '- Commandes disponibles :\n'
                + '  [MOVE_TO nom_du_noeud] - Deplace la vue vers un nœud\n'
                + '  [SET nom_du_noeud parametre valeur] - Modifie un parametre\n'
                + '  [FOCUS nom_du_noeud] - Met en surbrillance un nœud\n\n'
                + 'Message de l\'utilisateur : ' + userText;

            var baseUrl = (cfg.serverUrl || 'https://kw.holaf.fr').replace(/\/+$/, '');
            var headers = { 'Content-Type': 'application/json' };
            if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;

            var res = await fetch(baseUrl + '/api/keywords/llm-process', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    preset_id: parseInt(presetId),
                    instruction: instruction
                })
            });

            // Enlever le message "réfléchit"
            var thinking = container.querySelector('div:last-child');
            if (thinking && thinking.textContent === '🤔 Blobby réfléchit...') thinking.remove();

            var data = await res.json().catch(() => ({}));
            if (!res.ok) {
                this._addChatMessage(container, 'blobby',
                    '😅 Désolé, j\'ai eu un problème : ' + (data.error || 'Erreur ' + res.status));
                return;
            }

            var reply = data.output || '...';
            // Mettre a jour le max context si disponible
            if (data.max_context) {
                var ctxBar = document.getElementById('blobby-chat-ctx');
                if (ctxBar) ctxBar.dataset.maxCtx = data.max_context;
            }
            // Executer les commandes dans la reponse
            reply = this._executeCommands(reply);
            this._addChatMessage(container, 'blobby', reply);

        } catch (e) {
            var thinking = container.querySelector('div:last-child');
            if (thinking && thinking.textContent === '🤔 Blobby réfléchit...') thinking.remove();
            this._addChatMessage(container, 'system', '❌ Erreur: ' + (e.message || ''));
        }
    },

    _describeWorkflow() {
        var app = window.app || window.comfyAPI?.app?.app;
        if (!app || !app.graph || !app.graph.nodes) return 'Aucun workflow ouvert.';

        var nodes = app.graph.nodes;
        var desc = 'Ce workflow contient ' + nodes.length + ' nœud(s) :\n';
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var title = n.title || n.comfyClass || 'Inconnu';
            var widgets = '';
            if (n.widgets && n.widgets.length > 0) {
                widgets = ' [' + n.widgets.map(function(w) {
                    if (w.type === 'number' || w.type === 'slider') return w.name + '=' + w.value;
                    if (w.type === 'combo') return w.name + '=' + (w.value || '');
                    return w.name;
                }).join(', ') + ']';
            }
            desc += '  - ' + title + widgets + '\n';
        }
        return desc;
    },

    _executeCommands(reply) {
        // Executer les commandes [MOVE_TO ...], [SET ...], [FOCUS ...]
        var app = window.app || window.comfyAPI?.app?.app;
        if (!app || !app.graph || !app.graph.nodes) return reply;

        var result = reply;
        var commandsFound = false;

        // [MOVE_TO nom_du_noeud]
        result = result.replace(/\[MOVE_TO\s+([^\]]+)\]/gi, (match, nodeName) => {
            commandsFound = true;
            var name = nodeName.trim().toLowerCase();
            for (var i = 0; i < app.graph.nodes.length; i++) {
                var n = app.graph.nodes[i];
                var title = (n.title || n.comfyClass || '').toLowerCase();
                if (title.includes(name)) {
                    app.canvas.centerOnNode(n);
                    return '✅ Vue déplacée vers "' + (n.title || n.comfyClass) + '"';
                }
            }
            return '⚠️ Nœud "' + nodeName.trim() + '" introuvable';
        });

        // [FOCUS nom_du_noeud]
        result = result.replace(/\[FOCUS\s+([^\]]+)\]/gi, (match, nodeName) => {
            commandsFound = true;
            var name = nodeName.trim().toLowerCase();
            for (var i = 0; i < app.graph.nodes.length; i++) {
                var n = app.graph.nodes[i];
                var title = (n.title || n.comfyClass || '').toLowerCase();
                if (title.includes(name)) {
                    // Mettre en surbrillance en centrant + animant
                    n.color = '#FF8F00';
                    n.bgcolor = '#2a1a00';
                    app.canvas.centerOnNode(n);
                    app.graph.setDirtyCanvas(true, true);
                    setTimeout(() => {
                        n.color = undefined;
                        n.bgcolor = undefined;
                        app.graph.setDirtyCanvas(true, true);
                    }, 2000);
                    return '🔍 Focus sur "' + (n.title || n.comfyClass) + '" (2s)';
                }
            }
            return '⚠️ Nœud "' + nodeName.trim() + '" introuvable';
        });

        if (!commandsFound && reply !== result) {
            // Au moins une commande a ete executee
        }

        return result;
    },
};

// ─── Exposition publique pour le menu FR.IA ───
window.BlobbyCompanion = {
    activate: () => Blobby.activate(),
    deactivate: () => Blobby.deactivate(),
    isActive: () => Blobby.isActive(),
    toggle: () => {
        const newState = !Blobby.isActive();
        if (newState) { Blobby.activate(); } else { Blobby.deactivate(); }
        const cfg = _getFRIAConfig();
        cfg.blobbyActive = newState;
        _setFRIAConfig(cfg);
        return newState;
    },
    openChat: () => {
        if (Blobby.isActive()) {
            Blobby._openChatModal();
        }
    },
    chatVisible: () => {
        var m = document.getElementById('blobby-chat-modal');
        return m && m.style.display !== 'none';
    }
};

// ─── Auto-init ───
(function waitForApp() {
    const app = window.app || window.comfyAPI?.app?.app;
    if (!app) { setTimeout(waitForApp, 100); return; }

    app.registerExtension({
        name: "Blobby.Companion",
        async setup() {
            const canvas = app.canvas;
            if (!canvas) { console.warn("[Blobby] Pas de canvas"); return; }
            Blobby.init(canvas);

            const cfg = _getFRIAConfig();
            if (cfg.blobbyActive) {
                Blobby.activate();
            }

            console.log("%c🧡 Blobby Companion chargé. Menu FR.IA > Activer Blobby", "font-size: 13px; color: #FF8F00;");
        }
    });
})();
