// Michigan Hunting Map - Tree types (a bonus, off by default).
// This file is only downloaded when "Tree types" is switched on under Layers > Extras, and
// switching it off removes everything it added. Nothing here is made up: it shows two
// published sources as they are.
//  - State forest stands: Michigan DNR forest inventory (MiFI). Each stand was mapped and
//    typed by DNR foresters: cover type, origin year, tree size, planted or natural, plus
//    the DNR's completed and planned treatments (cuts). State forest land only.
//  - All land: USDA Forest Service FIA "BIGMAP" forest type groups, 2018, a 30 m model
//    built from FIA ground plots and satellite images. Coarser, and older than the DNR data.
// Colors are this map's own (one color per broad forest group, the same for both sources);
// popups show each source's own names.

(function () {
  'use strict';
  const { map, esc, $ } = window.MHM;

  const DNR = 'https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/Michigan_DNR_Public_Forest_Inventory_Data/FeatureServer';
  const BIGMAP = 'https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_FIA_BIGMAP_CONUS_ForestTypeGroup_2018/ImageServer';
  const KEY = 'mhm.trees.v1';
  const STAND_ZOOM = 12, TILE = 0.025, MAX_STANDS = 20000;

  // Broad groups, for color only.
  const G = {
    aspen: ['Aspen / birch', '#f2e85c'], nh: ['Maple / northern hardwood', '#e07b39'], oak: ['Oak', '#9c4a1a'],
    hw: ['Other upland hardwood', '#d9b26f'], mix: ['Mixed upland', '#a8a060'], pine: ['Pine', '#2e9e3e'],
    con: ['Spruce / fir / hemlock', '#1f6b5a'], lcon: ['Cedar / lowland conifer', '#3d7fa8'], lhw: ['Lowland hardwood', '#8a6fb3'],
  };
  // DNR cover type group (first digits of the code, as the DNR's own map groups them) -> color group.
  const DNR_G = { 413: 'aspen', 411: 'nh', 412: 'oak', 414: 'hw', 419: 'hw', 430: 'mix', 421: 'pine', 422: 'pine', 424: 'pine',
    423: 'con', 429: 'con', 612: 'lcon', 611: 'lhw', 613: 'lhw' };
  const dnrGroup = c => { const s = String(c || ''); return s.startsWith('43') ? '430' : s === '510' ? '500' : s.slice(0, 3); };
  // FIA forest type group codes (FIA database code list), with the names BIGMAP's legend uses.
  const FIA = { 100: 'White / red / jack pine', 120: 'Spruce / fir', 140: 'Longleaf / slash pine', 160: 'Loblolly / shortleaf pine',
    170: 'Other eastern softwoods', 180: 'Pinyon / juniper', 200: 'Douglas-fir', 220: 'Ponderosa pine', 240: 'Western white pine',
    260: 'Fir / spruce / mountain hemlock', 280: 'Lodgepole pine', 300: 'Hemlock / Sitka spruce', 320: 'Western larch', 340: 'Redwood',
    360: 'Other western softwoods', 370: 'California mixed conifer', 380: 'Exotic softwoods', 400: 'Oak / pine', 500: 'Oak / hickory',
    600: 'Oak / gum / cypress', 700: 'Elm / ash / cottonwood', 800: 'Maple / beech / birch', 900: 'Aspen / birch', 910: 'Alder / maple',
    920: 'Western oak', 940: 'Tanoak / laurel', 960: 'Other hardwoods', 970: 'Woodland hardwoods', 980: 'Tropical hardwoods',
    990: 'Exotic hardwoods', 999: 'Nonstocked' };
  const FIA_G = { 100: 'pine', 380: 'pine', 120: 'lcon', 170: 'con', 400: 'mix', 500: 'oak', 700: 'lhw', 800: 'nh', 900: 'aspen', 960: 'hw' };

  let ui = load(), live = false, meta = null, offError = null, timer = null, pending = 0;
  const stands = new Map(), loaded = new Set();
  function load() { try { return Object.assign({ stands: true, model: true, opacity: 45 }, JSON.parse(localStorage.getItem(KEY))); } catch (e) { return { stands: true, model: true, opacity: 45 }; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(load(), { stands: ui.stands, model: ui.model, opacity: ui.opacity }))); } catch (e) { /* storage blocked */ } }
  const enc = encodeURIComponent;
  async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error('answered ' + r.status); return r.json(); }

  // ---- DNR names (read from the DNR layer's own code lists) --------------------------
  async function loadMeta() {
    if (meta) return meta;
    const j = await getJson(DNR + '/3?f=json');
    const dom = {};
    (j.fields || []).forEach(f => { if (f.domain && f.domain.codedValues) { dom[f.name] = {}; f.domain.codedValues.forEach(v => { dom[f.name][v.code] = v.name; }); } });
    const groups = {};
    ((j.drawingInfo && j.drawingInfo.renderer && j.drawingInfo.renderer.uniqueValueInfos) || []).forEach(u => {
      const m = String(u.label || '').match(/^(\d+)\s*-\s*(.+)$/); if (m) groups[m[1]] = m[2].trim();
    });
    meta = { dom, groups };
    return meta;
  }
  const dn = (field, v) => (meta && meta.dom[field] && meta.dom[field][v] != null ? meta.dom[field][v] : '');

  // ---- State forest stands, loaded for the view ---------------------------------------
  function tilesFor(b) {
    const out = [];
    for (let x = Math.floor(b.getWest() / TILE); x <= Math.floor(b.getEast() / TILE); x++)
      for (let y = Math.floor(b.getSouth() / TILE); y <= Math.floor(b.getNorth() / TILE); y++) out.push([x, y]);
    return out;
  }
  async function fetchTile(tx, ty) {
    const env = [tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE].join(',');
    for (let offset = 0, guard = 0; guard < 10; guard++, offset += 2000) {
      const gj = await getJson(DNR + '/3/query?where=1%3D1&geometry=' + env + '&geometryType=esriGeometryEnvelope&inSR=4326' +
        '&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,L4Covertype&outSR=4326&geometryPrecision=6&maxAllowableOffset=0.00002' +
        '&resultRecordCount=2000&resultOffset=' + offset + '&f=geojson');
      (gj.features || []).forEach(f => {
        if (!f.geometry) return;
        const id = f.id != null ? f.id : f.properties.OBJECTID;
        const g = DNR_G[dnrGroup(f.properties.L4Covertype)];
        f.properties = { oid: id, g: g || '' };
        stands.delete(id); stands.set(id, f);
      });
      if (!(gj.exceededTransferLimit || (gj.properties && gj.properties.exceededTransferLimit))) break;
    }
  }
  function pushStands() {
    while (stands.size > MAX_STANDS) stands.delete(stands.keys().next().value);
    const src = map.getSource('tree-stands');
    if (src) src.setData({ type: 'FeatureCollection', features: Array.from(stands.values()) });
  }
  async function loadView() {
    if (!live) return;
    status();
    if (!ui.stands || map.getZoom() < STAND_ZOOM) return;
    const jobs = [];
    tilesFor(map.getBounds()).forEach(([tx, ty]) => {
      const k = tx + ',' + ty;
      if (loaded.has(k)) return;
      loaded.add(k);
      jobs.push(fetchTile(tx, ty).catch(err => { loaded.delete(k); console.warn('Stands:', err.message); }));
    });
    if (!jobs.length) return;
    pending += jobs.length; status();
    await Promise.all(jobs);
    pending -= jobs.length;
    if (live) { pushStands(); status(); }
  }
  const scheduleLoad = () => { clearTimeout(timer); timer = setTimeout(loadView, 350); };

  // ---- Map layers ---------------------------------------------------------------------
  const colorMatch = () => ['match', ['get', 'g']].concat(...Object.keys(G).map(k => [k, G[k][1]]), ['rgba(0,0,0,0)']);
  // Server-side colors for BIGMAP: only forest types get a color, the rest is see-through.
  // (No 8-bit output setting here: the codes go up to 999 and would be cut off.)
  const RULE = JSON.stringify({ rasterFunction: 'Colormap', rasterFunctionArguments: {
    Colormap: Object.keys(FIA_G).map(Number).map(v => [v].concat(G[FIA_G[v]][1].slice(1).match(/../g).map(h => parseInt(h, 16)))) } });
  function removeLayers() {
    ['tree-stands-line', 'tree-stands-fill', 'tree-model'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    ['tree-stands', 'tree-model'].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
  }
  function firstLayer(ids) { const l = map.getStyle().layers.find(x => ids.indexOf(x.id) >= 0); return l && l.id; }
  function addLayers() {
    if (!live) return;
    removeLayers();
    const op = ui.opacity / 100;
    if (ui.model) {
      map.addSource('tree-model', { type: 'raster', tileSize: 512, minzoom: 8, maxzoom: 15, attribution: 'Forest types: USDA Forest Service FIA BIGMAP 2018',
        tiles: [BIGMAP + '/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&renderingRule=' + enc(RULE) + '&f=image'] });
      // Just above the base map, under everything else.
      const above = map.getStyle().layers.find(l => !/^base-/.test(l.id) && l.type !== 'background');
      map.addLayer({ id: 'tree-model', type: 'raster', source: 'tree-model', minzoom: 8,
        paint: { 'raster-opacity': op, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, above && above.id);
    }
    if (ui.stands) {
      map.addSource('tree-stands', { type: 'geojson', data: { type: 'FeatureCollection', features: Array.from(stands.values()) },
        attribution: 'Forest stands: Michigan DNR' });
      // Over the public land fill (stands are on state land), under HAP, CF, parcels and pins.
      const before = firstLayer(['cf-fill', 'parcels-hit', 'hap-inactive', 'hap-fill', 'wind']);
      map.addLayer({ id: 'tree-stands-fill', type: 'fill', source: 'tree-stands', minzoom: STAND_ZOOM,
        paint: { 'fill-color': colorMatch(), 'fill-opacity': Math.min(1, op + 0.1) } }, before);
      map.addLayer({ id: 'tree-stands-line', type: 'line', source: 'tree-stands', minzoom: STAND_ZOOM,
        paint: { 'line-color': 'rgba(20,20,20,.6)', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1.4] } }, before);
    }
  }
  function setOpacity() {
    const op = ui.opacity / 100;
    if (map.getLayer('tree-model')) map.setPaintProperty('tree-model', 'raster-opacity', op);
    if (map.getLayer('tree-stands-fill')) map.setPaintProperty('tree-stands-fill', 'fill-opacity', Math.min(1, op + 0.1));
  }
  function onError(e) { if (e && e.sourceId === 'tree-model') status('The Forest Service map is not answering right now.'); }

  // ---- Panel --------------------------------------------------------------------------
  const box = $('treeBox');
  function status(msg) {
    const s = $('treeStatus'); if (!s) return;
    s.textContent = msg || (!ui.stands ? '' : map.getZoom() < STAND_ZOOM ? 'Zoom in closer to see state forest stands. Tap a stand for its details.'
      : pending ? 'Loading state forest stands...' : 'Tap a stand for its type, age and cutting history.');
  }
  function buildBox() {
    box.innerHTML =
      '<label class="row"><input type="checkbox" id="treeStandsChk"' + (ui.stands ? ' checked' : '') + '><span class="lbl">State forest stands <small>(DNR foresters)</small></span></label>' +
      '<label class="row"><input type="checkbox" id="treeModelChk"' + (ui.model ? ' checked' : '') + '><span class="lbl">All land, 2018 model <small>(US Forest Service)</small></span></label>' +
      '<div class="slider" style="padding:0"><span>Fill</span><input type="range" id="treeOpacity" min="20" max="90" value="' + ui.opacity + '" aria-label="Tree type fill opacity"><span id="treeOpacityVal">' + ui.opacity + '%</span></div>' +
      '<div class="crop-legend" aria-hidden="true">' + Object.keys(G).map(k => '<span><i style="background:' + G[k][1] + '"></i>' + esc(G[k][0]) + '</span>').join('') + '</div>' +
      '<p class="small" id="treeStatus"></p>';
    $('treeStandsChk').addEventListener('change', e => { ui.stands = e.target.checked; save(); addLayers(); loadView(); status(); });
    $('treeModelChk').addEventListener('change', e => { ui.model = e.target.checked; save(); addLayers(); });
    $('treeOpacity').addEventListener('input', e => { ui.opacity = +e.target.value; $('treeOpacityVal').textContent = ui.opacity + '%'; save(); setOpacity(); });
    box.hidden = false; status();
  }

  // ---- Tap: stand details, or the Forest Service type ------------------------------------
  const yr = t => (t ? new Date(t).getFullYear() : '');
  const mon = t => (t ? new Date(t).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '');
  const tname = s => String(s || '').replace(/^[\d.]+[-_]/, '').trim(); // "72234009-Cut" -> "Cut"
  function standHtml(a, done, plan) {
    const now = new Date().getFullYear();
    const group = meta && meta.groups[dnrGroup(a.L4Covertype)];
    const type = dn('CoverType', a.CoverType) || group || 'Stand';
    const age = a.FirstOriginYear > 1700 && a.FirstOriginYear <= now ? a.FirstOriginYear + ' (about ' + (now - a.FirstOriginYear) + ' years old)' : '';
    const bits = [dn('OverallSize', a.OverallSize), dn('PlantedNatural', a.PlantedNatural), dn('UpLow', a.UpLow)].filter(x => x && x !== 'Unspecified');
    const canopy = dn('CanopyClosure', a.CanopyClosure), ba = dn('BARange', a.BARange);
    const note = [a.GeneralComments, a.ManagementNotes].filter(Boolean).join(' ').trim();
    return '<h4>' + esc(type) + '</h4>' +
      '<div class="tag"><i style="background:' + ((G[DNR_G[dnrGroup(a.L4Covertype)]] || [0, '#999'])[1]) + '"></i>DNR state forest stand' + (group && group !== type ? ' · ' + esc(group) : '') + '</div>' +
      '<dl>' +
      (age ? '<dt>Started</dt><dd>' + age + '</dd>' : '') +
      (bits.length ? '<dt>Trees</dt><dd>' + esc(bits.join(', ')) + '</dd>' : '') +
      (canopy && canopy !== 'Unspecified' ? '<dt>Canopy</dt><dd>' + esc(canopy) + '% closed</dd>' : '') +
      (ba && ba !== 'Unspecified' ? '<dt>Basal area</dt><dd>' + esc(ba) + (/\d/.test(ba) ? ' sq ft/acre' : '') + '</dd>' : '') +
      (a.ACRES ? '<dt>Size</dt><dd>' + Math.round(a.ACRES) + ' acres</dd>' : '') +
      (done ? '<dt>Last work</dt><dd>' + esc(tname(done.TreatmentName)) + (mon(done.DateTreatmentClosed || done.ApprovalStatusChangeDate) ? ', closed out ' + mon(done.DateTreatmentClosed || done.ApprovalStatusChangeDate) : '') + '</dd>' : '') +
      (plan ? '<dt>Current plan</dt><dd>' + esc(tname(plan.TreatmentName)) + (plan.ProposalStatusShortDesc ? ' (' + esc(String(plan.ProposalStatusShortDesc).toLowerCase()) + ')' : '') +
        (yr(plan.ProposedStartDate) > 1950 ? ', from ' + yr(plan.ProposedStartDate) : '') + '</dd>' : '') +
      (a.Date ? '<dt>Surveyed</dt><dd>' + mon(a.Date) + '</dd>' : '') +
      '</dl>' + (note ? '<div class="hint">DNR note: ' + esc(note.length > 260 ? note.slice(0, 257) + '...' : note) + '</div>' : '');
  }
  function standPop(el, oid, ll) {
    const pt = '&geometry=' + ll.lng + ',' + ll.lat + '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&f=json';
    Promise.all([
      loadMeta().catch(() => null),
      getJson(DNR + '/3/query?objectIds=' + oid + '&outFields=CoverType,L4Covertype,ACRES,FirstOriginYear,OverallSize,PlantedNatural,UpLow,CanopyClosure,BARange,Date,GeneralComments,ManagementNotes&returnGeometry=false&f=json'),
      getJson(DNR + '/2/query?where=ApprovalStatus%3D11&outFields=TreatmentName,DateTreatmentClosed,ApprovalStatusChangeDate&orderByFields=' + enc('DateTreatmentClosed DESC') + '&resultRecordCount=1' + pt).catch(() => null),
      getJson(DNR + '/0/query?where=1%3D1&outFields=TreatmentName,ProposalStatusShortDesc,ProposedStartDate&resultRecordCount=1' + pt).catch(() => null),
    ]).then(([, s, d, p]) => {
      const a = s.features && s.features[0] && s.features[0].attributes;
      if (!a) throw new Error('no stand');
      el.innerHTML = standHtml(a, d && d.features && d.features[0] && d.features[0].attributes, p && p.features && p.features[0] && p.features[0].attributes);
    }).catch(() => { el.innerHTML = '<h4>State forest stand</h4><div class="hint">Could not reach the DNR forest inventory.</div>'; });
  }
  function modelPop(el, ll) {
    getJson(BIGMAP + '/identify?geometry=' + enc(JSON.stringify({ x: ll.lng, y: ll.lat, spatialReference: { wkid: 4326 } })) +
      '&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json').then(j => {
      const v = parseInt(j.value, 10), g = G[FIA_G[v]];
      el.innerHTML = '<h4>Forest type</h4>' +
        (FIA[v] ? '<div class="tag"><i style="background:' + (g ? g[1] : '#999') + '"></i>' + esc(FIA[v]) + '</div>' : '<div class="hint">Not mapped as forest here.</div>') +
        '<div class="hint">US Forest Service model from 2018 at 30 m (FIA BIGMAP). Good for the main type of a large block of woods; ' +
        'misses recent cuts and small patches, and often calls oak stands maple / beech / birch.</div>';
    }).catch(() => { el.innerHTML = '<h4>Forest type</h4><div class="hint">Could not reach the Forest Service map.</div>'; });
  }
  function treePop(lngLat, point) {
    const el = document.createElement('div');
    el.className = 'pop crop-pop';
    const hit = ui.stands && point && map.getLayer('tree-stands-fill') && map.queryRenderedFeatures(point, { layers: ['tree-stands-fill'] })[0];
    if (hit) { el.innerHTML = '<h4>State forest stand</h4><div class="hint">Looking up the stand...</div>'; standPop(el, hit.properties.oid, lngLat); return el; }
    if (!ui.model) return null;
    el.innerHTML = '<h4>Forest type</h4><div class="hint">Looking it up...</div>';
    modelPop(el, lngLat);
    return el;
  }

  // ---- On / off -----------------------------------------------------------------------
  function on() {
    if (live) return;
    live = true;
    window.MHM.treePop = treePop;
    buildBox();
    loadMeta().catch(() => { /* names are looked up again on tap */ });
    offError = onError; map.on('error', offError);
    map.on('moveend', scheduleLoad);
    window.MHM.onLoad(() => { addLayers(); loadView(); });
  }
  function off() {
    live = false;
    window.MHM.treePop = null;
    clearTimeout(timer);
    map.off('moveend', scheduleLoad);
    if (offError) { map.off('error', offError); offError = null; }
    removeLayers(); stands.clear(); loaded.clear();
    box.hidden = true; box.innerHTML = '';
  }

  window.MHM.trees = { on, off, stands: () => stands.size };
  if ($('chkTrees').checked) on();
})();
