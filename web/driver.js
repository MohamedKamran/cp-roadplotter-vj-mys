// Driver: map of potholes, route A -> B, countdown alert with photo as you approach.
(() => {
  const $ = (id) => document.getElementById(id);
  const SEV_RANK = { Low: 0, Medium: 1, High: 2, Critical: 3 };
  const SEV_COLOR = { Low: '#6cc287', Medium: '#f2c230', High: '#ff7a1a', Critical: '#e5484d' };
  const R = 6371000, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
  const SIM = new URLSearchParams(location.search).has('sim');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- settings ----------
  const KEY = 'pothole.driver.settings';
  const cfg = { threshold: 100, minSev: 'Low', beep: 1, voice: 1 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
  const sFields = { threshold: 'sThreshold', minSev: 'sMinSev', beep: 'sBeep', voice: 'sVoice' };
  for (const [k, id] of Object.entries(sFields)) {
    $(id).value = String(cfg[k]);
    $(id).addEventListener('change', () => {
      cfg[k] = k === 'minSev' ? $(id).value : Number($(id).value);
      try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
    });
  }
  $('setBtn').onclick = () => $('settings').classList.add('open');
  $('closeSettings').onclick = () => $('settings').classList.remove('open');

  // ---------- geometry ----------
  function dist(a, b) {
    const dp = rad(b[0] - a[0]), dl = rad(b[1] - a[1]);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  function locateOnRoute(route, p) {   // -> [offset from route m, distance along route m]
    const k = Math.cos(rad(route[0][0])), proj = (q) => [rad(q[1]) * R * k, rad(q[0]) * R];
    const [px, py] = proj(p);
    let best = [Infinity, 0], along = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, ay] = proj(route[i]), [bx, by] = proj(route[i + 1]);
      const dx = bx - ax, dy = by - ay, seg = Math.hypot(dx, dy);
      const t = seg ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (seg * seg))) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best[0]) best = [d, along + t * seg];
      along += seg;
    }
    return best;
  }

  // ---------- map ----------
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([20.59, 78.96], 5);
  window.potholeMap = map;  // handy in the browser console
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let routeLine = null, startMarker = null, endMarker = null;
  const meMarker = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }), interactive: false });

  const potholes = new Map();  // id -> pothole
  function popupHtml(p) {
    const seen = p.last_seen ? new Date(p.last_seen).toLocaleDateString() : '—';
    return `<div class="pop sev-${esc(p.severity)}">
      ${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="Pothole photo">` : ''}
      <span class="sev-chip">${esc(p.severity || 'Unscored')}</span>
      ${p.ride_score != null ? `<span class="meta"> ride impact ${Number(p.ride_score).toFixed(1)}/10</span>` : ''}
      <p>${esc(p.description || 'Pothole')}</p>
      <p class="meta">Seen ${esc(p.times_seen)} times, last on ${esc(seen)}</p>
      <div class="row">
        <button class="btn" data-id="${p.id}" data-fb="still_there">Still there</button>
        <button class="btn" data-id="${p.id}" data-fb="gone">Gone</button>
      </div></div>`;
  }
  function drawPotholes() {
    layer.clearLayers();
    for (const p of potholes.values()) {
      const c = SEV_COLOR[p.severity] || '#a9b6bf';
      L.circleMarker([p.lat, p.lon], {
        radius: 6 + Math.min(10, (p.ride_score || 3) * 0.8), color: '#14191d', weight: 2,
        fillColor: c, fillOpacity: 0.95,
      }).bindPopup(popupHtml(p)).addTo(layer);
    }
  }
  map.on('popupopen', (e) => {
    e.popup.getElement().querySelectorAll('[data-fb]').forEach((b) => {
      b.onclick = () => { sendFeedback(Number(b.dataset.id), b.dataset.fb); map.closePopup(); };
    });
  });

  async function loadNear(pos) {
    try {
      const r = await (await fetch(`/getpdata?lat=${pos[0]}&lon=${pos[1]}&radius_m=3000`)).json();
      for (const p of r.potholes) potholes.set(p.id, p);
      drawPotholes();
      if (mode === 'idle') $('routeMsg').innerHTML = `<b>${r.count}</b> pothole${r.count === 1 ? '' : 's'} within 3 km`;
    } catch { if (mode === 'idle') $('routeMsg').textContent = 'Could not load potholes. Check the connection.'; }
  }

  // ---------- route planning ----------
  let mode = 'idle', start = null, route = null;  // route = {coords, potholes}
  function setMode(m) {
    mode = m;
    $('planBtn').hidden = m !== 'idle';
    $('myLocBtn').hidden = m !== 'pickStart' || !me;
    $('clearBtn').hidden = m === 'idle';
    if (m === 'pickStart') $('routeMsg').textContent = 'Tap the map to set the start.';
    if (m === 'pickEnd') $('routeMsg').textContent = 'Tap the map to set the destination.';
  }
  $('planBtn').onclick = () => { unlockAudio(); clearRoute(); setMode('pickStart'); };
  $('myLocBtn').onclick = () => { if (me) setStart(me); };
  $('clearBtn').onclick = () => { clearRoute(); setMode('idle'); if (me) loadNear(me); };

  function clearRoute() {
    [routeLine, startMarker, endMarker].forEach((l) => l && map.removeLayer(l));
    routeLine = startMarker = endMarker = null; route = null; start = null;
    clearInterval(simTimer);
  }
  function setStart(p) {
    start = p;
    startMarker = L.circleMarker(p, { radius: 8, color: '#fff', weight: 3, fillColor: '#4aa3ff', fillOpacity: 1 }).addTo(map);
    setMode('pickEnd');
  }
  map.on('click', async (e) => {
    const p = [e.latlng.lat, e.latlng.lng];
    if (mode === 'pickStart') return setStart(p);
    if (mode !== 'pickEnd') return;
    await planRoute(start, p);
  });

  async function planRoute(a, b) {
    endMarker = L.circleMarker(b, { radius: 8, color: '#fff', weight: 3, fillColor: '#ff7a1a', fillOpacity: 1 }).addTo(map);
    $('routeMsg').textContent = 'Finding the route…';
    try {
      const res = await fetch(`/route-potholes?start=${a[0]},${a[1]}&end=${b[0]},${b[1]}`);
      if (!res.ok) throw new Error((await res.json()).detail);
      route = await res.json();
      routeLine = L.polyline(route.coords, { color: '#ff7a1a', weight: 6, opacity: 0.85 }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [40, 140] });
      for (const ph of route.potholes) potholes.set(ph.id, ph);
      drawPotholes();
      const km = (route.distance_m / 1000).toFixed(1);
      $('routeMsg').innerHTML = `<b>${route.count}</b> pothole${route.count === 1 ? '' : 's'} on this ${km} km route` +
        (route.severe_count ? `, <b>${route.severe_count}</b> severe` : '');
      setMode('route');
      follow = false; $('followBtn').classList.remove('on');
      if (SIM) simulateDrive(route.coords);
    } catch (err) {
      $('routeMsg').textContent = `No route: ${err.message}`;
      map.removeLayer(endMarker); endMarker = null; setMode('pickEnd');
    }
  }

  // ---------- follow ----------
  let follow = true;
  $('followBtn').onclick = () => {
    follow = !follow; $('followBtn').classList.toggle('on', follow); $('followBtn').setAttribute('aria-pressed', follow);
    if (follow && me) map.setView(me, Math.max(map.getZoom(), 17));
  };
  map.on('dragstart', () => { follow = false; $('followBtn').classList.remove('on'); });

  // ---------- sound + voice ----------
  let audio = null;
  function unlockAudio() { try { audio = audio || new AudioContext(); audio.resume(); } catch { /* none */ } }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  function beep(times) {
    if (!cfg.beep || !audio) return;
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.22;
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    }
  }
  function say(text) {
    if (!cfg.voice || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  // ---------- next pothole + alert ----------
  let me = null, myHeading = null, prev = null, lastLoad = null, current = null, currentDist = null;
  const announced = new Map();  // id -> set of thresholds already announced

  function nextPothole() {
    const minRank = SEV_RANK[cfg.minSev] ?? 0;
    const ok = (p) => (SEV_RANK[p.severity] ?? 1) >= minRank;
    if (route) {
      const [off, myAlong] = locateOnRoute(route.coords, me);
      if (off < 40) {
        let best = null;
        for (const p of route.potholes) {
          if (!ok(p)) continue;
          const d = p.along_route_m - myAlong;
          if (d > -5 && (!best || d < best.d)) best = { p, d: Math.max(0, d) };
        }
        return best;
      }
    }
    // no route (or off route): nearest pothole roughly ahead of us
    let best = null;
    for (const p of potholes.values()) {
      if (!ok(p)) continue;
      const d = dist(me, [p.lat, p.lon]);
      if (d > cfg.threshold * 1.5) continue;
      if (myHeading != null && d > 8 && angleDiff(bearing(me, [p.lat, p.lon]), myHeading) > 50) continue;
      if (!best || d < best.d) best = { p, d };
    }
    return best;
  }

  function updateAlert() {
    const hit = nextPothole();
    // just passed the one we were tracking? ask the driver about it
    if (current && (!hit || hit.p.id !== current.id) && currentDist != null && currentDist < 30) askFeedback(current);
    if (!hit || hit.d > cfg.threshold) { $('alert').classList.remove('show'); current = hit?.p || null; currentDist = hit?.d ?? null; return; }
    const p = hit.p, d = Math.round(hit.d);
    current = p; currentDist = hit.d;
    const el = $('alert');
    el.className = `alert show sev-${p.severity || 'Medium'}`;
    $('aImg').src = p.photo_url || ''; $('aImg').hidden = !p.photo_url;
    $('aSev').textContent = p.severity || 'Pothole';
    $('aDesc').textContent = p.description || 'Pothole ahead';
    $('aDist').textContent = d >= 20 ? Math.round(d / 5) * 5 : d;   // calm countdown: 100, 95, 90 …
    // announce once at the threshold and once at half of it
    const done = announced.get(p.id) || new Set();
    for (const t of [cfg.threshold, cfg.threshold / 2]) {
      if (hit.d <= t && !done.has(t)) {
        done.add(t); beep(t === cfg.threshold ? 1 : 2);
        say(`${p.severity && p.severity !== 'Low' ? p.severity + ' ' : ''}pothole in ${Math.round(t)} meters`);
        break;
      }
    }
    announced.set(p.id, done);
  }

  // ---------- feedback ----------
  let toastFor = null, toastTimer = null;
  function askFeedback(p) {
    toastFor = p; $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 9000);
  }
  $('toast').querySelectorAll('[data-fb]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.fb && toastFor) sendFeedback(toastFor.id, b.dataset.fb);
      $('toast').classList.remove('show');
    };
  });
  async function sendFeedback(id, kind) {
    try {
      const r = await (await fetch('/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pothole_id: id, kind }),
      })).json();
      if (r.status === 'repaired') {
        potholes.delete(id);
        if (route) route.potholes = route.potholes.filter((p) => p.id !== id);
        drawPotholes();
      }
    } catch { /* offline: ignore for the prototype */ }
  }

  // ---------- location ----------
  let wakeLock = null;
  async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
  keepAwake();

  function onFix(here, gpsHeading, speed) {
    if (gpsHeading != null && !Number.isNaN(gpsHeading) && (speed || 0) > 1) myHeading = gpsHeading;
    else if (prev && dist(prev, here) > 8) myHeading = bearing(prev, here);
    if (!prev || dist(prev, here) > 8) prev = here;
    const first = !me; me = here;
    meMarker.setLatLng(me); if (first) { meMarker.addTo(map); map.setView(me, 16); setMode(mode); }
    else if (follow) map.panTo(me, { animate: true });
    if (!route && (!lastLoad || dist(lastLoad, me) > 1000)) { lastLoad = me; loadNear(me); }
    updateAlert();
  }

  // ---------- simulated drive (open /driver?sim) ----------
  // Instead of GPS, a fake car drives each planned route at 40 km/h, so alerts can be tested at a desk.
  let simTimer = null;
  function simulateDrive(coords) {
    clearInterval(simTimer);
    const STEP = 40 / 3.6 / 2;            // metres per half second at 40 km/h
    let i = 0, along = 0;
    follow = true; $('followBtn').classList.add('on');
    simTimer = setInterval(() => {
      if (!route) { clearInterval(simTimer); return; }
      along += STEP;
      while (i < coords.length - 1 && along > dist(coords[i], coords[i + 1])) { along -= dist(coords[i], coords[i + 1]); i++; }
      if (i >= coords.length - 1) {          // arrived: pause, then drive the route again
        clearInterval(simTimer); setTimeout(() => route && simulateDrive(coords), 3000); return;
      }
      const a = coords[i], b = coords[i + 1], t = along / Math.max(0.01, dist(a, b));
      onFix([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing(a, b), STEP * 2);
    }, 500);
  }

  if (SIM) {
    $('routeMsg').textContent = 'Simulated drive: plan a route and a test car will drive it.';
    fetch('/api/config').then((r) => r.json()).then((c) => {
      if (!c.demo_start || !c.demo_end) return;
      onFix(c.demo_start, null, 0);          // preview server: drive the demo road straight away
      setStart(c.demo_start);
      planRoute(c.demo_start, c.demo_end);
    }).catch(() => {});
  } else if (!('geolocation' in navigator)) {
    $('routeMsg').textContent = 'This browser has no location access.';
  } else {
    navigator.geolocation.watchPosition(
      (pos) => onFix([pos.coords.latitude, pos.coords.longitude], pos.coords.heading, pos.coords.speed),
      (e) => {
        if (e.code === 1) $('routeMsg').textContent = 'Location is blocked. Allow it in the browser to get alerts.';
        else if (!me) $('routeMsg').textContent = 'Waiting for location…';   // brief GPS timeouts are normal
      }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  setInterval(() => { if (me && !route) loadNear(me); }, 60000);
})();
