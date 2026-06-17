/**
 * FR.IA — Blobby Companion
 * Personnage interactif pour le canvas ComfyUI.
 * Dessiné 100% Canvas 2D (zero asset visuel).
 * Activation/désactivation via le menu FR.IA.
 *
 * Ce fichier est la version déployée.
 * La source de développement est dans FRIA_ComfyUI/blobby_companion/web/js/blobby.js
 */

const FRIA_CONFIG_KEY = "FRIA_config";

function _getFRIAConfig() {
    try { return JSON.parse(localStorage.getItem(FRIA_CONFIG_KEY)) || {}; }
    catch { return {}; }
}

function _setFRIAConfig(cfg) {
    localStorage.setItem(FRIA_CONFIG_KEY, JSON.stringify(cfg));
}

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

    visibleArea: null,
    _offscreen: null,
    _octx: null,

    _active: false,
    _canvas: null,
    _animFrameId: null,
    _animFrameCount: 0,
    _lastTime: 0,
    _origDraw: null,
    _origMD: null,
    _origMM: null,
    _origMU: null,

    init(canvas) {
        this._canvas = canvas;
        this.x = 400;
        this.y = 300;
        this.organX = this.x;
        this.organY = this.y;
        this.blinkTimer = 60 + Math.random() * 120;
        this.initParticles();

        this._offscreen = document.createElement('canvas');
        this._octx = this._offscreen.getContext('2d');

        this._origDraw = canvas.onDrawForeground;
        this._origMD = canvas.processMouseDown;
        this._origMM = canvas.processMouseMove;
        this._origMU = canvas.processMouseUp;
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
            // Clic droit sur Blobby → ouvre le tchat
            if (e.button === 2) {
                const gm = this._getGM(canvas);
                if (gm && this.hitTest(gm[0], gm[1])) {
                    this._openChatModal();
                    this.mood = "happy"; this.moodTimer = 0;
                    for (let i = 0; i < 3; i++) this.addParticle(this.x + (Math.random() - 0.5) * 20, this.y + (Math.random() - 0.5) * 20, "sparkle");
                    e.preventDefault();
                }
            }
        };

        canvas.processMouseMove = (e) => {
            if (this._origMM) this._origMM.apply(canvas, arguments);
        };

        canvas.processMouseUp = (e) => {
            if (this._origMU) this._origMU.apply(canvas, arguments);
        };

        const loop = (t) => {
            if (!this._active) return;
            this._animFrameCount++;
            // Limiter le rafraichissement a ~10fps pour ne pas bloquer les autres nodes
            // Redessiner le canvas a ~30fps
            if (this._animFrameCount % 2 === 0 && canvas.setDirty) {
                canvas.setDirty(true, true);
            }
            this._animFrameId = requestAnimationFrame(loop);
        };
        this._animFrameId = requestAnimationFrame(loop);

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

        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }

        if (canvas.setDirty) canvas.setDirty(true, true);
        console.log("%c🧡 Blobby désactivé.", "font-size: 14px; color: #888;");
    },

    isActive() { return this._active; },

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
            this.x += this.vx;
            this.y += this.vy;
            this.vx *= 0.995;
            this.vy *= 0.995;
            if (Math.random() < 0.015) {
                this.vx += (Math.random() - 0.5) * 1.2;
                this.vy += (Math.random() - 0.5) * 1.2;
            }
            const speed = Math.hypot(this.vx, this.vy);
            if (speed > 5) { this.vx = (this.vx / speed) * 5; this.vy = (this.vy / speed) * 5; }
            if (this.mood === "sleepy") { this.vx *= 0.97; this.vy *= 0.97; }

            if (this.mouseActive) {
                const dx = this.mouseX - this.x;
                const dy = this.mouseY - this.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 80 && dist > 0) {
                    this.vx -= (dx / dist) * 0.3 * (1 - dist / 80);
                    this.vy -= (dy / dist) * 0.3 * (1 - dist / 80);
                    if (this.mood !== "sleepy") this.mood = "surprised";
                }
                if (this.followMouse && dist > 10) {
                    this.vx += (dx / dist) * 0.3;
                    this.vy += (dy / dist) * 0.3;
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
        if (!this.isDragging) {
            for (const node of nodes) {
                const nx = node.pos[0], ny = node.pos[1];
                const nw = node.size[0], nh = node.size[1];
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
                const nx = node.pos[0], ny = node.pos[1];
                const nw = node.size[0], nh = node.size[1], pr = p.radius;
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
                    const nx = node.pos[0], ny = node.pos[1];
                    const nw = node.size[0], nh = node.size[1];
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
            ctx.drawImage(oc, minX - pad, minY - pad);
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
        switch (this.mood) {
            case "surprised": return "#E65100";
            case "sleepy": return "#43A047";
            default: return "#FF8F00";
        }
    },

    drawBrain(ctx, ox, oy, s) {
        ctx.save();
        const pulse = 1 + Math.sin(this.time * 4) * 0.03;
        ctx.translate(ox, oy - 18 * s);
        ctx.scale(pulse, pulse);
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
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        const leftEyeX = ox - 15 * s, rightEyeX = ox + 15 * s, browY = oy - 6 * s;
        ctx.beginPath();
        if (this.mood === "surprised") {
            ctx.moveTo(leftEyeX - 8 * s, browY - 3 * s);
            ctx.quadraticCurveTo(leftEyeX, browY - 8 * s, leftEyeX + 6 * s, browY - 5 * s);
            ctx.moveTo(rightEyeX + 8 * s, browY - 3 * s);
            ctx.quadraticCurveTo(rightEyeX, browY - 8 * s, rightEyeX - 6 * s, browY - 5 * s);
        } else if (this.mood === "sleepy") {
            ctx.moveTo(leftEyeX - 7 * s, browY + 2 * s); ctx.lineTo(leftEyeX + 7 * s, browY + 2 * s);
            ctx.moveTo(rightEyeX - 7 * s, browY + 2 * s); ctx.lineTo(rightEyeX + 7 * s, browY + 2 * s);
        } else {
            ctx.arc(leftEyeX, browY + 2 * s, 7 * s, Math.PI * 1.15, Math.PI * 1.85);
            ctx.moveTo(rightEyeX - 7 * s, browY + 2 * s);
            ctx.arc(rightEyeX, browY + 2 * s, 7 * s, Math.PI * 1.15, Math.PI * 1.85);
        }
        ctx.stroke();

        const drawOneEye = (ex) => {
            const eyeX = ox + ex, eyeY = oy + 6 * s;
            const angle = Math.atan2(this.mouseY - (this.y + eyeY), this.mouseX - (this.x + eyeX));
            const lookDist = Math.min(5 * s, Math.hypot(this.mouseX - (this.x + eyeX), this.mouseY - (this.y + eyeY)) * 0.02);
            const pupilX = eyeX + Math.cos(angle) * lookDist;
            const pupilY = eyeY + Math.sin(angle) * lookDist;
            if (this.isBlinking) {
                ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(eyeX - 9 * s, eyeY); ctx.quadraticCurveTo(eyeX, eyeY + 3 * s, eyeX + 9 * s, eyeY); ctx.stroke();
                return;
            }
            const scleraR = this.mood === "surprised" ? 11 * s : 9 * s;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(eyeX, eyeY, scleraR, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1; ctx.stroke();
            const pupilR = this.mood === "surprised" ? 3 * s : 4.5 * s;
            ctx.fillStyle = "#0f172a";
            ctx.beginPath(); ctx.arc(pupilX, pupilY, pupilR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(pupilX - pupilR * 0.3, pupilY - pupilR * 0.3, pupilR * 0.35, 0, Math.PI * 2); ctx.fill();
        };
        drawOneEye(-15 * s); drawOneEye(15 * s);
    },

    drawMouth(ctx, ox, oy, s) {
        const mouthY = oy + 22 * s, mouthW = (10 + this.mouthOpen * 6) * s;
        if (this.mood === "surprised" && this.mouthOpen > 0.3) {
            ctx.beginPath(); ctx.ellipse(ox, mouthY, 6 * s, (3 + this.mouthOpen * 6) * s, 0, 0, Math.PI * 2);
            ctx.fillStyle = "#5D4037"; ctx.fill();
            ctx.beginPath(); ctx.ellipse(ox, mouthY + s, 4 * s, (1 + this.mouthOpen * 4) * s, 0, 0, Math.PI * 2);
            ctx.fillStyle = "#D32F2F"; ctx.fill();
        } else if (this.mood === "sleepy") {
            ctx.beginPath(); ctx.ellipse(ox, mouthY, 2 * s, 1.5 * s, 0, 0, Math.PI * 2);
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
            if (dx * dx + dy * dy < (p.radius * 1.5) ** 2) return true;
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

    _saveChatHistory() {
        var msgs = document.getElementById('blobby-chat-msgs');
        if (!msgs) return;
        var history = [];
        msgs.querySelectorAll('.blobby-msg').forEach(function(el) {
            history.push({ role: el.dataset.role, text: el.innerHTML });
        });
        // Garder les 50 derniers messages
        if (history.length > 50) history = history.slice(-50);
        try {
            var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
            cfg.blobbyChatHistory = history;
            localStorage.setItem('FRIA_config', JSON.stringify(cfg));
        } catch {}
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

        var modal = document.createElement('div');
        modal.id = 'blobby-chat-modal';
        Object.assign(modal.style, {
            position: 'fixed', left: '20px', bottom: '20px',
            width: '360px', height: '420px',
            background: '#1e1e24', borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: '99999', display: 'flex', flexDirection: 'column',
            border: '1px solid #333', overflow: 'hidden',
            fontSize: '13px',
        });

        // Header
        var header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', cursor: 'grab', userSelect: 'none',
            borderBottom: '1px solid #333', background: '#2a2a2e',
        });
        var title = document.createElement('span');
        title.innerHTML = '🧡 <b>Blobby</b> <span style="color:#888;font-size:11px;">(test concept)</span>';
        title.style.color = '#FF8F00';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, { background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', padding: '0 4px' });
        closeBtn.onmouseenter = () => closeBtn.style.color = '#f87171';
        closeBtn.onmouseleave = () => closeBtn.style.color = '#888';
        closeBtn.onclick = () => { modal.style.display = 'none'; };
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Messages area
        var messages = document.createElement('div');
        messages.id = 'blobby-chat-msgs';
        Object.assign(messages.style, {
            flex: '1', overflowY: 'auto', padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: '8px',
        });

        // Restaurer l'historique
        try {
            var cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {};
            var history = cfg.blobbyChatHistory || [];
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
        } catch {}

        if (messages.children.length === 0) {
            // Message de bienvenue si aucun historique
            this._addChatMessage(messages, 'blobby', '👋 Salut ! Clique sur un nœud ou pose-moi une question sur le workflow.');
        }
        messages.scrollTop = messages.scrollHeight;

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
                if (drag.active) { drag.active = false; header.style.cursor = 'grab'; }
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
    },

    async _handleChatMessage(container, userText) {
        this._addChatMessage(container, 'system', '🤔 Blobby réfléchit...');

        try {
            // Construire le contexte : workflow actuel
            var workflowDesc = this._describeWorkflow();

            // Recuperer le preset LLM depuis FRIA_config
            var cfg = {};
            try { cfg = JSON.parse(localStorage.getItem('FRIA_config')) || {}; } catch {}
            var presetId = cfg.biGenPreset || '';

            if (!presetId) {
                this._addChatMessage(container, 'blobby',
                    '⚠️ Configure d\'abord un provider LLM dans FR.IA &gt; Paramètres &gt; Provider LLM, puis réessaie !');
                return;
            }

            var instruction = 'Tu es Blobby, un assistant IA amical qui vit sur le canvas ComfyUI. '
                + 'Tu peux analyser les workflows et suggérer des modifications.\n\n'
                + 'Workflow actuel :\n' + workflowDesc + '\n\n'
                + 'Instructions :\n'
                + '- Sois concis et amical.\n'
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
