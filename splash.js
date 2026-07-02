/* Particle text splash — full-screen, auto-advancing */
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
      const tx = this.target.x - this.pos.x;
      const ty = this.target.y - this.pos.y;
      const dist = Math.sqrt(tx * tx + ty * ty);
      const prox = dist < this.closeEnoughTarget ? dist / this.closeEnoughTarget : 1;
      const mag  = dist || 1;
      const vx   = (tx / mag) * this.maxSpeed * prox;
      const vy   = (ty / mag) * this.maxSpeed * prox;
      const sx   = vx - this.vel.x;
      const sy   = vy - this.vel.y;
      const sm   = Math.sqrt(sx * sx + sy * sy) || 1;
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

  // ── Dimensions ───────────────────────────────────────────────
  const DPR   = Math.min(window.devicePixelRatio || 1, 3);
  const CW    = Math.floor(window.innerWidth);
  const CH    = Math.floor(window.innerHeight);
  // On HiDPI screens, smaller particles look sharper (2 CSS px = 6 device px at 3×)
  const PDRAW = DPR > 1 ? 2 : 3;
  // Denser sampling on HiDPI so particles fill strokes without gaps
  const PSTEP = DPR > 1
    ? Math.max(2, Math.floor(CW * CH / 300000))
    : Math.max(4, Math.floor(CW * CH / 180000));

  // ── DOM ──────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999;background:#000',
    'overflow:hidden;transition:opacity .8s ease',
  ].join(';');

  const canvas = document.createElement('canvas');
  canvas.width  = CW * DPR;
  canvas.height = CH * DPR;
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;';

  overlay.appendChild(canvas);
  document.head.insertAdjacentHTML('beforeend',
    `<style>@keyframes _sp{0%,100%{opacity:.3}50%{opacity:.8}}#_sph{animation:_sp 2.2s ease-in-out infinite}</style>`
  );

  // ── Engine ───────────────────────────────────────────────────
  const ctx       = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  const particles = [];
  let phase       = 0;
  let advancing   = false;
  let settledFrames = 0;
  let phaseFrame    = 0;
  let rafId;

  function edgePos() {
    const cx = CW / 2, cy = CH / 2;
    const dx = Math.random() * CW - cx;
    const dy = Math.random() * CH - cy;
    const m  = Math.sqrt(dx * dx + dy * dy) || 1;
    const s  = (CW + CH) / 2;
    return { x: cx + (dx / m) * s, y: cy + (dy / m) * s };
  }

  function setWord(text) {
    const off = document.createElement('canvas');
    off.width = CW; off.height = CH;
    const oc  = off.getContext('2d');

    // Auto-fit font to ~75% of canvas width
    let fs = Math.floor(CH * 0.28);
    oc.font = `900 ${fs}px Montserrat, Arial Black, sans-serif`;
    while (oc.measureText(text).width > CW * 0.85 && fs > 12) {
      fs -= 2;
      oc.font = `900 ${fs}px Montserrat, Arial Black, sans-serif`;
    }

    oc.fillStyle    = 'white';
    oc.textAlign    = 'center';
    oc.textBaseline = 'middle';
    oc.fillText(text, CW / 2, CH / 2);

    const px    = oc.getImageData(0, 0, CW, CH).data;
    const GREEN = { r: 75, g: 226, b: 119 };
    const coords = [];
    for (let i = 0; i < px.length; i += PSTEP * 4) coords.push(i);
    // shuffle for fluid motion
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
    phaseFrame    = 0;
    settledFrames = 0;
  }

  // Soft settle: 90% of active particles within 10px of target
  function isSettled() {
    let total = 0, close = 0;
    for (const p of particles) {
      if (p.isKilled) continue;
      total++;
      const dx = p.pos.x - p.target.x;
      const dy = p.pos.y - p.target.y;
      if (Math.sqrt(dx * dx + dy * dy) <= 10) close++;
    }
    return total > 10 && close / total >= 0.90;
  }

  function exitSplash() {
    if (phase >= 2) return;
    phase = 2;
    overlay.style.opacity       = '0';
    overlay.style.pointerEvents = 'none';
    setTimeout(() => {
      cancelAnimationFrame(rafId);
      overlay.remove();
      sessionStorage.setItem('splashShown', '1');
      window.dispatchEvent(new CustomEvent('splashDone'));
    }, 800);
  }

  function tick() {
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

    if (!advancing && phaseFrame > 80) {
      if (phase === 0) {
        if (isSettled()) settledFrames++;
        else settledFrames = Math.max(0, settledFrames - 1);

        // Advance when settled for 30 frames OR after 9s max
        if (settledFrames >= 30 || phaseFrame > 540) {
          advancing = true;
          setTimeout(() => {
            setWord('GET YOUR SHIT DONE');
            phase = 1;
            advancing = false;
          }, 2900);
        }

      } else if (phase === 1) {
        if (isSettled()) settledFrames++;
        else settledFrames = Math.max(0, settledFrames - 1);

        // Exit when settled for 30 frames OR after 9s max
        if (settledFrames >= 30 || phaseFrame > 540) {
          advancing = true;
          setTimeout(exitSplash, 3500);
        }
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  // ── Start ────────────────────────────────────────────────────
  function start() {
    document.body.appendChild(overlay);
    document.fonts.ready.then(() => {
      setWord('MY HABITS');
      tick();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
