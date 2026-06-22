/**
 * cluster.js — compteur + jauges. Logique canvas/jauges reprise À L'IDENTIQUE
 * du design 01 (drawAll / updateFuel / updateTemp). Alimenté par le bus véhicule.
 */
const Cluster = (() => {
  const PI = Math.PI, RED = '#ff4444', AMBER = '#f59e0b', WHITE = '#ffffff', TEAL = '#02BFA6';

  function lerpC(c1, c2, t) {
    const a = [1, 3, 5].map(i => parseInt(c1.slice(i, i + 2), 16));
    const b = [1, 3, 5].map(i => parseInt(c2.slice(i, i + 2), 16));
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function rpmColor(r) {
    if (r <= 3) return lerpC(WHITE, TEAL, r / 3);
    if (r <= 6) return lerpC(TEAL, AMBER, (r - 3) / 3);
    if (r <= 7) return lerpC(AMBER, RED, r - 6);
    return RED;
  }

  // couleur depuis le skin actif (repli si absent)
  function pal(name, fb) { return (window.SKIN && window.SKIN.canvas && window.SKIN.canvas[name]) || fb; }
  function blockBar(p, len) { p = Math.max(0, Math.min(1, p)); const f = Math.round(p * len); return '█'.repeat(f) + '░'.repeat(len - f); }

  /* ─── Rendu TVA / CRT : barregraphe radial de blocs (pas d'aiguille), repris du design 04 ─── */
  function drawTVA(speed, rpm) {
    const c = document.getElementById('speedo-canvas'), gx = c.getContext('2d');
    const W = 680, cx = 340, cy = 340; gx.clearRect(0, 0, W, W);
    const AMBER = pal('amber', '#FFB000'), RUST = pal('rust', '#E8622A');
    const START = Math.PI * 0.78, END = Math.PI * 2.22, TOTAL = END - START, R = 266, seg = 44;
    const sPct = Math.min(speed / 140, 1);
    for (let i = 0; i < seg; i++) {
      const t = i / seg, a = START + TOTAL * t, on = t <= sPct, v = 140 * t, isR = v >= 120, rO = R, rI = R - 35;
      gx.save(); gx.translate(cx, cy); gx.rotate(a + Math.PI / 2);
      gx.fillStyle = on ? (isR ? RUST : AMBER) : 'rgba(255,176,0,0.10)';
      if (on) { gx.shadowColor = isR ? RUST : AMBER; gx.shadowBlur = 12; }
      gx.fillRect(-6, -rO, 12, rO - rI); gx.restore();
    }
    gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.font = "34px 'VT323',monospace";
    [0, 20, 40, 60, 80, 100, 120, 140].forEach(v => { const a = START + TOTAL * (v / 140), lr = R - 66, isR = v >= 120; gx.fillStyle = isR ? RUST : 'rgba(255,176,0,0.55)'; gx.fillText(String(v), cx + lr * Math.cos(a), cy + lr * Math.sin(a)); });
    // RPM : anneau de blocs intérieur
    const rPct = Math.min(rpm / 8, 1), seg2 = 40, R2 = 205;
    for (let i = 0; i < seg2; i++) { const t = i / seg2, a = START + TOTAL * t, on = t <= rPct; gx.save(); gx.translate(cx, cy); gx.rotate(a + Math.PI / 2); gx.fillStyle = on ? 'rgba(255,176,0,0.85)' : 'rgba(255,176,0,0.08)'; gx.fillRect(-3, -R2, 6, 14); gx.restore(); }
  }

  function drawAll(speed, rpm) {
    if (window.RENDER_STYLE === 'tva_crt') return drawTVA(speed, rpm);
    const c = document.getElementById('speedo-canvas'), ctx = c.getContext('2d');
    const W = 680, H = 680, cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    const START = PI * 0.72, END = PI * 2.28, TOTAL = END - START;
    const R_out = 300, R_sp = 272, R_ta = 232;
    [R_out + 10, R_out].forEach((r, i) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI * 2); ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = i === 0 ? 2.5 : 1.5; ctx.stroke(); });
    ctx.beginPath(); ctx.arc(cx, cy, R_sp, START, END); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.stroke();
    const sRS = START + TOTAL * (120 / 140);
    ctx.beginPath(); ctx.arc(cx, cy, R_sp, sRS, END); ctx.strokeStyle = 'rgba(255,68,68,0.2)'; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.stroke();
    const sPct = Math.min(speed / 140, 1), sA = START + TOTAL * sPct;
    if (speed > 0) { ctx.beginPath(); ctx.arc(cx, cy, R_sp, START, Math.min(sA, sRS)); ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.stroke(); if (speed > 120) { ctx.beginPath(); ctx.arc(cx, cy, R_sp, sRS, sA); ctx.strokeStyle = RED; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.stroke(); } }
    for (let i = 0; i <= 56; i++) { const a = START + TOTAL * i / 56, v = 140 * i / 56, maj = i % 8 === 0, isR = v >= 120; const len = maj ? 22 : 11, rO = R_sp - 22, rI = rO - len; ctx.beginPath(); ctx.moveTo(cx + rO * Math.cos(a), cy + rO * Math.sin(a)); ctx.lineTo(cx + rI * Math.cos(a), cy + rI * Math.sin(a)); ctx.strokeStyle = isR ? (speed >= v ? RED : 'rgba(255,68,68,0.45)') : (maj ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.2)'); ctx.lineWidth = maj ? 3 : 1.2; ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = "900 18px 'Montserrat',sans-serif";
    [0, 20, 40, 60, 80, 100, 120, 140].forEach(v => { const a = START + TOTAL * (v / 140), lr = R_sp - 92, isR = v >= 120; ctx.fillStyle = isR ? (speed >= v ? RED : 'rgba(255,68,68,0.7)') : 'rgba(255,255,255,0.8)'; ctx.fillText(v === 0 ? '' : String(v), cx + lr * Math.cos(a), cy + lr * Math.sin(a)); });
    ctx.beginPath(); ctx.arc(cx, cy, R_sp - 34, START - 0.05, END + 0.05); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R_ta, START, END); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.stroke();
    const rPct = Math.min(rpm / 8, 1);
    if (rpm > 0) { const steps = 80; for (let i = 0; i < steps; i++) { const t0 = rPct * i / steps, t1 = rPct * (i + 1) / steps; if (t1 > rPct) break; const a0 = START + TOTAL * t0, a1 = START + TOTAL * t1; ctx.beginPath(); ctx.arc(cx, cy, R_ta, a0, a1); ctx.strokeStyle = rpmColor(rpm * (i + 0.5) / steps); ctx.lineWidth = 9; ctx.lineCap = 'butt'; ctx.stroke(); } }
    for (let i = 0; i <= 40; i++) { const a = START + TOTAL * i / 40, maj = i % 5 === 0, len = maj ? 12 : 7, rO = R_ta - 16, rI = rO - len; ctx.beginPath(); ctx.moveTo(cx + rO * Math.cos(a), cy + rO * Math.sin(a)); ctx.lineTo(cx + rI * Math.cos(a), cy + rI * Math.sin(a)); ctx.strokeStyle = maj ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = maj ? 2 : 1; ctx.stroke(); }
    const na = sA, nLen = R_ta - 30, nBack = 34, nCol = speed >= 120 ? RED : WHITE;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.moveTo(cx - nBack * Math.cos(na), cy - nBack * Math.sin(na)); ctx.lineTo(cx + nLen * Math.cos(na), cy + nLen * Math.sin(na)); ctx.strokeStyle = nCol; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, PI * 2); ctx.fillStyle = nCol; ctx.fill();
  }

  function updateFuel(f) {
    const fill = document.getElementById('fuel-fill');
    fill.style.height = f + '%';
    const ts = Math.max(0, f - 15);
    fill.style.background = f <= 20
      ? 'linear-gradient(0deg,#6d1fd4,#8B5CF6)'
      : `linear-gradient(0deg,#8B5CF6 0%,#8B5CF6 ${Math.max(0, ts - 20)}%,#02BFA6 100%)`;
    document.getElementById('fuel-pct').innerHTML = Math.round(f) + '<small>%</small>';
    const reserve = document.getElementById('fuel-reserve');
    const pctEl = document.getElementById('fuel-pct');
    const label = document.getElementById('fuel-label');
    const bar = document.getElementById('fuel-fill');
    if (f <= 15) {
      reserve.classList.add('active'); pctEl.classList.add('over-logo');
      label.style.opacity = '0'; bar.style.opacity = '0';
    } else {
      reserve.classList.remove('active'); pctEl.classList.remove('over-logo');
      label.style.opacity = ''; bar.style.opacity = '';
    }
    // barregraphe + statut (visibles uniquement en skin TVA)
    document.getElementById('fuel-blocks').textContent = blockBar(f / 100, 8);
    const fst = document.getElementById('fuel-status');
    if (f <= 15) { fst.textContent = '! RÉSERVE !'; fst.classList.add('blink'); } else { fst.textContent = ''; fst.classList.remove('blink'); }
  }

  function updateTemp(t) {
    const pct = (t - 20) / 110 * 100;
    const fill = document.getElementById('temp-fill');
    fill.style.height = pct + '%';
    let grad;
    if (t < 50) grad = 'linear-gradient(0deg,#1a2a45,#293A53)';
    else if (t < 100) grad = 'linear-gradient(0deg,#293A53 0%,#02BFA6 100%)';
    else if (t < 115) grad = 'linear-gradient(0deg,#02BFA6 0%,#f59e0b 100%)';
    else grad = 'linear-gradient(0deg,#f59e0b 0%,#ff4444 100%)';
    fill.style.background = grad;
    document.getElementById('temp-val').innerHTML = Math.round(t) + '<small>°</small>';
    const overlay = document.getElementById('temp-overlay');
    overlay.classList.remove('warn-amber', 'warn-red');
    if (t > 110) overlay.classList.add('warn-red');
    else if (t > 100) overlay.classList.add('warn-amber');
    document.getElementById('temp-blocks').textContent = blockBar((t - 20) / 110, 8);
    const tst = document.getElementById('temp-status');
    if (t > 110) { tst.textContent = '!! SURCHAUFFE !!'; tst.classList.add('blink'); tst.style.color = pal('rust', '#E8622A'); }
    else if (t > 100) { tst.textContent = '! CHAUD !'; tst.classList.add('blink'); tst.style.color = pal('amber', '#FFB000'); }
    else { tst.textContent = ''; tst.classList.remove('blink'); }
  }

  // état courant rendu en continu (le bus rafraîchit les valeurs cibles)
  const state = { speed: 0, rpm: 0, fuel: 72, temp: 85 };
  function render() {
    drawAll(state.speed, state.rpm / 1000); // RPM véhicule en tr/min → échelle 0..8 (×1000) du design
    const n = Math.round(state.speed);
    document.getElementById('speedo-num').textContent = window.RENDER_STYLE === 'tva_crt' ? String(n).padStart(3, '0') : n;
    updateFuel(state.fuel);
    updateTemp(state.temp);
  }

  function update(d) {
    if (d.speed != null) state.speed = d.speed;
    if (d.rpm != null) state.rpm = d.rpm;
    if (d.fuel != null) state.fuel = d.fuel;
    if (d.temp != null) state.temp = d.temp;
    render();
  }

  return { update, render, state };
})();
