/* Cardiac probe simulator: the chest panel and the probe.
   Drag with a finger or the mouse to slide; twist with two fingers, the wheel or the slider to rotate; tilt and rock
   with the sliders or arrow keys. Reads nothing from the page except the elements it is given. See DESIGN.md. */
(() => {
'use strict';
const D2R = Math.PI / 180;

/* The chest panel shows x from -20 to 20 cm (patient's right on the left of the screen, as if you stood at the feet
   looking up? No: as the operator stands at the patient's right, we draw the patient supine, head at the top,
   patient's left on the screen's right). y from -3 to 27 cm. */
const VIEW = { x0: -20, x1: 20, y0: -3, y1: 27 };

class ProbePanel {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.W = opts.w || 320; this.H = opts.h || 240; this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = this.W * this.dpr; canvas.height = this.H * this.dpr; canvas.style.width = this.W + 'px'; canvas.style.height = this.H + 'px';
    this.g = canvas.getContext('2d');
    this.pose = Object.assign({ x: 3.2, y: 8.6, rot: 42, tilt: 6, rock: -4 }, opts.pose);
    this.showRibs = opts.showRibs !== false; this.photo = null;
    this.onChange = opts.onChange || (() => {});
    this.bind();
    if (opts.photo) { const im = new Image(); im.onload = () => { this.photo = im; this.draw(); }; im.src = opts.photo; }
  }
  /* cm ↔ canvas px */
  toPx(x, y) { return [(x - VIEW.x0) / (VIEW.x1 - VIEW.x0) * this.W, (y - VIEW.y0) / (VIEW.y1 - VIEW.y0) * this.H]; }
  toCm(px, py) { return [VIEW.x0 + px / this.W * (VIEW.x1 - VIEW.x0), VIEW.y0 + py / this.H * (VIEW.y1 - VIEW.y0)]; }
  set(partial) { Object.assign(this.pose, partial); this.pose.x = Math.max(-14, Math.min(14, this.pose.x)); this.pose.y = Math.max(-2, Math.min(26, this.pose.y)); this.pose.tilt = Math.max(-45, Math.min(70, this.pose.tilt)); this.pose.rock = Math.max(-35, Math.min(35, this.pose.rock)); this.pose.rot = ((this.pose.rot % 360) + 360) % 360; this.draw(); this.onChange(this.pose); }

  bind() {
    const cv = this.cv; let drag = null, pinch = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * this.W / r.width, (e.clientY - r.top) * this.H / r.height]; };
    const pts = new Map();
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e));
      if (pts.size === 1) { const [px, py] = pos(e); const [cx, cy] = this.toCm(px, py); drag = { dx: this.pose.x - cx, dy: this.pose.y - cy }; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { ang: Math.atan2(b[1] - a[1], b[0] - a[0]), rot: this.pose.rot }; drag = null; } });
    cv.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, pos(e));
      if (pts.size === 1 && drag) { const [cx, cy] = this.toCm(...pos(e)); this.set({ x: cx + drag.dx, y: cy + drag.dy }); }
      else if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); this.set({ rot: pinch.rot - (ang - pinch.ang) / D2R }); } });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) drag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.set({ rot: this.pose.rot + (e.deltaY > 0 ? 5 : -5) }); }, { passive: false });
    cv.tabIndex = 0;
    cv.addEventListener('keydown', e => { const k = e.key, s = e.shiftKey ? 5 : 1; let h = true;
      if (e.altKey && k === 'ArrowUp') this.set({ tilt: this.pose.tilt + 2 * s }); else if (e.altKey && k === 'ArrowDown') this.set({ tilt: this.pose.tilt - 2 * s });
      else if (e.altKey && k === 'ArrowLeft') this.set({ rock: this.pose.rock - 2 * s }); else if (e.altKey && k === 'ArrowRight') this.set({ rock: this.pose.rock + 2 * s });
      else if (k === 'ArrowUp') this.set({ y: this.pose.y - 0.5 * s }); else if (k === 'ArrowDown') this.set({ y: this.pose.y + 0.5 * s });
      else if (k === 'ArrowLeft') this.set({ x: this.pose.x - 0.5 * s }); else if (k === 'ArrowRight') this.set({ x: this.pose.x + 0.5 * s });
      else if (k === 'q') this.set({ rot: this.pose.rot - 5 * s }); else if (k === 'e') this.set({ rot: this.pose.rot + 5 * s });
      else h = false; if (h) e.preventDefault(); });
  }

  /* The chest. A shaded drawing until a photograph replaces it (opts.photo). */
  draw() {
    const g = this.g, W = this.W, H = this.H; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = '#efe9df'; g.fillRect(0, 0, W, H);
    const P = (x, y) => this.toPx(x, y);
    if (this.photo) { g.drawImage(this.photo, 0, 0, W, H); }
    else {
      /* torso: shoulders, chest, abdomen with a soft lateral shading */
      const grad = g.createLinearGradient(...P(-16, 0), ...P(16, 0)); grad.addColorStop(0, '#c99b7b'); grad.addColorStop(0.5, '#e4b596'); grad.addColorStop(1, '#c99b7b');
      g.fillStyle = grad; g.beginPath(); g.moveTo(...P(-19, -3)); g.lineTo(...P(19, -3)); g.lineTo(...P(16.5, 4)); g.lineTo(...P(15.5, 27)); g.lineTo(...P(-15.5, 27)); g.lineTo(...P(-16.5, 4)); g.closePath(); g.fill();
      /* sternal notch, nipples, costal margin, umbilicus */
      g.fillStyle = 'rgba(120,70,50,.35)'; g.beginPath(); g.ellipse(...P(0, 0.2), 6, 4, 0, 0, Math.PI * 2); g.fill();
      for (const sx of [-1, 1]) { g.fillStyle = '#b9826a'; g.beginPath(); g.ellipse(...P(sx * 9.5, 11.5), 5.5, 5.5, 0, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = 'rgba(110,60,40,.28)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(...P(0, 18.5)); g.quadraticCurveTo(...P(6, 19.5), ...P(13, 24)); g.moveTo(...P(0, 18.5)); g.quadraticCurveTo(...P(-6, 19.5), ...P(-13, 24)); g.stroke();
      g.fillStyle = 'rgba(110,60,40,.3)'; g.beginPath(); g.ellipse(...P(0, 26), 2.5, 3, 0, 0, Math.PI * 2); g.fill();
    }
    if (this.showRibs) {
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.lineCap = 'round';
      g.fillStyle = 'rgba(255,255,255,.32)'; g.fillRect(P(-1.6, 1.5)[0], P(0, 1.5)[1], P(1.6, 0)[0] - P(-1.6, 0)[0], P(0, 19)[1] - P(0, 1.5)[1]);
      for (let i = 0; i < 8; i++) { const y = 2.6 + i * 2.3; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(...P(s * 1.6, y)); g.quadraticCurveTo(...P(s * 8, y + 0.9), ...P(s * 15, y + 3.4)); g.stroke(); } }
      g.fillStyle = 'rgba(80,40,30,.7)'; g.font = '10px Inter, Arial, sans-serif'; g.fillText('R', 6, H - 6); g.fillText('L', W - 12, H - 6); g.fillText('Head', W / 2 - 12, 11);
    }
    /* heart outline faintly, so the learner can relate the probe to the organ */
    g.strokeStyle = 'rgba(99,61,60,.35)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(...P(4.2, 9.6), 5.6 * W / 40, 4.6 * H / 30, 45 * D2R, 0, Math.PI * 2); g.stroke();
    /* the probe */
    const [px, py] = P(this.pose.x, this.pose.y); const a = -this.pose.rot * D2R;   // screen rotation: 0 → patient's right (screen left)
    g.save(); g.translate(px, py); g.rotate(a + Math.PI);
    const sc = W / 400;
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 8 * sc; g.shadowOffsetY = 3 * sc;
    g.fillStyle = '#2b2f36'; g.beginPath(); g.roundRect(-16 * sc, -7 * sc, 32 * sc, 14 * sc, 4 * sc); g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = '#4b5563'; g.beginPath(); g.roundRect(-6 * sc, -4 * sc, 12 * sc, 8 * sc, 2 * sc); g.fill();   // cable boss
    g.fillStyle = '#d97706'; g.beginPath(); g.arc(19 * sc, 0, 3.6 * sc, 0, Math.PI * 2); g.fill();                     // marker
    /* tilt and rock shown as a small arrow pair */
    g.restore();
    g.fillStyle = 'rgba(39,39,34,.85)'; g.font = '11px ui-monospace, monospace';
    const txt = `x ${this.pose.x.toFixed(1)}  y ${this.pose.y.toFixed(1)}  ${clock(this.pose.rot)}  tilt ${Math.round(this.pose.tilt)}°  rock ${Math.round(this.pose.rock)}°`;
    g.fillText(txt, 6, H - 20);
  }
}
function clock(deg) { /* marker direction as an o'clock position seen from the operator's side */ let h = (((90 - deg) / 30) % 12 + 12) % 12; let hr = Math.round(h * 2) / 2; const whole = Math.floor(hr) || 12; return `${whole}${hr % 1 ? ':30' : ''} o’clock`; }

window.ProbePanel = ProbePanel;
})();
