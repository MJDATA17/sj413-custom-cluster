/**
 * power.js — panneau DEV « POWER » : pilote le Power Manager en simulation
 * (injection contact/charge/batterie + faux signal bref) et affiche l'état de
 * la machine à états en direct. Sert à valider toute la logique sans matériel.
 */
const PowerDev = (() => {
  const $ = id => document.getElementById(id);
  async function post(body) {
    try { await fetch('/api/power/sim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch {}
    refresh();
  }
  const BTNS = [
    { label: 'SIM on', t: { enabled: true } },
    { label: 'SIM off', t: { enabled: false } },
    { label: 'Contact ON', t: { ignition: true, charge: true } },
    { label: 'Contact OFF', t: { ignition: false, charge: false } },
    { label: 'Charge ON', t: { charge: true } },
    { label: 'Charge OFF', t: { charge: false } },
    { label: 'Glitch 3s', t: { glitch: { value: false, ms: 3000 } } }, // coupure brève → NE doit PAS endormir
    { label: 'Batt 80%', t: { battery: 80 } },
    { label: 'Batt 14%', t: { battery: 14 } },
    { label: 'Batt 5%', t: { battery: 5 } },
    { label: 'dryRun on', t: { dryRun: true } },
    { label: 'dryRun off', t: { dryRun: false } }
  ];
  function build() {
    const row = $('pw-row'); if (!row || row.dataset.built) return;
    row.dataset.built = '1';
    BTNS.forEach(b => { const el = document.createElement('button'); el.textContent = b.label; el.onclick = () => post(b.t); row.appendChild(el); });
  }
  async function refresh() {
    try {
      const j = await (await fetch('/api/power')).json();
      const st = $('pw-state'); if (st) st.textContent = j.state + (j.dryRun ? ' (dryRun)' : '');
      const ro = $('pw-readout');
      if (ro) {
        const i = j.inputs || {};
        const pend = j.pending ? ` · confirm ${j.pending.target ? 'ON' : 'OFF'} ${Math.round(j.pending.sinceMs / 1000)}s` : '';
        ro.textContent = `contact=${i.contact} charge=${i.charge} ignition=${i.ignition} batt=${i.battery}% src=${j.source}${pend}`;
      }
    } catch { const st = $('pw-state'); if (st) st.textContent = '(serveur ?)'; }
  }
  function init() { build(); refresh(); setInterval(() => { if (!$('dev-panel').classList.contains('hidden')) refresh(); }, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { refresh };
})();
