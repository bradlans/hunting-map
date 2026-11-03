// Michigan Hunting Map - friend locations.
// "Share my location" (Friends button) writes your spot to locations/<name>.json in the
// shared repo about once a minute, for a set time; turning it off deletes the file.
// Everyone in the shared repo sees each other's latest spot as a labeled dot.
// A web page only gets GPS while it is open on screen, so a dot is "last seen", not live.

(function () {
  'use strict';
  const { map, toast, openPopup, esc, $, getUserPos } = window.MHM;
  const GH = window.MHM.github;

  const APP = 'mhm-location';
  const KEY = 'mhm.share.v1';
  const SEND_EVERY = 60e3, POLL_EVERY = 60e3, MIN_MOVE = 15; // ms, ms, meters
  const COLOR = '#8e5cff', STALE = '#9a9a9a', STALE_AFTER = 10 * 60e3;

  const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  function saveSt() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* storage blocked */ } }
  let watchId = null, myPos = null, sentPos = null, sentAt = 0, sendTimer = null, pollTimer = null, sending = false;
  let friends = []; // [{ name, lng, lat, acc, at, until }]
  const shas = {}; // path -> sha, so unchanged friend files aren't fetched again

  const sharing = () => !!(st.until && st.until > Date.now());
  const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'me';
  const myFile = () => 'locations/' + slug(GH.myName()) + '.json';

  // ---- Distances --------------------------------------------------------------------------
  const rad = d => d * Math.PI / 180;
  function meters(a, b) {
    const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360 / 45) % 8];
  }
  const dist = m => (m < 805 ? Math.round(m * 1.0936133) + ' yd' : (m / 1609.344).toFixed(m < 16093 ? 2 : 1) + ' mi');
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60e3);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    return Math.floor(m / 60) + ' hr ' + (m % 60) + ' min ago';
  }
  const here = () => myPos || getUserPos();
  function whereIs(f) {
    const me = here();
    return me ? dist(meters(me, [f.lng, f.lat])) + ' ' + bearing(me, [f.lng, f.lat]) : '';
  }

  // ---- Sending my spot -------------------------------------------------------------------
  async function send(force) {
    if (!sharing() || !myPos || sending || document.visibilityState !== 'visible') return;
    const moved = !sentPos || meters(sentPos, myPos) >= MIN_MOVE;
    if (!force && !moved && Date.now() - sentAt < 5 * SEND_EVERY) return; // standing still: check in every 5 min
    sending = true;
    const body = { app: APP, v: 1, name: GH.myName(), lng: +myPos[0].toFixed(6), lat: +myPos[1].toFixed(6), acc: Math.round(st.acc || 0), at: Date.now(), until: st.until };
    try {
      let cur = await GH.pullFile(GH.sharedRepo(), myFile());
      if (!(await GH.pushFile(GH.sharedRepo(), myFile(), body, cur && cur.sha, 'Location: ' + body.name))) {
        cur = await GH.pullFile(GH.sharedRepo(), myFile());
        await GH.pushFile(GH.sharedRepo(), myFile(), body, cur && cur.sha, 'Location: ' + body.name);
      }
      sentPos = myPos; sentAt = body.at; st.error = '';
    } catch (err) {
      st.error = err.friendly ? err.message : 'Could not reach GitHub. Will try again.';
    } finally {
      sending = false; saveSt(); render();
    }
  }
  async function removeMine() {
    try {
      const cur = await GH.pullFile(GH.sharedRepo(), myFile());
      if (cur) await GH.gh(GH.sharedRepo(), '/contents/' + myFile(), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Stopped sharing location: ' + GH.myName(), sha: cur.sha }),
      });
    } catch (e) { /* offline: the file expires on its own at "until" */ }
  }

  function startWatch() {
    if (watchId != null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(p => {
      myPos = [p.coords.longitude, p.coords.latitude]; st.acc = p.coords.accuracy;
      if (!sentPos) send(true);
      render();
    }, err => {
      st.error = err.code === 1 ? 'Location is blocked for this page. Allow location in your browser settings.' : 'Waiting for a GPS fix...';
      render();
    }, { enableHighAccuracy: true, maximumAge: 30e3, timeout: 60e3 });
    clearInterval(sendTimer);
    sendTimer = setInterval(() => { if (!sharing()) stopSharing(true); else send(false); }, SEND_EVERY);
  }
  function stopWatch() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; clearInterval(sendTimer); sendTimer = null;
  }
  function startSharing(hours) {
    if (!GH.ready()) { toast('Set up GitHub sync first (Pins tab), then share your location.'); render(); return; }
    if (!GH.askName()) { render(); return; }
    if (!navigator.geolocation) { toast('This browser has no GPS access.'); render(); return; }
    st.until = Date.now() + hours * 3600e3; st.hours = hours; st.error = '';
    sentPos = null; saveSt();
    startWatch(); render();
    toast('Sharing your location until ' + new Date(st.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.');
  }
  function stopSharing(expired) {
    const was = !!st.until;
    st.until = 0; saveSt();
    stopWatch(); myPos = null; sentPos = null;
    if (was) removeMine();
    render();
    if (was) toast(expired ? 'Location sharing ended.' : 'Stopped sharing your location.');
  }

  // ---- Friends' spots ----------------------------------------------------------------------
  async function poll() {
    if (!GH.ready() || document.visibilityState !== 'visible') return;
    try {
      const res = await GH.gh(GH.sharedRepo(), '/contents/locations');
      const list = res.status === 404 ? [] : res.ok ? await res.json() : null;
      if (!Array.isArray(list)) return;
      const mine = GH.myName() ? myFile() : '';
      const next = [];
      for (const item of list.filter(x => x.type === 'file' && /\.json$/.test(x.name) && x.path !== mine)) {
        let f = friends.find(x => x.path === item.path);
        if (!f || shas[item.path] !== item.sha) {
          const got = await GH.pullFile(GH.sharedRepo(), item.path);
          const j = got && got.json;
          if (!j || j.app !== APP || !isFinite(j.lng) || !isFinite(j.lat)) continue;
          f = { path: item.path, name: String(j.name || item.name.replace(/\.json$/, '')).slice(0, 30), lng: +j.lng, lat: +j.lat, acc: +j.acc || 0, at: +j.at || 0, until: +j.until || 0 };
          shas[item.path] = item.sha;
        }
        if (f.until > Date.now()) next.push(f); // a share that ran out (but wasn't cleaned up) is hidden
      }
      friends = next.sort((a, b) => a.name.localeCompare(b.name));
      render();
    } catch (e) { /* offline: keep the last spots */ }
  }
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_EVERY);
    poll();
  }

  // ---- Map --------------------------------------------------------------------------------
  function geojson() {
    return {
      type: 'FeatureCollection',
      features: friends.map(f => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
        properties: { path: f.path, label: f.name + ' · ' + ago(f.at), stale: Date.now() - f.at > STALE_AFTER },
      })),
    };
  }
  function initLayers() {
    map.addSource('friends', { type: 'geojson', data: geojson() });
    map.addLayer({ id: 'friends-dot', type: 'circle', source: 'friends',
      paint: { 'circle-radius': 8, 'circle-color': ['case', ['get', 'stale'], STALE, COLOR], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'friends-label', type: 'symbol', source: 'friends',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4 } });
  }
  function friendPopup(f) {
    const el = document.createElement('div');
    el.className = 'pop';
    const w = whereIs(f);
    el.innerHTML = '<h4>' + esc(f.name) + '</h4>' +
      '<div class="tag"><i style="background:' + (Date.now() - f.at > STALE_AFTER ? STALE : COLOR) + '"></i>Friend location</div>' +
      '<dl><dt>Last seen</dt><dd>' + esc(ago(f.at)) + ' (' + esc(new Date(f.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + ')</dd>' +
      (w ? '<dt>From you</dt><dd>' + esc(w) + '</dd>' : '') +
      (f.acc ? '<dt>Accuracy</dt><dd>about ' + Math.round(f.acc * 1.0936) + ' yd</dd>' : '') +
      '<dt>Sharing until</dt><dd>' + esc(new Date(f.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</dd></dl>' +
      '<div class="pin-actions"><button class="btn" data-act="copy">Copy GPS</button>' +
      '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + f.lat + ',' + f.lng + '">Directions</a></div>' +
      '<div class="hint">This is where they were when their map was last open. Never use it to decide if a shot is safe.</div>';
    el.querySelector('[data-act="copy"]').addEventListener('click', e => {
      const t = f.lat.toFixed(6) + ', ' + f.lng.toFixed(6);
      GH.copyText(t).then(ok => { toast(ok ? 'Copied ' + t : 'Coordinates: ' + t); if (ok) e.target.textContent = 'Copied'; });
    });
    return el;
  }
  // Called from app.js before pins: a tap on a friend's dot.
  window.MHM.friendClick = e => {
    if (!map.getLayer('friends-dot') || !friends.length) return false;
    const pad = 12;
    const hit = map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['friends-dot', 'friends-label'] });
    const f = hit.length && friends.find(x => x.path === hit[0].properties.path);
    if (!f) return false;
    openPopup([f.lng, f.lat], friendPopup(f));
    return true;
  };

  // ---- Friends button and sheet --------------------------------------------------------------
  function render() {
    if (map.getSource('friends')) map.getSource('friends').setData(geojson());
    const on = sharing();
    const btn = $('btnFriends');
    btn.classList.toggle('sharing', on);
    btn.setAttribute('aria-pressed', on);
    btn.innerHTML = (on ? '<i class="live-dot" aria-hidden="true"></i>Sharing' : 'Friends') + (friends.length ? ' <b>' + friends.length + '</b>' : '');
    $('chkShareLoc').checked = on;
    $('shareFor').disabled = on;
    if (st.hours) $('shareFor').value = String(st.hours);
    $('shareStatus').className = 'small' + (st.error && on ? ' warn' : '');
    $('shareStatus').textContent = !on
      ? 'Off. Friends in your shared group can\'t see you.'
      : (st.error || (sentAt ? 'On until ' + new Date(st.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · sent ' + ago(sentAt) + '. Keep the map open to keep it updating.' : 'On. Getting a GPS fix...'));
    $('friendList').innerHTML = friends.length
      ? friends.map(f => '<li data-friend="' + esc(f.path) + '"><i style="background:' + (Date.now() - f.at > STALE_AFTER ? STALE : COLOR) + '"></i>' +
          '<span class="t">' + esc(f.name) + '<small>' + esc([whereIs(f), 'seen ' + ago(f.at)].filter(Boolean).join(' · ')) + '</small></span></li>').join('')
      : '<li class="empty">Nobody else is sharing right now.</li>';
  }
  function openSheet() { $('friendsWrap').hidden = false; render(); poll(); }
  function closeSheet() { $('friendsWrap').hidden = true; }
  $('btnFriends').addEventListener('click', openSheet);
  $('btnFriendsClose').addEventListener('click', closeSheet);
  $('friendsWrap').addEventListener('click', e => { if (e.target === $('friendsWrap')) closeSheet(); });
  $('btnFriendsRefresh').addEventListener('click', () => { poll(); send(true); toast('Refreshing friends...'); });
  $('chkShareLoc').addEventListener('change', e => { if (e.target.checked) startSharing(+$('shareFor').value); else stopSharing(false); });
  $('friendList').addEventListener('click', e => {
    const li = e.target.closest('[data-friend]');
    const f = li && friends.find(x => x.path === li.dataset.friend);
    if (!f) return;
    closeSheet();
    map.flyTo({ center: [f.lng, f.lat], zoom: Math.max(map.getZoom(), 15) });
    map.once('moveend', () => openPopup([f.lng, f.lat], friendPopup(f)));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('friendsWrap').hidden) closeSheet(); });
  // Back on screen: send right away and pick up friends' new spots.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (sharing()) send(true); else if (st.until) stopSharing(true);
    poll();
  });
  setInterval(render, 30e3); // keep "x min ago" current

  window.MHM.onLoad(initLayers);
  if (sharing()) startWatch(); else if (st.until) stopSharing(true); // resume, or tidy up an expired share
  render();
  startPolling();

  window.MHM.friends = { start: startSharing, stop: stopSharing, poll, list: () => friends };
})();
