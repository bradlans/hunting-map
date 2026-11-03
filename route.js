// Michigan Hunting Map - Map route: record your GPS track as you walk, then save it as a
// line in a folder (the same lines as pins.js). Rough GPS fixes and standing-still wander
// are left out. The screen is kept awake while recording, since phones stop GPS for web
// pages when the screen sleeps. A route in progress is kept on the device, so closing the
// page by accident doesn't lose it.

(function () {
  'use strict';
  const { map, toast, $ } = window.MHM;

  const KEY = 'mhm.route.v1';
  const COLOR = '#ff3d00';
  const MAX_ACC = 35, MIN_STEP = 5; // meters: skip fixes rougher than this; ignore moves smaller than this

  // { pts: [[lng, lat, time]], startedAt, elapsed (ms recorded before this run), runStart, paused }
  let r = (() => { try { const x = JSON.parse(localStorage.getItem(KEY)); return x && Array.isArray(x.pts) ? x : null; } catch (e) { return null; } })();
  let watchId = null, wakeLock = null, gpsAcc = 0, gpsMsg = '', barOpen = false;
  function persist() { try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }

  // ---- Math and text -----------------------------------------------------------------------
  const rad = d => d * Math.PI / 180;
  function segMeters(a, b) {
    const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const length = () => (r ? r.pts.reduce((m, p, i) => (i ? m + segMeters(r.pts[i - 1], p) : 0), 0) : 0);
  const dist = m => (m < 805 ? Math.round(m * 1.0936133) + ' yd' : (m / 1609.344).toFixed(2) + ' mi');
  const elapsed = () => (r ? r.elapsed + (r.paused ? 0 : Date.now() - r.runStart) : 0);
  function dur(ms) {
    const m = Math.floor(ms / 60e3);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' hr ' + (m % 60) + ' min';
  }
  const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ---- GPS -----------------------------------------------------------------------------------
  function onFix(p) {
    if (!r || r.paused) return;
    const c = p.coords;
    gpsAcc = c.accuracy || 999; gpsMsg = '';
    if (gpsAcc <= MAX_ACC) {
      const pt = [+c.longitude.toFixed(6), +c.latitude.toFixed(6)];
      const prev = r.pts[r.pts.length - 1];
      // A step shorter than the GPS wander is just noise while standing still.
      if (!prev || segMeters(prev, pt) >= Math.max(MIN_STEP, gpsAcc * 0.6)) {
        if (!prev && !map.getBounds().contains(pt)) map.jumpTo({ center: pt, zoom: Math.max(map.getZoom(), 15) });
        r.pts.push([pt[0], pt[1], Date.now()]);
        persist(); draw();
      }
    }
    render();
  }
  function watch() {
    if (watchId != null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(onFix, err => {
      gpsMsg = err.code === 1 ? 'Location is blocked for this page. Allow location in your browser settings.' : 'Waiting for GPS...';
      render();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30e3 });
  }
  function unwatch() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  async function keepAwake() {
    if (!r || r.paused || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    catch (e) { wakeLock = null; }
  }

  // ---- Start / pause / save ------------------------------------------------------------------
  function start() {
    if (!navigator.geolocation) { toast('This browser has no GPS access.'); return; }
    r = { pts: [], startedAt: Date.now(), elapsed: 0, runStart: Date.now(), paused: false };
    gpsAcc = 0; gpsMsg = 'Getting a GPS fix...';
    persist(); watch(); keepAwake();
    barOpen = true; draw(); render();
    toast('Recording your route. Keep the map open; the screen stays on while recording.');
  }
  function pause() {
    if (!r || r.paused) return;
    r.elapsed += Date.now() - r.runStart; r.paused = true;
    persist(); unwatch(); render();
  }
  function resume() {
    if (!r || !r.paused) return;
    r.paused = false; r.runStart = Date.now(); gpsMsg = 'Getting a GPS fix...';
    persist(); watch(); keepAwake(); render();
  }
  function finish() { unwatch(); r = null; barOpen = false; persist(); draw(); render(); }
  function save() {
    if (!r || r.pts.length < 2) { toast('Walk a little farther first; there is no line yet.'); return; }
    pause();
    const first = r.pts[0][2], lastT = r.pts[r.pts.length - 1][2];
    const day = new Date(first).toLocaleDateString([], { month: 'short', day: 'numeric' });
    window.MHM.pins.saveMeasured('line', r.pts.map(p => [p[0], p[1]]), finish,
      'Route ' + day, 'Recorded ' + day + ', ' + clock(first) + ' to ' + clock(lastT) + ' (' + dur(r.elapsed) + ').');
  }
  function discard() {
    if (r && r.pts.length > 1 && !window.confirm('Throw away this ' + dist(length()) + ' route?')) return;
    finish();
    toast('Route discarded.');
  }

  // ---- Map and bar -------------------------------------------------------------------------
  function geojson() {
    const c = r ? r.pts.map(p => [p[0], p[1]]) : [];
    const f = [];
    if (c.length > 1) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: {} });
    if (c.length) f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c[0] }, properties: {} });
    return { type: 'FeatureCollection', features: f };
  }
  function draw() { if (map.getSource('route-live')) map.getSource('route-live').setData(geojson()); }
  function initLayers() {
    map.addSource('route-live', { type: 'geojson', data: geojson() });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route-live', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': 'rgba(0,0,0,.6)', 'line-width': 7 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route-live', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COLOR, 'line-width': 4 } });
    map.addLayer({ id: 'route-start', type: 'circle', source: 'route-live', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': COLOR, 'circle-stroke-width': 3 } });
  }
  function render() {
    const btn = $('btnRoute');
    btn.classList.toggle('sharing', !!r && !r.paused);
    btn.setAttribute('aria-pressed', String(!!r));
    btn.innerHTML = !r ? 'Map route' : r.paused ? 'Route paused · ' + dist(length()) : '<i class="live-dot" aria-hidden="true"></i>Recording · ' + dist(length());
    // One bottom bar at a time: the pin and measure bars win while they're open.
    const other = !$('placebar').hidden || !$('measurebar').hidden;
    $('routebar').hidden = !r || !barOpen || other;
    if (!r) return;
    const head = '<b>' + dist(length()) + '</b> · ' + dur(elapsed());
    $('routeReadout').innerHTML = r.paused
      ? head + ' · paused'
      : head + ' · ' + (gpsMsg ? gpsMsg : gpsAcc > MAX_ACC ? 'GPS too rough right now (±' + Math.round(gpsAcc * 1.0936) + ' yd), waiting' : 'GPS ±' + Math.max(1, Math.round(gpsAcc * 1.0936)) + ' yd');
    $('btnRoutePause').textContent = r.paused ? 'Resume' : 'Pause';
    $('btnRouteSave').disabled = r.pts.length < 2;
  }

  $('btnRoute').addEventListener('click', () => {
    if (!r) start();
    else { barOpen = $('routebar').hidden; render(); } // show or hide the route bar
  });
  $('btnRoutePause').addEventListener('click', () => (r && r.paused ? resume() : pause()));
  $('btnRouteSave').addEventListener('click', save);
  $('btnRouteDiscard').addEventListener('click', discard);
  $('btnRouteHide').addEventListener('click', () => { barOpen = false; render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); render(); } });
  setInterval(() => { if (r) render(); }, 5e3); // keep the time current

  window.MHM.onLoad(initLayers);
  // Reopened with a route in progress: keep it, paused, and offer to carry on.
  if (r) {
    if (!r.paused) {
      const lastT = r.pts.length ? r.pts[r.pts.length - 1][2] : r.runStart;
      r.elapsed += Math.max(0, lastT - r.runStart); r.paused = true; persist();
    }
    barOpen = true;
    setTimeout(() => toast('You have a route in progress (' + dist(length()) + '). Tap Resume to keep recording, or Save.'), 2000);
  }
  render();

  window.MHM.route = { start, pause, resume, save, discard, state: () => r };
})();
