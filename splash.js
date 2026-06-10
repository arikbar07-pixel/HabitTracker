/* Particle text splash screen — auto-advancing */
(function () {
  if (sessionStorage.getItem('splashShown')) return;

  // ── Particle ─────────────────────────────────────────────────
  class Particle {
    constructor() {
      this.pos = { x: 0, y: 0 };
      this.vel = { x: 0, y: 0 };
      this.acc = { x: 0, y: 0 };
      this.target = { x: 0, y: 0 };
      this.closeEnoughTarget = 100;
      this.maxSpeed = 1;
      this.maxForce = 0.1;
      this.isKilled = false;
      this.startColor = { r: 0, g: 0, b: 0 };
      this.targetColor = { r: 0, g: 0, b: 0 };
      this.colorWeight = 0;
      this.colorBlendRate = 0.01;
    }

    move() {
      const dx = this.pos.x - this.target.x;
      const dy = this.pos.y - this.target.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const prox = dist < this.closeEnoughTarget ? dist / this.closeEnoughTarget : 1;
      const tx = this.target.x - this.pos.x;
      const ty = this.target.y - this.pos.y;
      const mag = Math.sqrt(tx * tx + ty * ty) || 1;
      const vx = (tx / mag) * this.maxSpeed * prox;
      const vy = (ty / mag) * this.maxSpeed * prox;
      const sx = vx - this.vel.x;
      const sy = vy - this.vel.y;
      const sm = Math.sqrt(sx * sx + sy * sy) || 1;
      this.acc.x += (sx / sm) * this.maxForce;
      this.acc.y += (sy / sm) * this.maxForce;
      this.vel.x += this.acc.x;
      this.vel.y += this.acc.y;
      this.pos.x += this.vel.x;
      this.pos.y += this.vel.y;
      this.acc.x = 0;
      this.acc.y = 0;
    }

    draw(ctx, pdraw) {
      if (this.colorWeight < 1) this.colorWeight = Math.min(this.colorWeight + this.colorBlendRate, 1);
      const r = Math.round(this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight);
      const g = Math.round(this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight);
      const b = Math.round(this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(this.pos.x, this.pos.y, pdraw, pdraw);
    }

    kill(W, H) {
      if (!this.isKilled) {
        const cx = W / 2, cy = H / 2;
        const dx = Math.random() * W - cx;
        const dy = Math.random() * H - cy;
        const m  = Math.sqrt(dx * dx + dy * dy) || 1;
        const s  = (W + H) / 2;
        this.target.x = cx + (dx / m) * s;
        this.target.y = cy + (dy / m) * s;
        this.startColor = {
          r: this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight,
          g: this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight,
          b: this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight,
        };
        this.targetColor = { r: 0, g: 0, b: 0 };
        this.colorWeight = 0;
        this.isKilled = true;
      }
    }
  }

  // ── Sizing ───────────────────────────────────────────────────
  const CW    = window.innerWidth < 600 ? 600 : 1000;
  const CH    = Math.round(CW * 0.4);
  const PDRAW = CW < 800 ? 3 : 2;
  const PSTEP = 5;

  // ── DOM ──────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `@keyframes _sp{0%,100%{opacity:.3}50%{opacity:.8}} #_sph{animation:_sp 2.2s ease-in-out infinite}`;
  document.head.appendChild(css);

  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999;background:#000',
    'display:flex;flex-direction:column;align-items:center;justify-content:center',
    'transition:opacity .75s ease',
  ].join(';');

  const canvas = document.createElement('canvas');
  canvas.width  = CW;
  canvas.height = CH;
  canvas.style.cssText = 'max-width:95vw;height:auto;display:block;';

  const hint = document.createElement('p');
  hint.id = '_sph';
  hint.style.cssText = [
    'margin-top:1.5rem;color:rgba(75,226,119,.55)',
    'font-size:.62rem;font-family:Montserrat,sans-serif',
    'font-weight:700;letter-spacing:.22em;text-transform:uppercase;user-select:none',
  ].join(';');

  overlay.appendChild(canvas);
  overlay.appendChild(hint);

  // ── Engine ───────────────────────────────────────────────────
  const ctx       = canvas.getContext('2d');
  const particles = [];
  let phase      = 0;   // 0 = MY HABITS forming, 1 = GET YOUR SHIT DONE forming, 2 = exiting
  let advancing  = false;
  let settledFrames = 0;
  let phaseFrame    = 0;
  let totalFrame    = 0;
  let rafId;

  function edgePos() {
    const cx = CW / 2, cy = CH / 2;
    const dx = Math.random() * CW - cx;
    const dy = Math.random() * CH - cy;
    const m  = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: cx + (dx / m) * (CW + CH) / 2, y: cy + (dy / m) * (CW + CH) / 2 };
  }

  function setWord(text) {
    const off   = document.createElement('canvas');
    off.width   = CW; off.height = CH;
    const oc    = off.getContext('2d');
    let fs      = 110;
    oc.font     = `900 ${fs}px Montserrat, Arial Black, sans-serif`;
    while (oc.measureText(text).width > CW * 0.88 && fs > 14) {
      fs -= 2;
      oc.font = `900 ${fs}px Montserrat, Arial Black, sans-serif`;
    }
    oc.fillStyle = 'white';
    oc.textAlign = 'center';
    oc.textBaseline = 'middle';
    oc.fillText(text, CW / 2, CH / 2);

    const px     = oc.getImageData(0, 0, CW, CH).data;
    const GREEN  = { r: 75, g: 226, b: 119 };
    const coords = [];
    for (let i = 0; i < px.length; i += PSTEP * 4) coords.push(i);
    for (let i = coords.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [coords[i], coords[j]] = [coords[j], coords[i]];
    }
    let pi = 0;
    for (const ci of coords) {
      if (px[ci + 3] > 0) {
        const x = (ci / 4) % CW;
        const y = Math.floor(ci / 4 / CW);
        let p;
        if (pi < particles.length) { p = particles[pi]; p.isKilled = false; pi++; }
        else {
          p = new Particle();
          const ep = edgePos();
          p.pos.x = ep.x; p.pos.y = ep.y;
          p.maxSpeed      = Math.random() * 6 + 4;
          p.maxForce      = p.maxSpeed * 0.05;
          p.colorBlendRate = Math.random() * 0.0275 + 0.0025;
          particles.push(p);
        }
        p.startColor = {
          r: p.startColor.r + (p.targetColor.r - p.startColor.r) * p.colorWeight,
          g: p.startColor.g + (p.targetColor.g - p.startColor.g) * p.colorWeight,
          b: p.startColor.b + (p.targetColor.b - p.startColor.b) * p.colorWeight,
        };
        p.targetColor = GREEN;
        p.colorWeight = 0;
        p.target.x = x;
        p.target.y = y;
      }
    }
    for (let i = pi; i < particles.length; i++) particles[i].kill(CW, CH);
    phaseFrame = 0;
    settledFrames = 0;
  }

  // Returns true when all active particles are very close to their targets
  function isSettled() {
    let count = 0;
    for (const p of particles) {
      if (p.isKilled) continue;
      count++;
      const dx = p.pos.x - p.target.x;
      const dy = p.pos.y - p.target.y;
      if (Math.sqrt(dx * dx + dy * dy) > 2.5) return false;
    }
    return count > 0;
  }

  function exitSplash() {
    if (phase >= 2) return;
    phase = 2;
    overlay.style.opacity       = '0';
    overlay.style.pointerEvents = 'none';
    setTimeout(() => {
      cancelAnimationFrame(rafId);
      overlay.remove();
      css.remove();
      sessionStorage.setItem('splashShown', '1');
    }, 750);
  }

  function tick() {
    totalFrame++;
    phaseFrame++;

    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, CW, CH);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.move();
      p.draw(ctx, PDRAW);
      if (p.isKilled && (p.pos.x < 0 || p.pos.x > CW || p.pos.y < 0 || p.pos.y > CH))
        particles.splice(i, 1);
    }

    // Auto-advance: wait at least 60 frames since word was set, then detect settling
    if (!advancing && phaseFrame > 60) {
      if (phase === 0) {
        if (isSettled()) {
          settledFrames++;
          if (settledFrames >= 35) {       // ~0.6s fully settled → transition
            advancing = true;
            hint.style.display = 'none';
            setTimeout(() => {
              setWord('GET YOUR SHIT DONE');
              phase = 1;
              advancing = false;
            }, 350);
          }
        } else { settledFrames = 0; }

      } else if (phase === 1) {
        if (isSettled()) {
          settledFrames++;
          if (settledFrames >= 35) {       // ~0.6s fully settled → hold then exit
            advancing = true;
            setTimeout(exitSplash, 3500);  // 3.5s to read the message
          }
        } else { settledFrames = 0; }
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  // ── Start ────────────────────────────────────────────────────
  function start() {
    hint.textContent = '';   // no hint needed — fully automatic
    document.body.appendChild(overlay);
    document.fonts.ready.then(() => {
      setWord('MY HABITS');
      tick();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
