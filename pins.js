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

  // ---- Merging (sync and import) ------------------------------------------------
  const validType = t => t && t.id && t.name && /^#[0-9a-f]{6}$/i.test(t.color || '');
  const validFolder = f => f && f.id && f.name;
  const validPin = p => p && p.id && isFinite(p.lng) && isFinite(p.lat);
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
    const cutoff = now() - 180 * 864e5; // forget deletes after six months
    Object.keys(tombs).forEach(k => { if (tombs[k] < cutoff) delete tombs[k]; });
    target.deleted = tombs;
    tidy(target);
  }
  // What goes to GitHub (and to an exported backup).
  function payload() {
    return {
      app: 'michigan-hunting-map', version: 2,
      types: data.types.map(t => ({ id: t.id, name: t.name, color: t.color, badge: t.badge || '', updatedAt: t.updatedAt || 0 })),
      folders: data.folders.map(f => ({ id: f.id, name: f.name, updatedAt: f.updatedAt || 0 })),
      pins: data.pins.map(p => ({ id: p.id, lng: p.lng, lat: p.lat, type: p.type, folder: p.folder, name: p.name || '', note: p.note || '', created: p.created, updatedAt: p.updatedAt || 0 })),
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
  map.once('load', initMap);

  // ---- Coordinates: copy and paste -----------------------------------------------
  const fmt = (lat, lng) => lat.toFixed(6) + ', ' + lng.toFixed(6);
  function copyCoords(lat, lng, btn) {
    const text = fmt(lat, lng);
    const done = () => {
      toast('Copied ' + text);
      if (btn) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy GPS'; }, 1500); }
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else toast('Could not copy. Coordinates: ' + text);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
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
      '<dl><dt>Folder</dt><dd>' + esc(f.name) + '</dd>' +
      (when ? '<dt>Added</dt><dd>' + esc(when) + '</dd>' : '') +
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
      if (p) { p.lng = ll.lng; p.lat = ll.lat; stamp(p); changed(); toast('Pin moved'); }
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
    if (placing || !$('editorWrap').hidden) return;
    dropAt(e.lngLat.lng, e.lngLat.lat);
  });
  const box = map.getCanvasContainer();
  const touchPoint = t => { const r = box.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; };
  function cancelPress() { clearTimeout(pressTimer); pressTimer = null; }
  box.addEventListener('touchstart', ev => {
    cancelPress();
    if (ev.touches.length !== 1 || placing || !$('editorWrap').hidden) return;
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
    if (editing) stamp(Object.assign(editing, fields));
    else data.pins.push(stamp(Object.assign({ id: uid('p'), lng: editPoint.lng, lat: editPoint.lat, created: new Date().toISOString() }, fields)));
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
    if (!$('editorWrap').hidden) closeEditor();
    else if (placing) { stopPlacing(); movingId = null; }
  });
  $('btnPinDelete').addEventListener('click', () => {
    if (!editing) return;
    if (!deleteArmed) { deleteArmed = true; $('btnPinDelete').textContent = 'Tap again to delete'; return; }
    tomb('p', editing.id);
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
      return '<div class="folder">' +
        '<div class="folder-head">' +
        '<input type="checkbox" data-fvis="' + esc(f.id) + '"' + (f.visible !== false ? ' checked' : '') + ' aria-label="Show ' + esc(f.name) + ' on the map">' +
        '<span class="name" data-fopen="' + esc(f.id) + '" role="button" tabindex="0" aria-expanded="' + open + '">' + (open ? '▾ ' : '▸ ') + esc(f.name) + '</span>' +
        '<span class="num">' + pins.length + '</span>' +
        (f.id === UNFILED ? '' :
          '<button class="btn ghost" data-fren="' + esc(f.id) + '">Rename</button>' +
          '<button class="btn ghost" data-fdel="' + esc(f.id) + '">Delete</button>') +
        '</div>' +
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
    const el = e.target.closest('[data-fopen],[data-fren],[data-fdel],[data-pin]');
    if (!el) return;
    if (el.dataset.fopen) {
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
  function gh(path, opts) {
    return fetch('https://api.github.com/repos/' + cfg.repo + path, Object.assign({ cache: 'no-store' }, opts, {
      headers: Object.assign({
        Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28',
      }, (opts && opts.headers) || {}),
    }));
  }
  class SyncError extends Error { constructor(msg) { super(msg); this.friendly = true; } }
  async function explain(res) {
    if (res.status === 401) return new SyncError('GitHub did not accept the key. It may have expired; make a new one and enter it again.');
    if (res.status === 403) return new SyncError('The key cannot write to ' + cfg.repo + '. Give it "Contents: Read and write" on that repo.');
    if (res.status === 404) return new SyncError('Repo ' + cfg.repo + ' was not found, or the key does not include it.');
    return new SyncError('GitHub answered ' + res.status + '. Try again in a minute.');
  }
  async function pull() {
    const res = await gh('/contents/' + FILE);
    if (res.status === 404) {
      const repo = await gh('');
      if (!repo.ok) throw await explain(repo);
      return null; // repo is there, file isn't yet
    }
    if (!res.ok) throw await explain(res);
    const j = await res.json();
    return { sha: j.sha, json: JSON.parse(b64decode(j.content || '')) };
  }
  async function push(text, sha) {
    const res = await gh('/contents/' + FILE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Sync pins (' + data.pins.length + ')', content: b64encode(text), sha: sha || undefined }),
    });
    if (res.status === 409 || res.status === 422) return false; // someone else synced first; pull again
    if (!res.ok) throw await explain(res);
    return true;
  }
  const canonical = o => JSON.stringify({ types: o.types, folders: o.folders, pins: o.pins, deleted: o.deleted });

  async function sync(manual) {
    if (!syncReady()) { if (manual) toast('Set up GitHub sync first.'); return; }
    if (syncing) { syncAgain = true; return; }
    if (!navigator.onLine) { setSyncStatus('Offline. Pins will sync when you have signal.', 'warn'); return; }
    syncing = true; clearTimeout(syncTimer);
    setSyncStatus('Syncing...');
    try {
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        const remote = await pull();
        if (remote) { mergeInto(data, remote.json); save(); renderAll(); }
        const out = payload();
        done = remote && canonical(remote.json) === canonical(out) ? true : await push(JSON.stringify(out, null, 1), remote && remote.sha);
      }
      if (!done) throw new SyncError('Another device kept syncing at the same moment. Try again.');
      cfg.last = now(); cfg.error = ''; saveCfg();
      setSyncStatus();
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

  function renderAll() { renderFolders(); renderTypes(); renderMap(); }
  fillSyncForm(); setSyncStatus();
  renderAll();
  if (syncReady()) sync(false);
  if (!storageOk) toast('This browser is not saving pins (private mode or storage blocked).');
  else if (!localStorage.getItem('mhm.pinTip')) {
    try { localStorage.setItem('mhm.pinTip', '1'); } catch (e) { /* ignore */ }
    setTimeout(() => toast(matchMedia('(pointer: coarse)').matches ? 'Tip: press and hold the map to drop a pin.' : 'Tip: double-click the map to drop a pin.'), 2500);
  }

  // For tests and the console.
  window.MHM.pins = { data, mergeInto, payload, sync, parseCoords, showPinPopup };
})();
