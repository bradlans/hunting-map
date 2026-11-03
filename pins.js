// Michigan Hunting Map - pins, folders, pin types, and GitHub sync.
// Pins live on this device (localStorage). "Sync with GitHub" keeps devices in step by
// merging with a pins.json file in a private GitHub repo: newest edit wins per item,
// and deletes are remembered so they carry across.

(function () {
  'use strict';
  const { map, toast, openPopup, closePopup, esc, $, setPanel, geo, getUserPos } = window.MHM;

  // ---- Data -------------------------------------------------------------------
  const KEY = 'mhm.pins.v1';
  const UNFILED = 'unfiled';
  const DEFAULT_TYPES = [
    { id: 'scrape',   name: 'Scrape',        color: '#8b5a2b', badge: 'SC' },
    { id: 'rub',      name: 'Rub',           color: '#c47a2c', badge: 'RB' },
    { id: 'stand',    name: 'Stand / blind', color: '#2e7d32', badge: 'ST' },
    { id: 'cam',      name: 'Trail camera',  color: '#455a64', badge: 'TC' },
    { id: 'bed',      name: 'Bedding',       color: '#7b5ea7', badge: 'BD' },
    { id: 'sighting', name: 'Deer sighting', color: '#1e88e5', badge: 'DS' },
    { id: 'parking',  name: 'Parking',       color: '#1565c0', badge: 'P' },
    { id: 'want',     name: 'Want to hunt',  color: '#e2571c', badge: '★' },
  ];
  const now = () => Date.now();

  let storageOk = true;
  const data = load();
  function load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { storageOk = false; }
    d = d && typeof d === 'object' ? d : {};
    d.types = Array.isArray(d.types) && d.types.length ? d.types : DEFAULT_TYPES.map(t => Object.assign({ updatedAt: 0 }, t));
    d.folders = Array.isArray(d.folders) ? d.folders : [];
    d.pins = Array.isArray(d.pins) ? d.pins : [];
    d.deleted = d.deleted && typeof d.deleted === 'object' ? d.deleted : {};
    d.joined = Array.isArray(d.joined) ? d.joined : []; // live shared folders this person is in
    d.sharedMeta = d.sharedMeta && typeof d.sharedMeta === 'object' ? d.sharedMeta : {}; // this device's copy of each one's deletes and members
    d.me = d.me && d.me.name ? d.me : null; // name shown on pins edited in shared folders
    d.last = d.last || {};
    return tidy(d);
  }
  // Unfiled always exists, and every pin points at a real type and folder.
  function tidy(d) {
    if (!d.folders.some(f => f.id === UNFILED)) d.folders.unshift({ id: UNFILED, name: 'Unfiled', visible: true, updatedAt: 0 });
    if (!d.types.length) d.types = DEFAULT_TYPES.map(t => Object.assign({ updatedAt: 0 }, t));
    const typeIds = d.types.map(t => t.id), folderIds = d.folders.map(f => f.id);
    d.pins.forEach(p => {
      if (typeIds.indexOf(p.type) < 0) p.type = typeIds[0];
      if (folderIds.indexOf(p.folder) < 0) p.folder = UNFILED;
    });
    return d;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); storageOk = true; }
    catch (e) {
      if (storageOk) toast('This browser is not saving pins (private mode or storage blocked). Sync or export before closing.');
      storageOk = false;
    }
  }
  // Every edit goes through here: save, redraw, and queue a sync.
  function changed() { save(); renderAll(); scheduleSync(); }
  function stamp(x) { x.updatedAt = now(); return x; }
  function tomb(kind, id) { data.deleted[kind + ':' + id] = now(); }
  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  const typeById = id => data.types.find(t => t.id === id) || data.types[0];
  const folderById = id => data.folders.find(f => f.id === id) || data.folders[0];
  const pinById = id => data.pins.find(p => p.id === id);
  // A folder is live-shared when it is in the joined list. Its pins live in its own file in
  // the shared repo, not in this person's pins.json.
  const isShared = fid => data.joined.some(j => j.id === fid);
  const myName = () => (data.me ? data.me.name : '');
  function stampPin(p) {
    stamp(p);
    if (isShared(p.folder)) p.by = myName(); else delete p.by;
    return p;
  }
  // A deleted pin is remembered where it lived: the shared folder's file or pins.json.
  function tombPin(p) {
    if (isShared(p.folder)) data.sharedMeta[p.folder].deleted['p:' + p.id] = now();
    else tomb('p', p.id);
  }
  // One pin id lives in one place; if two copies meet, the newest edit wins.
  function dedupe() {
    const best = new Map();
    data.pins.forEach(p => { const c = best.get(p.id); if (!c || (p.updatedAt || 0) > (c.updatedAt || 0)) best.set(p.id, p); });
    if (best.size !== data.pins.length) data.pins = Array.from(best.values());
  }

  // ---- Merging (sync and import) ------------------------------------------------
  const validType = t => t && t.id && t.name && /^#[0-9a-f]{6}$/i.test(t.color || '');
  const validFolder = f => f && f.id && f.name;
  const validPin = p => p && p.id && isFinite(p.lng) && isFinite(p.lat);
  const validJoin = j => j && /^[\w-]{1,40}$/.test(j.id || '');
  function mergeInto(target, inc) {
    const tombs = Object.assign({}, target.deleted);
    Object.keys(inc.deleted || {}).forEach(k => { if (!(tombs[k] >= inc.deleted[k])) tombs[k] = inc.deleted[k]; });
    const mergeList = (kind, mine, theirs, valid, local) => {
      const byId = new Map(mine.map(x => [x.id, x]));
      (theirs || []).filter(valid).forEach(x => {
        const cur = byId.get(x.id);
        if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(x.id, Object.assign({}, x, local ? local(cur) : {}));
      });
      return Array.from(byId.values()).filter(x => {
        const t = tombs[kind + ':' + x.id];
        return !(t && t >= (x.updatedAt || 0)) || (kind === 'f' && x.id === UNFILED);
      });
    };
    target.types = mergeList('t', target.types, inc.types, validType);
    // Which folders are shown is a per-device choice, so it never comes from another device.
    target.folders = mergeList('f', target.folders, inc.folders, validFolder, cur => ({ visible: cur ? cur.visible !== false : true }));
    target.pins = mergeList('p', target.pins, inc.pins, validPin);
    if (target.joined || inc.joined) target.joined = mergeList('j', target.joined || [], inc.joined, validJoin);
    if (inc.me && inc.me.name && (!target.me || (inc.me.updatedAt || 0) > (target.me.updatedAt || 0))) target.me = { name: String(inc.me.name).slice(0, 30), updatedAt: inc.me.updatedAt || 0 };
    const cutoff = now() - 180 * 864e5; // forget deletes after six months
    Object.keys(tombs).forEach(k => { if (tombs[k] < cutoff) delete tombs[k]; });
    target.deleted = tombs;
    tidy(target);
  }
  // What goes to GitHub (and to an exported backup). Shared folders are listed by id only;
  // their pins are in the shared repo.
  function payload() {
    return {
      app: 'michigan-hunting-map', version: 3,
      types: data.types.map(t => ({ id: t.id, name: t.name, color: t.color, badge: t.badge || '', updatedAt: t.updatedAt || 0 })),
      folders: data.folders.filter(f => !isShared(f.id)).map(f => ({ id: f.id, name: f.name, updatedAt: f.updatedAt || 0 })),
      pins: data.pins.filter(p => !isShared(p.folder)).map(p => ({ id: p.id, lng: p.lng, lat: p.lat, type: p.type, folder: p.folder, name: p.name || '', note: p.note || '', created: p.created, updatedAt: p.updatedAt || 0 })),
      joined: data.joined.map(j => ({ id: j.id, name: j.name || '', updatedAt: j.updatedAt || 0 })),
      me: data.me,
      deleted: data.deleted,
    };
  }

  // ---- Map icons --------------------------------------------------------------
  function textColorFor(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1b1b1b' : '#ffffff';
  }
  function pinImage(t) {
    const w = 56, h = 72, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.beginPath();
    g.moveTo(28, 70);
    g.bezierCurveTo(22, 56, 4, 44, 4, 27);
    g.arc(28, 27, 24, Math.PI, 0);
    g.bezierCurveTo(52, 44, 34, 56, 28, 70);
    g.closePath();
    g.fillStyle = t.color; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    g.fillStyle = textColorFor(t.color);
    g.font = '700 ' + ((t.badge || '').length > 1 ? 20 : 24) + 'px Barlow, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((t.badge || '').toUpperCase(), 28, 28);
    return g.getImageData(0, 0, w, h);
  }
  let mapReady = false;
  function refreshIcon(t) {
    if (!mapReady) return; // initMap draws every type once the map is ready
    const name = 'pin-' + t.id, img = pinImage(t);
    if (map.hasImage(name)) map.updateImage(name, img); else map.addImage(name, img, { pixelRatio: 2 });
  }

  // ---- Map layer ----------------------------------------------------------------
  function renderMap() {
    if (!map.getSource('pins')) return;
    data.types.forEach(t => { if (!map.hasImage('pin-' + t.id)) refreshIcon(t); });
    const shown = data.folders.filter(f => f.visible !== false).map(f => f.id);
    map.getSource('pins').setData({
      type: 'FeatureCollection',
      features: data.pins.filter(p => shown.indexOf(p.folder) >= 0).map(p => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { id: p.id, type: p.type, name: p.name || '' },
      })),
    });
  }
  function initMap() {
    mapReady = true;
    data.types.forEach(refreshIcon);
    map.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'pins', type: 'symbol', source: 'pins',
      layout: {
        'icon-image': ['concat', 'pin-', ['get', 'type']], 'icon-anchor': 'bottom',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.7, 11, 0.9, 14, 1],
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'text-field': ['step', ['zoom'], '', 13, ['get', 'name']], 'text-font': ['Noto Sans Medium'], 'text-size': 12,
        'text-anchor': 'top', 'text-offset': [0, 0.2], 'text-optional': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4 },
    });
    map.on('mouseenter', 'pins', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'pins', () => { map.getCanvas().style.cursor = placing ? 'crosshair' : ''; });
    renderMap();
  }
  window.MHM.onLoad(initMap);

  // ---- Coordinates: copy and paste -----------------------------------------------
  const fmt = (lat, lng) => lat.toFixed(6) + ', ' + lng.toFixed(6);
  // Resolves true once the text is on the clipboard.
  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, fallback);
    return Promise.resolve(fallback());
  }
  function copyCoords(lat, lng, btn) {
    const text = fmt(lat, lng);
    copyText(text).then(ok => {
      if (!ok) { toast('Could not copy. Coordinates: ' + text); return; }
      toast('Copied ' + text);
      if (btn) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy GPS'; }, 1500); }
    });
  }
  // Reads "44.24, -85.45", "44.24 -85.45", "44°14'24\"N 85°27'0\"W", "N44 14.4 W85 27.0",
  // and Google Maps links ("@44.24,-85.45"). Returns {lat, lng, note} or null.
  function parseCoords(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    const at = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (at) s = at[1] + ', ' + at[2];
    s = s.replace(/[°º˚]/g, ' ').replace(/[′’']/g, ' ').replace(/[″"]|''/g, ' ').toUpperCase();
    const part = str => {
      const hemi = (str.match(/[NSEW]/) || [''])[0];
      const nums = (str.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (!nums.length || nums.length > 3) return null;
      const neg = nums[0] < 0;
      let v = Math.abs(nums[0]) + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
      if (neg || hemi === 'S' || hemi === 'W') v = -v;
      return { v, hemi };
    };
    // Split into the two halves: by hemisphere letters, a comma, or the number count.
    let halves = null;
    if (/[NS]/.test(s) && /[EW]/.test(s)) {
      // Letter before the numbers (N44 14.4) or after them (44 14 24 N).
      const nums = '(\\d+(?:\\.\\d+)?(?:[\\s,]+\\d+(?:\\.\\d+)?){0,2})';
      const re = /^\s*[NSEW]/.test(s) ? new RegExp('([NSEW])\\s*' + nums, 'g') : new RegExp(nums + '\\s*([NSEW])', 'g');
      const found = [];
      let m;
      while ((m = re.exec(s)) && found.length < 2) found.push(/^[NSEW]$/.test(m[1]) ? m[1] + ' ' + m[2] : m[2] + ' ' + m[1]);
      if (found.length === 2) halves = found;
    }
    if (!halves && s.indexOf(',') >= 0) halves = s.split(',').slice(0, 2);
    if (!halves) {
      const nums = s.match(/-?\d+(?:\.\d+)?/g) || [];
      if (nums.length === 2) halves = nums;
      else if (nums.length === 4 || nums.length === 6) { const h = nums.length / 2; halves = [nums.slice(0, h).join(' '), nums.slice(h).join(' ')]; }
    }
    if (!halves || halves.length < 2) return null;
    let a = part(halves[0]), b = part(halves[1]);
    if (!a || !b) return null;
    let lat = a.v, lng = b.v, note = '';
    if (a.hemi === 'E' || a.hemi === 'W' || b.hemi === 'N' || b.hemi === 'S') { lat = b.v; lng = a.v; }
    else if ((Math.abs(lat) > 90 && Math.abs(lng) <= 90) || (lat < -82 && lat > -91 && lng > 41 && lng < 49)) {
      const t = lat; lat = lng; lng = t; note = ' (read as longitude, latitude)'; // Michigan typed lng-first
    }
    // Michigan longitudes are west; a missing minus sign is the usual slip.
    if (!a.hemi && !b.hemi && lng > 82 && lng < 91 && lat > 41 && lat < 49) { lng = -lng; note = ' (assumed West)'; }
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
    return { lat, lng, note };
  }
  function goToCoords(text) {
    const c = parseCoords(text);
    if (!c) {
      $('coordError').textContent = 'Could not read those coordinates. Try 44.24000, -85.45000';
      return false;
    }
    $('coordError').textContent = '';
    if (!placing) startPlacing();
    $('coordInput').value = fmt(c.lat, c.lng);
    // Jump, not glide: the crosshair must be exactly on the spot the moment Drop is tapped.
    map.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), 16) });
    $('placeHint').textContent = 'Crosshair is on ' + fmt(c.lat, c.lng) + c.note + '. ' +
      (movingId ? 'Tap "Move pin here" to move it.' : 'Tap "Drop pin here" to drop a pin.');
    return true;
  }
  $('coordForm').addEventListener('submit', e => { e.preventDefault(); goToCoords($('coordInput').value); });
  $('coordInput').addEventListener('paste', () => setTimeout(() => goToCoords($('coordInput').value), 0));
  $('coordInput').addEventListener('input', () => { $('coordError').textContent = ''; });
  // Pasting coordinates anywhere on the map (not into a text box) jumps the crosshair there.
  document.addEventListener('paste', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (!parseCoords(text)) return;
    e.preventDefault();
    goToCoords(text);
  });

  // ---- Pin popup --------------------------------------------------------------
  function showPinPopup(p) {
    const t = typeById(p.type), f = folderById(p.folder);
    const el = document.createElement('div');
    el.className = 'pop';
    const when = p.created ? new Date(p.created).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    el.innerHTML =
      '<h4>' + esc(p.name || t.name) + '</h4>' +
      '<div class="tag"><span class="badge-dot" style="background:' + esc(t.color) + ';color:' + textColorFor(t.color) + '">' + esc((t.badge || '').toUpperCase()) + '</span>' + esc(t.name) + '</div>' +
      '<dl><dt>Folder</dt><dd>' + esc(f.name) + (isShared(f.id) ? ' <span class="chip-shared">Shared</span>' : '') + '</dd>' +
      (when ? '<dt>Added</dt><dd>' + esc(when) + '</dd>' : '') +
      (isShared(f.id) && p.by ? '<dt>Edited</dt><dd>' + esc(p.by) + ', ' + esc(ago(p.updatedAt)) + '</dd>' : '') +
      '<dt>Location</dt><dd>' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</dd></dl>' +
      (p.note ? '<p class="note-text">' + esc(p.note) + '</p>' : '') +
      '<div class="pin-actions">' +
      '<button class="btn" data-act="copy">Copy GPS</button>' +
      '<button class="btn" data-act="edit">Edit</button><button class="btn" data-act="move">Move</button>' +
      '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lng + '">Directions</a>' +
      '</div>';
    el.querySelector('[data-act="copy"]').addEventListener('click', e => copyCoords(p.lat, p.lng, e.currentTarget));
    el.querySelector('[data-act="edit"]').addEventListener('click', () => { closePopup(); openEditor(p.id); });
    el.querySelector('[data-act="move"]').addEventListener('click', () => { closePopup(); startPlacing(p.id); });
    openPopup([p.lng, p.lat], el, { offset: [0, -34] });
  }

  // Map taps: placing a pin wins, then tapping an existing pin.
  window.MHM.onMapClick = e => {
    if (now() < suppressClickUntil) return true; // the tap that ended a press-and-hold
    if (placing) { finishPlacing(e.lngLat); return true; }
    if (!map.getLayer('pins')) return false;
    const pad = 10;
    const hit = map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + 4]], { layers: ['pins'] });
    if (!hit.length) return false;
    const p = pinById(hit[0].properties.id);
    if (p) showPinPopup(p);
    return !!p;
  };

  // ---- Placing a pin ----------------------------------------------------------
  let placing = false, movingId = null;
  const narrow = () => !window.matchMedia('(min-width: 800px)').matches;
  function startPlacing(moveId) {
    placing = true; movingId = moveId || null;
    $('btnAddPin').textContent = 'Cancel pin'; $('btnAddPin').setAttribute('aria-pressed', 'true');
    if (narrow()) setPanel(false);
    $('placeHint').textContent = movingId
      ? 'Move the map so the crosshair is on the new spot, or tap the map.'
      : 'Move the map so the crosshair is on the spot, or tap the map.';
    $('btnPlaceHere').textContent = movingId ? 'Move pin here' : 'Drop pin here';
    $('coordInput').value = ''; $('coordError').textContent = '';
    $('crosshair').hidden = false; $('placebar').hidden = false;
    map.getCanvas().style.cursor = 'crosshair';
  }
  function stopPlacing() {
    placing = false;
    $('btnAddPin').textContent = '+ Pin'; $('btnAddPin').setAttribute('aria-pressed', 'false');
    $('crosshair').hidden = true; $('placebar').hidden = true;
    map.getCanvas().style.cursor = '';
  }
  function finishPlacing(lngLat) {
    const ll = { lng: +lngLat.lng.toFixed(6), lat: +lngLat.lat.toFixed(6) };
    const moving = movingId; stopPlacing(); movingId = null;
    if (moving) {
      const p = pinById(moving);
      if (p) { p.lng = ll.lng; p.lat = ll.lat; stampPin(p); changed(); toast('Pin moved'); }
      return;
    }
    openEditor(null, ll);
  }
  $('btnAddPin').addEventListener('click', () => { if (placing) { stopPlacing(); movingId = null; } else startPlacing(); });

  // Quick drop: double-click (mouse) or press and hold (touch) opens a new pin right there.
  let pressTimer = null, pressAt = null, suppressClickUntil = 0;
  const dropAt = (lng, lat) => { closePopup(); openEditor(null, { lng: +lng.toFixed(6), lat: +lat.toFixed(6) }); };
  map.doubleClickZoom.disable();
  map.on('dblclick', e => {
    e.preventDefault();
    if (placing || window.MHM.measuring || !$('editorWrap').hidden) return;
    dropAt(e.lngLat.lng, e.lngLat.lat);
  });
  const box = map.getCanvasContainer();
  const touchPoint = t => { const r = box.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; };
  function cancelPress() { clearTimeout(pressTimer); pressTimer = null; }
  box.addEventListener('touchstart', ev => {
    cancelPress();
    if (ev.touches.length !== 1 || placing || window.MHM.measuring || !$('editorWrap').hidden) return;
    pressAt = touchPoint(ev.touches[0]);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      const ll = map.unproject(pressAt);
      suppressClickUntil = now() + 800;
      if (navigator.vibrate) navigator.vibrate(30);
      dropAt(ll.lng, ll.lat);
    }, 550);
  }, { passive: true });
  box.addEventListener('touchmove', ev => {
    if (!pressTimer) return;
    const p = touchPoint(ev.touches[0]);
    if (ev.touches.length !== 1 || Math.hypot(p[0] - pressAt[0], p[1] - pressAt[1]) > 10) cancelPress();
  }, { passive: true });
  ['touchend', 'touchcancel'].forEach(n => box.addEventListener(n, cancelPress, { passive: true }));
  box.addEventListener('contextmenu', ev => { if (ev.pointerType === 'touch' || now() < suppressClickUntil) ev.preventDefault(); });
  $('btnPlaceHere').addEventListener('click', () => finishPlacing(map.getCenter()));
  $('btnPlaceCancel').addEventListener('click', () => { stopPlacing(); movingId = null; });
  $('btnPlaceGps').addEventListener('click', () => {
    const pos = getUserPos();
    if (pos) { finishPlacing({ lng: pos[0], lat: pos[1] }); return; }
    toast('Finding your location...');
    geo.once('geolocate', ev => { if (placing) finishPlacing({ lng: ev.coords.longitude, lat: ev.coords.latitude }); });
    if (!geo.trigger()) toast('Location is not available here. Allow location for this page, or place the pin by hand.');
  });

  // ---- Pin editor -------------------------------------------------------------
  let editing = null, editPoint = null, deleteArmed = false;
  function fillSelects(typeId, folderId) {
    $('pinType').innerHTML = data.types.map(t =>
      '<option value="' + esc(t.id) + '"' + (t.id === typeId ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
    $('pinFolder').innerHTML = data.folders.map(f =>
      '<option value="' + esc(f.id) + '"' + (f.id === folderId ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') +
      '<option value="__new">+ New folder…</option>';
    $('newFolderField').hidden = true; $('pinNewFolder').value = '';
  }
  function openEditor(pinId, point) {
    editing = pinId ? pinById(pinId) : null;
    editPoint = point || null;
    deleteArmed = false;
    $('btnPinDelete').textContent = 'Delete';
    $('btnPinDelete').hidden = !editing;
    $('editorTitle').textContent = editing ? 'Edit pin' : 'New pin';
    const typeId = editing ? editing.type : (data.types.some(t => t.id === data.last.type) ? data.last.type : data.types[0].id);
    const folderId = editing ? editing.folder : (data.folders.some(f => f.id === data.last.folder) ? data.last.folder : UNFILED);
    fillSelects(typeId, folderId);
    $('pinName').value = editing ? (editing.name || '') : '';
    $('pinNote').value = editing ? (editing.note || '') : '';
    $('editorWrap').hidden = false;
    $('pinType').focus();
  }
  function closeEditor() { $('editorWrap').hidden = true; editing = null; editPoint = null; }
  $('pinFolder').addEventListener('change', e => {
    const isNew = e.target.value === '__new';
    $('newFolderField').hidden = !isNew;
    if (isNew) $('pinNewFolder').focus();
  });
  $('pinNewFolder').addEventListener('input', () => $('pinNewFolder').setCustomValidity(''));
  $('pinForm').addEventListener('submit', e => {
    e.preventDefault();
    let folder = $('pinFolder').value;
    if (folder === '__new') {
      const name = $('pinNewFolder').value.trim();
      if (!name) { $('pinNewFolder').setCustomValidity('Type a name for the new folder.'); $('pinNewFolder').reportValidity(); return; }
      folder = addFolder(name).id;
    }
    const fields = { type: $('pinType').value, folder, name: $('pinName').value.trim(), note: $('pinNote').value.trim() };
    // Moving a pin into or out of a shared folder: leave a delete behind where it was.
    if (editing && editing.folder !== folder && (isShared(editing.folder) || isShared(folder))) tombPin(editing);
    if (editing) stampPin(Object.assign(editing, fields));
    else data.pins.push(stampPin(Object.assign({ id: uid('p'), lng: editPoint.lng, lat: editPoint.lat, created: new Date().toISOString() }, fields)));
    data.last = { type: fields.type, folder: fields.folder };
    const f = folderById(folder);
    if (f.visible === false) { f.visible = true; toast('Folder "' + f.name + '" was hidden, so it is shown again.'); }
    else toast(editing ? 'Pin saved' : 'Pin added to ' + f.name);
    changed(); closeEditor();
  });
  $('btnPinCancel').addEventListener('click', closeEditor);
  $('editorWrap').addEventListener('click', e => { if (e.target === $('editorWrap')) closeEditor(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('shareWrap').hidden) closeShare();
    else if (!$('editorWrap').hidden) closeEditor();
    else if (placing) { stopPlacing(); movingId = null; }
  });
  $('btnPinDelete').addEventListener('click', () => {
    if (!editing) return;
    if (!deleteArmed) { deleteArmed = true; $('btnPinDelete').textContent = 'Tap again to delete'; return; }
    tombPin(editing);
    data.pins = data.pins.filter(p => p !== editing);
    changed(); closeEditor(); toast('Pin deleted');
  });

  // ---- Folders (Pins tab) -----------------------------------------------------
  const collapsed = new Set();
  function addFolder(name) {
    const f = stamp({ id: uid('f'), name: name.slice(0, 40), visible: true });
    data.folders.push(f);
    return f;
  }
  function renderFolders() {
    $('pinCount').textContent = data.pins.length;
    $('folderList').innerHTML = data.folders.map(f => {
      const pins = data.pins.filter(p => p.folder === f.id);
      const open = !collapsed.has(f.id);
      const shared = isShared(f.id), meta = data.sharedMeta[f.id] || {};
      const id = esc(f.id);
      return '<div class="folder">' +
        '<div class="folder-head">' +
        '<input type="checkbox" data-fvis="' + id + '"' + (f.visible !== false ? ' checked' : '') + ' aria-label="Show ' + esc(f.name) + ' on the map">' +
        '<span class="name" data-fopen="' + id + '" role="button" tabindex="0" aria-expanded="' + open + '">' + (open ? '▾ ' : '▸ ') + esc(f.name) + '</span>' +
        (shared ? '<span class="chip-shared">Shared</span>' : '') +
        '<span class="num">' + pins.length + '</span>' +
        '</div>' +
        (open && shared ?
          '<p class="shared-line' + (meta.error ? ' warn' : '') + '">' +
          esc(meta.error || ((Object.keys(meta.members || {}).sort().join(', ') || 'Just you so far') + ' · ' + (meta.last ? 'updated ' + ago(meta.last) : 'not synced yet'))) + '</p>' +
          '<div class="folder-actions">' +
          '<button class="btn ghost" data-fsync="' + id + '">Refresh</button>' +
          '<button class="btn ghost" data-finvite="' + id + '">Invite</button>' +
          '<button class="btn ghost" data-fren="' + id + '">Rename</button>' +
          '<button class="btn ghost" data-fleave="' + id + '">Leave</button>' +
          '</div>'
        : open && f.id !== UNFILED ?
          '<div class="folder-actions">' +
          '<button class="btn ghost" data-fshare="' + id + '">Share</button>' +
          '<button class="btn ghost" data-fren="' + id + '">Rename</button>' +
          '<button class="btn ghost" data-fdel="' + id + '">Delete</button>' +
          '</div>' : '') +
        (open ? (pins.length
          ? '<ul class="pin-list">' + pins.map(p => {
              const t = typeById(p.type);
              return '<li data-pin="' + esc(p.id) + '"><span class="badge-dot" style="background:' + esc(t.color) + ';color:' + textColorFor(t.color) + '">' + esc((t.badge || '').toUpperCase()) + '</span>' +
                '<span class="t">' + esc(p.name || t.name) + '<small>' + esc(t.name) + (p.note ? ' · ' + esc(p.note.slice(0, 40)) : '') + '</small></span></li>';
            }).join('') + '</ul>'
          : '<p class="empty">No pins yet.</p>') : '') +
        '</div>';
    }).join('');
  }
  $('folderList').addEventListener('change', e => {
    const id = e.target.dataset.fvis;
    if (!id) return;
    folderById(id).visible = e.target.checked; // this device only, not synced
    save(); renderMap();
  });
  $('folderList').addEventListener('click', e => {
    const el = e.target.closest('[data-fopen],[data-fshare],[data-fsync],[data-finvite],[data-fleave],[data-fren],[data-fdel],[data-pin]');
    if (!el) return;
    if (el.dataset.fshare) {
      openShareChoice(folderById(el.dataset.fshare));
    } else if (el.dataset.fsync) {
      const id = el.dataset.fsync;
      el.textContent = 'Refreshing...';
      syncShared(id).then(() => { renderFolders(); const m = data.sharedMeta[id]; toast(m && m.error ? m.error : 'Up to date'); });
    } else if (el.dataset.finvite) {
      openInvite(folderById(el.dataset.finvite));
    } else if (el.dataset.fleave) {
      leaveShared(el.dataset.fleave);
    } else if (el.dataset.fopen) {
      const id = el.dataset.fopen;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      renderFolders();
    } else if (el.dataset.fren) {
      const f = folderById(el.dataset.fren);
      const name = window.prompt('Rename folder', f.name);
      if (name && name.trim()) { f.name = name.trim().slice(0, 40); stamp(f); changed(); }
    } else if (el.dataset.fdel) {
      const f = folderById(el.dataset.fdel);
      const n = data.pins.filter(p => p.folder === f.id).length;
      if (!window.confirm('Delete folder "' + f.name + '"?' + (n ? ' Its ' + n + ' pin(s) move to Unfiled.' : ''))) return;
      data.pins.forEach(p => { if (p.folder === f.id) { p.folder = UNFILED; stamp(p); } });
      tomb('f', f.id);
      data.folders = data.folders.filter(x => x !== f);
      changed();
    } else if (el.dataset.pin) {
      const p = pinById(el.dataset.pin);
      if (!p) return;
      const f = folderById(p.folder);
      if (f.visible === false) { f.visible = true; save(); renderAll(); }
      if (narrow()) setPanel(false);
      map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15) });
      map.once('moveend', () => showPinPopup(p));
    }
  });
  $('folderList').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.fopen) { e.preventDefault(); e.target.click(); }
  });
  $('formFolder').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('newFolderName').value.trim();
    if (!name) { $('newFolderName').focus(); return; }
    addFolder(name); $('newFolderName').value = '';
    changed(); toast('Folder added');
  });
  function setAllFolders(on) { data.folders.forEach(f => { f.visible = on; }); save(); renderAll(); }
  $('btnShowAll').addEventListener('click', () => setAllFolders(true));
  $('btnHideAll').addEventListener('click', () => setAllFolders(false));

  // ---- Pin types (Pin types tab) ----------------------------------------------
  function renderTypes() {
    $('typeList').innerHTML = data.types.map(t => {
      const uses = data.pins.filter(p => p.type === t.id).length;
      const lock = uses > 0 || data.types.length === 1;
      return '<div class="type-row" data-type="' + esc(t.id) + '">' +
        '<input type="color" data-k="color" value="' + esc(t.color) + '" aria-label="Color for ' + esc(t.name) + '">' +
        '<input type="text" class="badge" data-k="badge" maxlength="2" value="' + esc(t.badge || '') + '" aria-label="Badge for ' + esc(t.name) + '">' +
        '<input type="text" data-k="name" maxlength="30" value="' + esc(t.name) + '" aria-label="Name">' +
        '<span class="uses" title="Pins using this type">' + uses + '</span>' +
        '<button class="btn ghost" data-tdel' + (lock ? ' disabled title="' + (uses ? 'In use by ' + uses + ' pin(s)' : 'Keep at least one type') + '"' : '') + ' aria-label="Delete ' + esc(t.name) + '">Delete</button>' +
        '</div>';
    }).join('');
  }
  $('typeList').addEventListener('change', e => {
    const row = e.target.closest('[data-type]'), k = e.target.dataset.k;
    if (!row || !k) return;
    const t = typeById(row.dataset.type);
    const v = e.target.value.trim();
    if (k === 'name' && !v) { e.target.value = t.name; return; }
    t[k] = k === 'badge' ? v.toUpperCase().slice(0, 2) : v;
    stamp(t); refreshIcon(t); changed();
  });
  $('typeList').addEventListener('click', e => {
    if (!e.target.matches('[data-tdel]') || e.target.disabled) return;
    const id = e.target.closest('[data-type]').dataset.type;
    tomb('t', id);
    data.types = data.types.filter(t => t.id !== id);
    if (map.hasImage('pin-' + id)) map.removeImage('pin-' + id);
    changed();
  });
  $('formType').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('newTypeName').value.trim();
    if (!name) { $('newTypeName').focus(); return; }
    const t = stamp({ id: uid('t'), name: name.slice(0, 30), color: $('newTypeColor').value, badge: ($('newTypeBadge').value.trim() || name.slice(0, 2)).toUpperCase().slice(0, 2) });
    data.types.push(t);
    refreshIcon(t);
    $('newTypeName').value = ''; $('newTypeBadge').value = '';
    changed(); toast('Pin type added');
  });

  // ---- Sharing a folder -------------------------------------------------------
  // A share is one folder's pins (plus the pin types they use) packed into the link's
  // #share= part, which never leaves the browser. The folder and pins keep their ids, so
  // opening a newer share of the same folder updates the copy instead of duplicating it.
  const SHARE_APP = 'mhm-share';
  function toB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  const squeeze = (bytes, Stream) => new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer().then(b => new Uint8Array(b));
  // "z" = compressed, "j" = plain JSON for browsers without CompressionStream.
  async function packShare(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (window.CompressionStream) return 'z' + toB64url(await squeeze(bytes, CompressionStream));
    return 'j' + toB64url(bytes);
  }
  async function unpackShare(s) {
    let bytes = fromB64url(s.slice(1));
    if (s[0] === 'z') {
      if (!window.DecompressionStream) throw new Error('This browser is too old to open shared pins.');
      bytes = await squeeze(bytes, DecompressionStream);
    } else if (s[0] !== 'j') throw new Error('bad share');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function sharePayload(f) {
    const pins = data.pins.filter(p => p.folder === f.id);
    const used = new Set(pins.map(p => p.type));
    return {
      app: SHARE_APP, v: 1, at: now(),
      folder: { id: f.id, name: f.name, updatedAt: f.updatedAt || 0 },
      types: data.types.filter(t => used.has(t.id)).map(t => ({ id: t.id, name: t.name, color: t.color, badge: t.badge || '', updatedAt: t.updatedAt || 0 })),
      pins: pins.map(p => ({ id: p.id, lng: p.lng, lat: p.lat, type: p.type, name: p.name || '', note: p.note || '', created: p.created, updatedAt: p.updatedAt || 0 })),
    };
  }
  // Cleans up a share from a link or file; returns null if it isn't one.
  function readShare(s) {
    if (!s || s.app !== SHARE_APP || !s.folder || !Array.isArray(s.pins)) return null;
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    const folder = { id: str(s.folder.id, 40), name: str(s.folder.name, 40) || 'Shared pins', updatedAt: +s.folder.updatedAt || 0 };
    if (!folder.id || folder.id === UNFILED) return null;
    const types = (Array.isArray(s.types) ? s.types : []).filter(validType).map(t => ({ id: str(t.id, 40), name: str(t.name, 30), color: t.color, badge: str(t.badge, 2), updatedAt: +t.updatedAt || 0 }));
    const pins = s.pins.slice(0, 5000).filter(validPin).map(p => ({
      id: str(p.id, 40), lng: +p.lng, lat: +p.lat, type: str(p.type, 40), folder: folder.id, name: str(p.name, 60), note: str(p.note, 1000),
      created: p.created ? str(p.created, 30) : undefined, updatedAt: +p.updatedAt || 0,
    })).filter(p => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
    return { folder, types, pins, at: +s.at || 0 };
  }
  function addShare(sh) {
    const tombs = data.deleted;
    // Adding a share on purpose brings back a folder or type this device deleted earlier.
    const revive = (kind, x) => (tombs[kind + ':' + x.id] >= x.updatedAt ? Object.assign({}, x, { updatedAt: now() }) : x);
    const types = sh.types.filter(t => !data.types.some(x => x.id === t.id)).map(t => revive('t', t));
    mergeInto(data, { types, folders: [revive('f', sh.folder)], pins: sh.pins, deleted: {} });
    // Pins left in Unfiled when this folder was deleted here go back into it.
    sh.pins.forEach(p => { const cur = pinById(p.id); if (cur && cur.folder === UNFILED) { cur.folder = sh.folder.id; stamp(cur); } });
    data.types.forEach(t => { if (!map.hasImage('pin-' + t.id)) refreshIcon(t); });
    folderById(sh.folder.id).visible = true;
    collapsed.delete(sh.folder.id);
    changed();
    if (sh.pins.length) {
      const b = new maplibregl.LngLatBounds();
      sh.pins.forEach(p => b.extend([p.lng, p.lat]));
      map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
    }
  }

  function openShareModal(title, text, warn, buttons) {
    $('shareTitle').textContent = title;
    $('shareText').textContent = text;
    $('shareWarn').textContent = warn || '';
    const row = $('shareBtns');
    row.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'btn' + (b.primary ? ' primary' : ''); el.textContent = b.label;
      el.addEventListener('click', () => b.run(el));
      row.appendChild(el);
    });
    $('shareWrap').hidden = false;
    row.querySelector('.primary') ? row.querySelector('.primary').focus() : row.firstChild.focus();
  }
  function closeShare() { $('shareWrap').hidden = true; }
  $('shareWrap').addEventListener('click', e => { if (e.target === $('shareWrap')) closeShare(); });

  async function openShareOut(f) {
    const payloadOut = sharePayload(f);
    const n = payloadOut.pins.length;
    if (!n) { toast('"' + f.name + '" has no pins to share yet.'); return; }
    let url;
    try { url = location.origin + location.pathname + '#share=' + await packShare(payloadOut); }
    catch (e) { console.error(e); toast('Could not make a share link in this browser. Use "Save as file" instead.'); }
    const label = n + ' pin' + (n === 1 ? '' : 's');
    const buttons = [];
    if (url && navigator.share) buttons.push({ label: 'Send link', primary: true, run: () => {
      navigator.share({ title: f.name + ' (hunting pins)', text: 'Hunting pins: ' + f.name + ' (' + label + '). Open the link to add them to your map.', url })
        .then(closeShare, err => { if (err && err.name !== 'AbortError') toast('Could not open sharing. Use Copy link.'); });
    } });
    if (url) buttons.push({ label: 'Copy link', primary: !navigator.share, run: el => copyText(url).then(ok => {
      if (!ok) { toast('Could not copy the link.'); return; }
      el.textContent = 'Copied'; toast('Link copied. Paste it in a text or email.');
    }) });
    buttons.push({ label: 'Save as file', run: () => {
      const blob = new Blob([JSON.stringify(payloadOut)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pins-' + f.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Saved. They open it with Import pins on the Pins tab.');
    } });
    buttons.push({ label: 'Close', run: closeShare });
    openShareModal('Share "' + f.name + '"',
      'Sends a link with this folder\'s ' + label + ': locations, types, names and notes. Whoever opens it can add the folder to their own map. Share again later and their copy updates instead of doubling up.',
      'Anyone who has the link can see these pins, so only send it to people you trust.' + (url && url.length > 30000 ? ' This folder makes a very long link; if it gets cut off, use Save as file.' : ''),
      buttons);
  }

  function offerShare(sh) {
    const f = folderById(sh.folder.id), have = f && f.id === sh.folder.id;
    let added = 0, updated = 0;
    sh.pins.forEach(p => {
      const cur = pinById(p.id);
      if (!cur) { if (!(data.deleted['p:' + p.id] >= p.updatedAt)) added++; }
      else if (p.updatedAt > (cur.updatedAt || 0)) updated++;
    });
    const n = sh.pins.length, label = n + ' pin' + (n === 1 ? '' : 's');
    const when = sh.at ? ' Shared ' + new Date(sh.at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + '.' : '';
    let text;
    if (!have) text = 'Someone shared a folder of ' + label + ' with you.' + when + ' Add it to your map as the folder "' + sh.folder.name + '"?';
    else if (added || updated) text = 'This is a newer copy of your "' + f.name + '" folder.' + when + ' Adding it brings in ' +
      [added ? added + ' new' : '', updated ? updated + ' updated' : ''].filter(Boolean).join(' and ') + ' pin' + (added + updated === 1 ? '' : 's') + '. Pins you changed since keep your changes.';
    else text = 'You already have everything in this "' + f.name + '" share.' + when;
    if (narrow()) setPanel(false);
    const buttons = (!have || added || updated)
      ? [{ label: have ? 'Update my copy' : 'Add to my map', primary: true, run: () => {
          addShare(sh); closeShare();
          toast(have ? 'Updated "' + folderById(sh.folder.id).name + '"' : 'Added "' + sh.folder.name + '" with ' + label + '.' + (syncReady() ? ' It will sync to your other devices.' : ''));
        } }, { label: 'No thanks', run: closeShare }]
      : [{ label: 'Show them', primary: true, run: () => { addShare(sh); closeShare(); } }, { label: 'Close', run: closeShare }];
    openShareModal(have ? 'Shared pins: ' + f.name : 'Shared pins: ' + sh.folder.name, text, '', buttons);
  }

  // A link like ...#share=z... (or #sync=owner/repo to start sync setup) opened on this device.
  async function checkLink() {
    const m = location.hash.match(/^#(share|sync|join)=(.+)$/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (m[1] === 'join') { joinFromLink(decodeURIComponent(m[2])); return; }
    if (m[1] === 'sync') {
      const repo = decodeURIComponent(m[2]).trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return;
      setPanel(true); window.MHM.showTab('pins');
      editingSync = true; fillSyncForm(); $('syncRepo').value = repo; setSyncStatus();
      $('syncToken').focus();
      toast('Paste your GitHub key and tap Save and sync.');
      return;
    }
    let sh = null;
    try { sh = readShare(await unpackShare(m[2])); } catch (e) { console.error(e); }
    if (sh) offerShare(sh); else toast('That share link is broken or cut off. Ask for it again, or for the file.');
  }
  window.addEventListener('hashchange', checkLink);

  // ---- Backup file ------------------------------------------------------------
  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Object.assign(payload(), { exported: new Date().toISOString() }), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hunting-pins-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Exported ' + data.pins.length + ' pins');
  });
  $('importFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let inc;
      try { inc = JSON.parse(reader.result); } catch (err) { toast('That file is not a pin backup.'); return; }
      const sh = readShare(inc);
      if (sh) { offerShare(sh); return; } // a shared folder saved as a file
      if (!inc || !Array.isArray(inc.pins)) { toast('That file is not a pin backup.'); return; }
      const before = data.pins.length;
      mergeInto(data, inc);
      changed();
      toast('Imported. You now have ' + data.pins.length + ' pins (' + Math.max(0, data.pins.length - before) + ' new).');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---- GitHub sync --------------------------------------------------------------
  // Settings stay in this browser only. The key is a fine-grained GitHub token limited
  // to one private repo with Contents read/write.
  const SYNC_KEY = 'mhm.sync.v1';
  const FILE = 'pins.json';
  const cfg = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } })();
  function saveCfg() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } }
  const syncReady = () => !!(cfg.repo && cfg.token);
  let syncing = false, syncAgain = false, syncTimer = null, editingSync = false;

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // Live shared folders sit next to everyone's own pins repo, owned by the same account:
  // bradlans/ben-hunting-pins -> bradlans/shared-pins, one file per folder.
  const sharedRepo = () => cfg.repo.split('/')[0] + '/shared-pins';
  const sharedFile = id => 'folders/' + id + '.json';

  function gh(repo, path, opts) {
    return fetch('https://api.github.com/repos/' + repo + path, Object.assign({ cache: 'no-store' }, opts, {
      headers: Object.assign({
        Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28',
      }, (opts && opts.headers) || {}),
    }));
  }
  class SyncError extends Error { constructor(msg) { super(msg); this.friendly = true; } }
  async function explain(res, repo) {
    if (res.status === 401) return new SyncError('GitHub did not accept the key. It may have expired; make a new one and enter it again.');
    if (res.status === 403) return new SyncError('The key cannot write to ' + repo + '. Give it "Contents: Read and write" on that repo.');
    if (res.status === 404) return new SyncError('Repo ' + repo + ' was not found, or the key does not include it.');
    return new SyncError('GitHub answered ' + res.status + '. Try again in a minute.');
  }
  // Returns {sha, json}, or null when the repo is there but the file isn't yet.
  async function pullFile(repo, file) {
    const res = await gh(repo, '/contents/' + file);
    if (res.status === 404) {
      const r = await gh(repo, '');
      if (!r.ok) throw await explain(r, repo);
      return null;
    }
    if (!res.ok) throw await explain(res, repo);
    const j = await res.json();
    return { sha: j.sha, json: JSON.parse(b64decode(j.content || '')) };
  }
  // Returns false when someone else saved first (pull again and retry).
  async function pushFile(repo, file, obj, sha, message) {
    const res = await gh(repo, '/contents/' + file, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64encode(JSON.stringify(obj, null, 1)), sha: sha || undefined }),
    });
    if (res.status === 409 || res.status === 422) return false;
    if (!res.ok) throw await explain(res, repo);
    return true;
  }
  // Pull, merge, and save back only if something changed; retried if two saves collide.
  async function syncFile(repo, file, merge, out, same, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await pullFile(repo, file);
      if (merge(remote) === false) return;
      const o = out();
      if (remote && same(remote.json, o)) return;
      if (await pushFile(repo, file, o, remote && remote.sha, message())) return;
    }
    throw new SyncError('Someone else kept saving at the same moment. Try again.');
  }
  const canonical = o => JSON.stringify({ types: o.types, folders: o.folders, pins: o.pins, deleted: o.deleted, joined: o.joined || [], me: o.me || null });

  // This person's pins.json covers everything except shared folders, which are left alone.
  function mergePersonal(inc) {
    const shared = new Set(data.joined.map(j => j.id));
    const mine = x => !shared.has(x);
    const view = { types: data.types, folders: data.folders.filter(f => mine(f.id)), pins: data.pins.filter(p => mine(p.folder)), deleted: data.deleted, joined: data.joined, me: data.me };
    mergeInto(view, Object.assign({}, inc, { folders: (inc.folders || []).filter(f => f && mine(f.id)), pins: (inc.pins || []).filter(p => p && mine(p.folder)) }));
    data.types = view.types; data.deleted = view.deleted; data.joined = view.joined; data.me = view.me;
    data.folders = view.folders.concat(data.folders.filter(f => !mine(f.id)));
    data.pins = view.pins.concat(data.pins.filter(p => !mine(p.folder)));
    reconcileJoined();
  }
  // Match folders on this device to the joined list (joined or left on another device).
  function reconcileJoined() {
    const ids = new Set(data.joined.map(j => j.id));
    data.joined.forEach(j => {
      if (!data.folders.some(f => f.id === j.id)) data.folders.push({ id: j.id, name: j.name || 'Shared folder', visible: true, updatedAt: 0 });
      if (!data.sharedMeta[j.id]) data.sharedMeta[j.id] = { deleted: {}, members: {} };
    });
    Object.keys(data.sharedMeta).forEach(id => {
      if (ids.has(id)) return;
      data.folders = data.folders.filter(f => f.id !== id);
      data.pins = data.pins.filter(p => p.folder !== id);
      delete data.sharedMeta[id];
    });
    dedupe();
  }

  async function sync(manual) {
    if (!syncReady()) { if (manual) toast('Set up GitHub sync first.'); return; }
    if (syncing) { syncAgain = true; return; }
    if (!navigator.onLine) { setSyncStatus('Offline. Pins will sync when you have signal.', 'warn'); return; }
    syncing = true; clearTimeout(syncTimer);
    setSyncStatus('Syncing...');
    try {
      await syncFile(cfg.repo, FILE,
        remote => { if (remote) { mergePersonal(remote.json); save(); renderAll(); } },
        payload, (a, b) => canonical(a) === canonical(b),
        () => 'Sync pins (' + data.pins.filter(p => !isShared(p.folder)).length + ')');
      cfg.last = now(); cfg.error = ''; saveCfg();
      setSyncStatus();
      for (const j of data.joined.slice()) await syncShared(j.id);
      if (manual) toast('Synced: ' + data.pins.length + ' pins');
    } catch (err) {
      const msg = err.friendly ? err.message : (navigator.onLine ? 'Could not reach GitHub. Try again in a minute.' : 'Offline. Pins will sync when you have signal.');
      cfg.error = msg; saveCfg();
      setSyncStatus(msg, 'warn');
      if (manual) toast(msg);
      if (!err.friendly) console.error(err);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(1000); }
    }
  }
  function scheduleSync(delay) {
    if (!syncReady()) return;
    clearTimeout(syncTimer);
    setSyncStatus('Changes waiting to sync...');
    syncTimer = setTimeout(() => sync(false), delay || 8000);
  }
  function ago(ts) {
    const m = Math.round((now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 48 ? h + ' hr ago' : new Date(ts).toLocaleDateString();
  }
  function setSyncStatus(msg, kind) {
    const el = $('syncStatus');
    $('syncOn').hidden = !syncReady(); $('syncForm').hidden = syncReady() && !editingSync;
    if (!syncReady()) return;
    el.className = 'small' + (kind === 'warn' ? ' warn' : '');
    el.textContent = msg || (cfg.error ? cfg.error : cfg.last ? 'Synced ' + ago(cfg.last) + ' with ' + cfg.repo + '.' : 'Not synced yet.');
  }
  function fillSyncForm() {
    const owner = /\.github\.io$/i.test(location.hostname) ? location.hostname.split('.')[0] : '';
    $('syncRepo').value = cfg.repo || (owner ? owner + '/hunting-pins' : '');
    $('syncToken').value = '';
    $('syncToken').placeholder = cfg.token ? 'Saved key ending ' + cfg.token.slice(-4) + ' (leave blank to keep)' : 'github_pat_...';
    $('btnSyncForget').hidden = !cfg.token;
  }
  $('syncForm').addEventListener('submit', e => {
    e.preventDefault();
    const repo = $('syncRepo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '');
    const token = $('syncToken').value.trim() || cfg.token || '';
    $('syncError').textContent = '';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { $('syncError').textContent = 'Enter the repo as owner/name, e.g. yourname/hunting-pins.'; $('syncRepo').focus(); return; }
    if (!token) { $('syncError').textContent = 'Paste the GitHub key you made for this repo.'; $('syncToken').focus(); return; }
    cfg.repo = repo; cfg.token = token; cfg.last = 0; cfg.error = '';
    saveCfg(); editingSync = false; fillSyncForm(); setSyncStatus();
    sync(true);
  });
  $('btnSyncNow').addEventListener('click', () => sync(true));
  $('btnSyncSetup').addEventListener('click', () => { editingSync = true; fillSyncForm(); setSyncStatus(); $('syncRepo').focus(); });
  $('btnSyncForget').addEventListener('click', () => {
    if (!window.confirm('Remove the GitHub key from this device? Pins stay here; they just stop syncing.')) return;
    delete cfg.token; cfg.last = 0; cfg.error = ''; saveCfg(); editingSync = false; fillSyncForm(); setSyncStatus();
    toast('Key removed from this device');
  });
  // Sync when the app opens, comes back to the front, or gets signal again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && syncReady() && now() - (cfg.last || 0) > 60000) sync(false);
  });
  window.addEventListener('online', () => { if (syncReady()) sync(false); });
  setInterval(() => { if (syncReady() && !syncing) setSyncStatus(); }, 30000);

  // ---- Live shared folders ---------------------------------------------------------
  // One shared folder = one file, folders/<id>.json in the shared repo, holding the folder's
  // name, pins, deletes and who has joined. Everyone in it merges with that file the same
  // way their own pins.json is merged: on open, on Refresh, and shortly after a change.
  const SHARED_APP = 'mhm-shared-folder';
  const sortKeys = o => Object.keys(o || {}).sort().map(k => [k, o[k]]);
  const pinRow = p => [p.id, p.lng, p.lat, p.type, p.name || '', p.note || '', p.created || '', p.by || '', p.updatedAt || 0];
  const canonShared = o => JSON.stringify([o.folder ? [o.folder.name, o.folder.updatedAt || 0] : null, (o.pins || []).map(pinRow).sort(), sortKeys(o.deleted), sortKeys(o.members)]);

  function sharedPayload(id) {
    const f = data.folders.find(x => x.id === id), meta = data.sharedMeta[id];
    const pins = data.pins.filter(p => p.folder === id);
    const used = new Set(pins.map(p => p.type));
    return {
      app: SHARED_APP, v: 1,
      folder: { id, name: f.name, updatedAt: f.updatedAt || 0 },
      types: data.types.filter(t => used.has(t.id)).map(t => ({ id: t.id, name: t.name, color: t.color, badge: t.badge || '' })),
      pins: pins.map(p => ({ id: p.id, lng: p.lng, lat: p.lat, type: p.type, name: p.name || '', note: p.note || '', created: p.created, by: p.by || '', updatedAt: p.updatedAt || 0 })),
      deleted: meta.deleted, members: meta.members,
    };
  }
  function mergeShared(id, s) {
    if (!s || s.app !== SHARED_APP) return;
    const meta = data.sharedMeta[id], local = data.folders.find(f => f.id === id);
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    // Pin types someone else uses are added; your own types are never changed.
    (Array.isArray(s.types) ? s.types : []).filter(validType).forEach(t => {
      if (data.types.some(x => x.id === t.id)) return;
      const nt = { id: str(t.id, 40), name: str(t.name, 30), color: t.color, badge: str(t.badge, 2), updatedAt: 0 };
      data.types.push(nt); refreshIcon(nt);
    });
    const view = { types: data.types, folders: [local], pins: data.pins.filter(p => p.folder === id), deleted: meta.deleted };
    mergeInto(view, {
      types: [],
      folders: s.folder && s.folder.name ? [{ id, name: str(s.folder.name, 40), updatedAt: +s.folder.updatedAt || 0 }] : [],
      pins: (Array.isArray(s.pins) ? s.pins : []).filter(validPin).map(p => ({
        id: str(p.id, 40), lng: +p.lng, lat: +p.lat, type: str(p.type, 40), folder: id, name: str(p.name, 60), note: str(p.note, 1000),
        created: p.created ? str(p.created, 30) : undefined, by: str(p.by, 30), updatedAt: +p.updatedAt || 0,
      })),
      deleted: s.deleted && typeof s.deleted === 'object' ? s.deleted : {},
    });
    const mf = view.folders.find(x => x.id === id);
    if (mf) { local.name = mf.name; local.updatedAt = mf.updatedAt; }
    data.pins = data.pins.filter(p => p.folder !== id).concat(view.pins.filter(p => p.folder === id));
    meta.deleted = view.deleted;
    Object.keys(s.members || {}).forEach(n => { const t = +s.members[n] || 0; if (n && !(meta.members[n] >= t)) meta.members[str(n, 30)] = t; });
    dedupe();
  }
  async function syncShared(id, strict) {
    const meta = data.sharedMeta[id];
    if (!meta || !syncReady()) return;
    if (!navigator.onLine) { meta.error = 'Offline. Changes sync when you have signal.'; renderFolders(); return; }
    if (myName() && !meta.members[myName()]) meta.members[myName()] = now();
    let gone = false;
    try {
      await syncFile(sharedRepo(), sharedFile(id),
        remote => {
          if (remote) { mergeShared(id, remote.json); return; }
          if (!meta.pending) { gone = true; return false; } // file removed on GitHub
        },
        () => sharedPayload(id), (a, b) => canonShared(a) === canonShared(b),
        () => 'Update ' + data.folders.find(f => f.id === id).name + (myName() ? ' (' + myName() + ')' : ''));
      if (gone) { folderGone(id); return; }
      meta.pending = false; meta.last = now(); meta.error = '';
    } catch (err) {
      meta.error = err.friendly ? err.message : 'Could not reach GitHub. Try again in a minute.';
      if (!err.friendly) console.error(err);
      if (strict) throw err;
    } finally {
      save(); renderFolders(); renderMap();
    }
  }
  function folderGone(id) {
    const f = data.folders.find(x => x.id === id);
    tomb('j', id);
    data.joined = data.joined.filter(j => j.id !== id);
    delete data.sharedMeta[id];
    changed();
    toast('"' + (f ? f.name : 'A shared folder') + '" is no longer shared. Your copy was kept as a private folder.');
  }
  function askName() {
    if (myName()) return true;
    const n = window.prompt('Your first name? It shows the others who added or changed a pin in a shared folder.', '');
    if (!n || !n.trim()) return false;
    data.me = { name: n.trim().slice(0, 30), updatedAt: now() };
    save();
    return true;
  }

  function openShareChoice(f) {
    openShareModal('Share "' + f.name + '"',
      'Share live: the people you invite can see, add and edit this folder\'s pins, and everyone stays in step. Send a copy: they get the pins as they are right now.',
      '', [
        { label: 'Share live', primary: true, run: () => { closeShare(); shareLive(f); } },
        { label: 'Send a copy', run: () => { closeShare(); openShareOut(f); } },
        { label: 'Close', run: closeShare },
      ]);
  }
  async function shareLive(f) {
    if (!syncReady()) { toast('Set up GitHub sync first (Pins tab), then share live.'); return; }
    if (!askName()) return;
    data.joined.push({ id: f.id, name: f.name, updatedAt: now() });
    data.sharedMeta[f.id] = { deleted: {}, members: { [myName()]: now() }, pending: true };
    data.pins.forEach(p => { if (p.folder === f.id && !p.by) p.by = myName(); });
    save(); renderAll();
    toast('Sharing "' + f.name + '"...');
    try {
      await syncShared(f.id, true);
    } catch (err) {
      data.joined = data.joined.filter(j => j.id !== f.id);
      delete data.sharedMeta[f.id];
      save(); renderAll();
      toast((err.friendly ? err.message : 'Could not reach GitHub.') + ' The folder was not shared.');
      return;
    }
    scheduleSync(1000); // pins.json now lists the folder instead of holding its pins
    openInvite(f);
  }
  function openInvite(f) {
    const url = location.origin + location.pathname + '#join=' + f.id;
    const buttons = [];
    if (navigator.share) buttons.push({ label: 'Send link', primary: true, run: () => {
      navigator.share({ title: f.name + ' (shared hunting pins)', text: 'Join my shared hunting pins folder "' + f.name + '":', url })
        .then(closeShare, err => { if (err && err.name !== 'AbortError') toast('Could not open sharing. Use Copy link.'); });
    } });
    buttons.push({ label: 'Copy link', primary: !navigator.share, run: el => copyText(url).then(ok => {
      if (!ok) { toast('Could not copy the link.'); return; }
      el.textContent = 'Copied'; toast('Invite link copied.');
    }) });
    buttons.push({ label: 'Close', run: closeShare });
    openShareModal('Invite to "' + f.name + '"',
      'Send this link to the people you want in this folder. When they open it they can join, and then add, edit and delete its pins. Changes show up for everyone when the map opens or they tap Refresh.',
      'Their GitHub key needs access to ' + sharedRepo() + '.', buttons);
  }
  async function joinFromLink(id) {
    if (!/^[\w-]{1,40}$/.test(id)) { toast('That invite link is broken. Ask for it again.'); return; }
    if (!syncReady()) {
      setPanel(true); window.MHM.showTab('pins');
      toast('Set up GitHub sync first, then open the invite link again.');
      return;
    }
    if (isShared(id)) { toast('You are already in this folder. Refreshing it.'); syncShared(id); return; }
    let remote;
    try { remote = await pullFile(sharedRepo(), sharedFile(id)); }
    catch (err) { toast(err.friendly ? err.message + ' Ask to have shared-pins added to your key.' : 'Could not reach GitHub. Try the link again in a minute.'); return; }
    if (!remote || !remote.json || remote.json.app !== SHARED_APP) { toast('That shared folder is not there anymore.'); return; }
    const s = remote.json, name = String((s.folder && s.folder.name) || 'Shared folder').slice(0, 40);
    const n = Array.isArray(s.pins) ? s.pins.length : 0, who = Object.keys(s.members || {}).sort().join(', ');
    if (narrow()) setPanel(false);
    openShareModal('Join "' + name + '"?',
      (who ? 'Shared by ' + who + '. ' : '') + n + ' pin' + (n === 1 ? '' : 's') + '. Everyone in it can add, edit and delete its pins, and changes show up for everyone when they refresh.',
      '', [
        { label: 'Join', primary: true, run: () => {
          if (!askName()) return;
          data.joined.push({ id, name, updatedAt: now() });
          data.sharedMeta[id] = { deleted: {}, members: { [myName()]: now() } };
          reconcileJoined();
          const f = data.folders.find(x => x.id === id);
          f.visible = true; collapsed.delete(id);
          mergeShared(id, s);
          closeShare(); changed(); scheduleSync(1000);
          const pins = data.pins.filter(p => p.folder === id);
          if (pins.length) {
            const b = new maplibregl.LngLatBounds();
            pins.forEach(p => b.extend([p.lng, p.lat]));
            map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
          }
          toast('Joined "' + f.name + '"');
        } },
        { label: 'No thanks', run: closeShare },
      ]);
  }
  function leaveShared(id) {
    const f = data.folders.find(x => x.id === id);
    if (!window.confirm('Leave "' + f.name + '"? It comes off your map. Everyone else keeps it.')) return;
    tomb('j', id);
    data.joined = data.joined.filter(j => j.id !== id);
    data.folders = data.folders.filter(x => x.id !== id);
    data.pins = data.pins.filter(p => p.folder !== id);
    delete data.sharedMeta[id];
    changed();
    toast('Left "' + f.name + '"');
  }

  function renderAll() { renderFolders(); renderTypes(); renderMap(); }
  fillSyncForm(); setSyncStatus();
  renderAll();
  if (syncReady()) sync(false);
  checkLink();
  if (!storageOk) toast('This browser is not saving pins (private mode or storage blocked).');
  else if (!localStorage.getItem('mhm.pinTip')) {
    try { localStorage.setItem('mhm.pinTip', '1'); } catch (e) { /* ignore */ }
    setTimeout(() => toast(matchMedia('(pointer: coarse)').matches ? 'Tip: press and hold the map to drop a pin.' : 'Tip: double-click the map to drop a pin.'), 2500);
  }

  // For tests and the console.
  window.MHM.pins = { data, mergeInto, payload, sync, syncShared, openEditor, parseCoords, showPinPopup, sharePayload, packShare, unpackShare, readShare };
})();
