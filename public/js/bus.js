/**
 * bus.js — connexion WebSocket à la couche acquisition (ws://localhost:3001)
 * et distribution des données véhicule aux modules. Code IDENTIQUE sim ↔ prod :
 * en SIM c'est fake-vehicle.js, en PROD le pont capteurs, même payload, même port.
 */
const Bus = (() => {
  const URL = `ws://${location.hostname || 'localhost'}:3001`;
  let ws = null, reconnectT = null;
  const listeners = [];
  let last = null;

  function setStatus(online) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.classList.toggle('online', online);
    el.classList.toggle('offline', !online);
    el.textContent = online ? '● BUS' : '● SIM ?';
    el.title = online ? `Connecté à ${URL}` : `Bus indisponible — lance \`npm run sim\` (${URL})`;
  }

  function connect() {
    try { ws = new WebSocket(URL); } catch { scheduleReconnect(); return; }
    ws.onopen = () => { setStatus(true); if (reconnectT) { clearTimeout(reconnectT); reconnectT = null; } };
    ws.onclose = () => { setStatus(false); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      last = d;
      for (const fn of listeners) { try { fn(d); } catch (e) { console.error(e); } }
    };
  }
  function scheduleReconnect() {
    if (reconnectT) return;
    reconnectT = setTimeout(() => { reconnectT = null; connect(); }, 1200);
  }

  return {
    start() { connect(); },
    onData(fn) { listeners.push(fn); if (last) fn(last); },
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    get last() { return last; }
  };
})();
