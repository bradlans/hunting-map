// Michigan Hunting Map - MapLibre app.
// Base maps and contours come from USGS / Esri tile services, public land from
// data/public_land.js (PAD-US 4.1 Fee), wind live from NWS surface observations.

(function () {
  'use strict';
  // The ?v= tag index.html gave this file; files loaded later get the same one, so a phone never mixes old and new.
  const VER = (document.currentScript && document.currentScript.src.split('?')[1]) || '';

  // ---- Public land categories (PAD-US Mang_Name codes) -----------------------
  const GROUPS = [
    // Michigan and West Virginia land share these. WV DNR land is split by its PAD-US
    // designation (build_wv_land.ps1): conservation areas = WMAs, parks, resource areas = forests.
    { id: 'state', name: 'State land (DNR)', cats: [
      { c: 'SDNR', name: 'State forest',                 color: '#86C66C', note: 'Generally open to hunting' },
      { c: 'SFW',  name: 'State game / wildlife area',   color: '#A392DE', note: 'Open to hunting - main hunting lands (WV: WMAs)' },
      { c: 'SPR',  name: 'State park / recreation area', color: '#9BAADE', note: 'Some areas open in season - check park' },
      { c: 'SDOL', name: 'State Dept. of Land',          color: '#558191', note: 'Small parcels - check access' },
      { c: 'OTHS', name: 'Other state land',             color: '#A0A0A0', note: 'e.g. Pinckney Rec Area - check' },
    ]},
    { id: 'fed', name: 'Federal', cats: [
      { c: 'USFS', name: 'National forest',              color: '#89BD2A', note: 'Generally open to hunting' },
      { c: 'FWS',  name: 'National wildlife refuge',     color: '#AD5764', note: 'Limited / permit hunts only' },
      { c: 'NPS',  name: 'National park / lakeshore',    color: '#70A170', note: 'Mostly closed - some allow hunting (WV: New River Gorge preserve)' },
      { c: 'BLM',  name: 'Bureau of Land Management',    color: '#F2DC91', note: 'Generally open' },
      { c: 'USACE',name: 'Army Corps of Engineers lake', color: '#C9A227', note: 'Often open - many are WMAs; check the lake' },
      { c: 'JNT',  name: 'Joint state / federal',        color: '#B58BD6', note: 'Mostly WMAs on Corps or federal land - check' },
      { c: 'DOD',  name: 'Military (Dept. of Defense)',  color: '#6E4A2A', note: 'Restricted - no access without permission', warn: true },
      { c: 'OTHF', name: 'Other federal (Camp Grayling)',color: '#815132', note: 'Military - restricted', warn: true },
    ]},
    { id: 'local', name: 'Local & other', cats: [
      { c: 'CNTY', name: 'County land / county forest',  color: '#4CC7C5', note: 'Varies - often closed' },
      { c: 'CITY', name: 'City land / metropark',        color: '#BBC458', note: 'Usually closed' },
      { c: 'REG',  name: 'Regional agency (metroparks)', color: '#FF4208', note: 'Usually closed' },
      { c: 'UNKL', name: 'Other local government',       color: '#DBD554', note: 'Usually closed' },
      { c: 'NGO',  name: 'Conservancy / nonprofit',      color: '#E64747', note: 'Varies - check owner' },
      { c: 'PVT',  name: 'Private (clubs, corridors)',   color: '#E68D45', note: 'NO access without permission', warn: true },
      { c: 'UNK',  name: 'Unknown manager',              color: '#398C67', note: 'Check access' },
    ]},
  ];
  const CATS = {};
  GROUPS.forEach(g => g.cats.forEach(c => { CATS[c.c] = Object.assign({ group: g.id }, c); }));
  const ALL_CODES = Object.keys(CATS);
  const HUNTING_CODES = ['SDNR', 'SFW', 'SPR', 'USFS', 'BLM', 'USACE', 'JNT'];
  const ACCESS = { OA: 'Open access', RA: 'Restricted access', XA: 'Closed to public', UK: 'Unknown' };

  // ---- Saved settings (per device) -------------------------------------------
  const KEY = 'mhm.v1';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  const state = {
    base: saved.base || 'hybrid',
    contours: saved.contours !== undefined ? saved.contours : true,
    wind: saved.wind !== undefined ? saved.wind : true,
    opacity: saved.opacity || 45,
    // catsV 3: everyone starts again with every category on (once, for the new West Virginia
    // categories); after that their choices stick.
    cats: Array.isArray(saved.cats) && saved.catsV === 3 ? saved.cats.filter(c => CATS[c]) : ALL_CODES.slice(),
    catsV: 3,
    view: saved.view || { center: [-85.4, 44.6], zoom: 6.3 },
  };
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage off: settings just won't stick */ } }

  // ---- Map ---------------------------------------------------------------------
  const WMS_CONTOURS = 'https://carto.nationalmap.gov/arcgis/services/contours/MapServer/WMSServer?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap' +
    '&LAYERS=2,3,4,6,7,8,10,11,12,14,15,16,18,19,20,21,23,24,25,26,34,35&STYLES=&SRS=EPSG:3857&FORMAT=image/png&TRANSPARENT=TRUE' +
    '&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}';
  const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/';
  const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

  const map = new maplibregl.Map({
    container: 'map',
    center: state.view.center,
    zoom: state.view.zoom,
    maxPitch: 60,
    attributionControl: { compact: true },
    style: {
      version: 8,
      glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
      sources: {
        hybrid: { type: 'raster', tiles: [USGS + 'USGSImageryTopo/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: USGS_ATTR },
        sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19,
          attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' },
        topo: { type: 'raster', tiles: [USGS + 'USGSTopo/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: USGS_ATTR },
        contours: { type: 'raster', tiles: [WMS_CONTOURS], tileSize: 256, minzoom: 11, attribution: 'Contours: USGS' },
        land: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Public land: USGS PAD-US 4.1' },
        wind: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Wind: NOAA/NWS' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#dfe3da' } },
        { id: 'base-hybrid', type: 'raster', source: 'hybrid', layout: { visibility: 'none' } },
        { id: 'base-sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
        { id: 'base-topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
        { id: 'contours', type: 'raster', source: 'contours', minzoom: 11, layout: { visibility: 'none' } },
        { id: 'land-fill', type: 'fill', source: 'land',
          paint: { 'fill-color': colorExpr(), 'fill-opacity': state.opacity / 100 } },
        { id: 'land-line', type: 'line', source: 'land', minzoom: 10,
          paint: { 'line-color': colorExpr(), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 2], 'line-opacity': 0.9 } },
        { id: 'wind', type: 'symbol', source: 'wind',
          layout: {
            'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.55, 9, 0.8, 12, 1],
            'icon-allow-overlap': true, 'icon-ignore-placement': true,
            'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 12,
            'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-optional': true,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4 } },
      ],
    },
  });

  // The other scripts can finish downloading after the map's one 'load' event (slow phone
  // signal), so they add their layers through onLoad, which runs at once if it already fired.
  let mapLoaded = false;
  map.once('load', () => { mapLoaded = true; });
  const onLoad = fn => (mapLoaded ? fn() : map.once('load', fn));

  function colorExpr() {
    const e = ['match', ['get', 'c']];
    ALL_CODES.forEach(c => e.push(c, CATS[c].color));
    e.push('#888888');
    return e;
  }

  // Keep the canvas matched to its box (embedded views and phone rotation don't always fire window resize).
  if (window.ResizeObserver) new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  const geo = new maplibregl.GeolocateControl({
    // Direction is drawn by compass.js (a view cone that also works standing still).
    positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: false,
  });
  map.addControl(geo, 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

  // ---- Wind arrow icons -------------------------------------------------------
  const WIND_CLASSES = { light: '#7fd67f', moderate: '#ffd73c', strong: '#ff8c2a', high: '#e63030' };
  function arrowImage(fill) {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.beginPath();
    [[32, 3], [57, 31], [41, 31], [41, 61], [23, 61], [23, 31], [7, 31]].forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.closePath(); g.fillStyle = fill; g.fill(); g.lineWidth = 4; g.strokeStyle = '#1b1b1b'; g.lineJoin = 'round'; g.stroke();
    return g.getImageData(0, 0, s, s);
  }
  function calmImage() {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.fillStyle = '#d6d6d6'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#1b1b1b'; g.stroke();
    return g.getImageData(0, 0, s, s);
  }

  // ---- Wind data --------------------------------------------------------------
  // One station query per state the map has shown (Michigan always).
  const WIND_BOX = { mi: '-90.8,41.4,-81.8,48.6', wv: '-83.2,36.9,-77.3,40.9' };
  const windUrl = box => 'https://mapservices.weather.noaa.gov/vector/rest/services/obs/surface_obs/MapServer/260/query' +
    '?where=1%3D1&geometry=' + box + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects' +
    '&outFields=stationname,timeobs,winddir,windspeed,windgust,temperature&outSR=4326&f=geojson';
  let windRegions = '';
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const KT_TO_MPH = 1.15078;
  let windFeatures = [], windFetchedAt = null, windTimer = null, userPos = null;

  async function loadWind(manual) {
    const ageEl = document.getElementById('windAge');
    if (manual) ageEl.textContent = 'updating...';
    try {
      const ids = REGIONS.filter(r => r.start || r.state).map(r => r.id);
      windRegions = ids.join(',');
      const all = await Promise.all(ids.map(async id => {
        const res = await fetch(windUrl(WIND_BOX[id]), { cache: 'no-store' });
        if (!res.ok) throw new Error('NWS answered ' + res.status);
        return (await res.json()).features || [];
      }));
      const gj = { features: [].concat.apply([], all) };
      windFeatures = (gj.features || []).filter(f => f.geometry && f.properties && f.properties.windspeed != null).map(f => {
        const p = f.properties;
        const mph = Math.round(p.windspeed * KT_TO_MPH);
        const gust = p.windgust ? Math.round(p.windgust * KT_TO_MPH) : null;
        const calm = mph < 2 || p.winddir == null;
        const from = calm ? 'Calm' : COMPASS[Math.round(p.winddir / 22.5) % 16];
        const cls = calm ? 'calm' : mph < 8 ? 'light' : mph < 15 ? 'moderate' : mph < 25 ? 'strong' : 'high';
        return {
          type: 'Feature', geometry: f.geometry,
          properties: {
            st: p.stationname, t: p.timeobs, dir: p.winddir, mph, gust, from, temp: p.temperature,
            icon: 'wind-' + cls, rot: calm ? 0 : (p.winddir + 180) % 360,
            label: calm ? 'Calm' : from + ' ' + mph + (gust ? ' g' + gust : ''),
          },
        };
      });
      map.getSource('wind').setData({ type: 'FeatureCollection', features: windFeatures });
      windFetchedAt = new Date();
      if (manual) toast('Wind updated: ' + windFeatures.length + ' stations');
    } catch (err) {
      toast('Could not load wind. Check your connection and tap Wind to retry.');
      console.error(err);
    }
    showWindAge(); showNearestWind();
  }
  function showWindAge() {
    const el = document.getElementById('windAge'), stamp = document.getElementById('windStamp');
    if (!windFetchedAt) { el.textContent = 'not loaded'; stamp.textContent = ''; return; }
    const mins = Math.round((Date.now() - windFetchedAt) / 60000);
    el.textContent = mins < 1 ? 'just now' : mins + ' min ago';
    const newest = windFeatures.reduce((m, f) => Math.max(m, f.properties.t || 0), 0);
    stamp.textContent = newest ? 'readings to ' + new Date(newest).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }
  function milesBetween(a, b) {
    const R = 3958.8, toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function nearestWind(pt) {
    let best = null, bestD = Infinity;
    windFeatures.forEach(f => { const d = milesBetween(pt, f.geometry.coordinates); if (d < bestD) { bestD = d; best = f; } });
    return best ? { f: best, miles: bestD } : null;
  }
  function showNearestWind() {
    const el = document.getElementById('nearWind');
    const pt = userPos || map.getCenter().toArray();
    const n = nearestWind(pt);
    if (!n) { el.textContent = ''; return; }
    const p = n.f.properties;
    el.textContent = 'Nearest to ' + (userPos ? 'you' : 'map center') + ': ' + p.st + ', ' + Math.round(n.miles) + ' mi away - ' +
      (p.from === 'Calm' ? 'calm' : 'from ' + p.from + ' at ' + p.mph + ' mph' + (p.gust ? ', gusts ' + p.gust : '')) + '.';
  }

  // ---- Public land: loaded after the map so the map shows right away ---------
  // A plain <script> (not fetch) so the page also works opened from disk.
  // Michigan loads at start; West Virginia (data/public_land_wv.js) only once the map shows WV.
  const REGIONS = [
    { id: 'mi', name: 'Michigan', file: 'data/public_land.js', global: 'PUBLIC_LAND', bbox: [-90.42, 41.69, -82.12, 48.31], start: true },
    { id: 'wv', name: 'West Virginia', file: 'data/public_land_wv.js', global: 'PUBLIC_LAND_WV', bbox: [-82.65, 37.2, -77.71, 40.64] },
  ];
  let landIndex = [], landLoaded = false;
  const landFeatures = [];
  const viewBox = () => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; };
  const boxesOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  function loadRegion(r) {
    if (r.state) return;
    r.state = 'loading';
    toast('Loading ' + r.name + ' public land...');
    const s = document.createElement('script');
    s.src = r.file + (r.start || !VER ? '' : '?' + VER);
    s.onload = () => onLoad(() => {
      const gj = window[r.global];
      r.state = 'done';
      gj.features.forEach(f => landFeatures.push(f));
      map.getSource('land').setData({ type: 'FeatureCollection', features: landFeatures });
      gj.features.forEach(f => {
        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        f.geometry.coordinates.forEach(poly => poly[0].forEach(([x, y]) => {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }));
        landIndex.push({ f, bb: [minX, minY, maxX, maxY] });
      });
      delete window[r.global]; // the map and landIndex hold it now
      landLoaded = REGIONS.every(x => x.state !== 'loading');
      $('toast').hidden = true;
    });
    s.onerror = () => { r.state = null; s.remove(); toast(r.name + ' public land did not load. Check your connection.'); };
    document.body.appendChild(s);
  }
  function loadLand() {
    const view = viewBox();
    REGIONS.forEach(r => { if (r.start || boxesOverlap(r.bbox, view)) loadRegion(r); });
  }
  // Which states the map is showing (wind stations are asked for these).
  const regionsInView = () => { const v = viewBox(); return REGIONS.filter(r => boxesOverlap(r.bbox, v)); };
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function landAt(lng, lat) {
    const hits = [];
    landIndex.forEach(({ f, bb }) => {
      if (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]) return;
      const hit = f.geometry.coordinates.some(poly => inRing(lng, lat, poly[0]) && !poly.slice(1).some(h => inRing(lng, lat, h)));
      if (hit) hits.push(f.properties);
    });
    return hits.sort((a, b) => (a.ac || 0) - (b.ac || 0));
  }

  // ---- Popups -------------------------------------------------------------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function landHtml(hits) {
    if (!landLoaded) return '<div class="pop"><h4>Public land still loading</h4><div class="hint">Try again in a few seconds.</div></div>';
    if (!hits.length) {
      return '<div class="pop"><h4>No public land mapped here</h4><div class="hint">Likely private. PAD-US may miss small parcels and Commercial Forest land; check before you hunt.</div></div>';
    }
    const p = hits[0], cat = CATS[p.c] || { name: p.c, color: '#888', note: '' };
    const hidden = state.cats.indexOf(p.c) < 0 ? ' (hidden in Layers)' : '';
    return '<div class="pop"><h4>' + esc(p.n || cat.name) + '</h4>' +
      '<div class="tag"><i style="background:' + cat.color + '"></i>' + esc(cat.name) + esc(hidden) + '</div>' +
      '<dl>' +
      '<dt>Owner</dt><dd>' + esc(p.o || 'Unknown') + '</dd>' +
      '<dt>Access</dt><dd class="access-' + esc(p.a) + '">' + esc(ACCESS[p.a] || p.a || 'Unknown') + '</dd>' +
      (p.t ? '<dt>Type</dt><dd>' + esc(p.t) + '</dd>' : '') +
      (p.ac ? '<dt>Size</dt><dd>' + Number(p.ac).toLocaleString() + ' acres</dd>' : '') +
      '</dl><div class="hint">' + esc(cat.note) + (hits.length > 1 ? ' · ' + (hits.length - 1) + ' overlapping area(s)' : '') + '</div></div>';
  }
  function windHtml(p) {
    const when = p.t ? new Date(p.t) : null;
    const mins = when ? Math.round((Date.now() - when) / 60000) : null;
    return '<div class="pop"><h4>' + esc(p.st) + '</h4><dl>' +
      '<dt>From</dt><dd>' + esc(p.from) + (p.from !== 'Calm' && p.dir != null ? ' (' + Math.round(p.dir) + '&deg;)' : '') + '</dd>' +
      '<dt>Speed</dt><dd>' + p.mph + ' mph' + (p.gust ? ', gusts ' + p.gust : '') + '</dd>' +
      (p.temp != null ? '<dt>Temp</dt><dd>' + Math.round(p.temp) + '&deg;F</dd>' : '') +
      (when ? '<dt>Observed</dt><dd>' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' (' + mins + ' min ago)</dd>' : '') +
      '</dl><div class="hint">Arrow points downwind, the way scent drifts.</div></div>';
  }
  let popup = null;
  // content: an HTML string, or a DOM node when the popup has buttons wired up.
  function openPopup(lngLat, content, opts) {
    if (popup) popup.remove();
    popup = new maplibregl.Popup(Object.assign({ maxWidth: '300px', focusAfterOpen: false }, opts)).setLngLat(lngLat);
    if (typeof content === 'string') popup.setHTML(content); else popup.setDOMContent(content);
    popup.addTo(map);
  }
  function closePopup() { if (popup) { popup.remove(); popup = null; } }

  // ---- UI wiring --------------------------------------------------------------
  const $ = id => document.getElementById(id);
  function setBase(b) {
    state.base = b;
    ['hybrid', 'sat', 'topo'].forEach(k => {
      if (map.getLayer('base-' + k)) map.setLayoutProperty('base-' + k, 'visibility', k === b ? 'visible' : 'none');
      $('base-' + k).setAttribute('aria-pressed', String(k === b));
    });
    save();
  }
  function setVis(layer, on) { if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none'); }
  // DNR programs on private land (hap.js, cf.js keep their own on/off); shown in the State group.
  const PROGRAMS = ['chkHap', 'chkCf'];
  const programsOn = () => PROGRAMS.filter(id => $(id).checked).length;
  function setPrograms(on) {
    PROGRAMS.forEach(id => { const b = $(id); if (b.checked !== on) { b.checked = on; b.dispatchEvent(new Event('change')); } });
  }
  function applyCats() {
    const f = ['in', ['get', 'c'], ['literal', state.cats]];
    if (map.getLayer('land-fill')) { map.setFilter('land-fill', f); map.setFilter('land-line', f); }
    const tick = (box, on, all) => { box.checked = on === all; box.indeterminate = on > 0 && on < all; };
    GROUPS.forEach(g => {
      // HAP and Commercial Forest sit inside the State group and count with it.
      const extra = g.id === 'state' ? PROGRAMS.length : 0;
      const on = g.cats.filter(c => state.cats.indexOf(c.c) >= 0).length + (extra ? programsOn() : 0);
      const all = g.cats.length + extra;
      tick($('grp-' + g.id), on, all);
      // Collapsed groups say how many of their layers are showing.
      $('cnt-' + g.id).textContent = on === all ? '' : on + ' of ' + all;
    });
    tick($('grp-all'), state.cats.length + programsOn(), ALL_CODES.length + PROGRAMS.length);
    ALL_CODES.forEach(c => { $('cat-' + c).checked = state.cats.indexOf(c) >= 0; });
    const huntOnly = state.cats.length === HUNTING_CODES.length && HUNTING_CODES.every(c => state.cats.indexOf(c) >= 0);
    $('btnHunt').textContent = huntOnly ? 'Show all' : 'Hunting only';
    save();
  }
  // A tree: All public land > State / Federal / Local > categories. Groups start folded up
  // every time the page opens; the arrow opens one, the checkbox turns it all on or off.
  function buildLandList() {
    const host = $('landGroups');
    const head = (id, name, open, extra) =>
      '<div class="trow"><button type="button" class="twisty" aria-expanded="' + open + '" aria-controls="kids-' + id + '" aria-label="Show or hide ' + esc(name) + '"></button>' +
      '<label class="row"><input type="checkbox" id="grp-' + id + '"><span class="lbl">' + esc(name) + (extra || '') + '</span></label></div>';
    host.innerHTML = '<div class="tnode top">' + head('all', 'All public land', true) + '<div class="kids" id="kids-all">' +
      GROUPS.map(g =>
        '<div class="tnode">' + head(g.id, g.name, false, ' <small class="cnt" id="cnt-' + g.id + '"></small>') +
        '<div class="kids leaves" id="kids-' + g.id + '" hidden>' +
        g.cats.map(c =>
          '<label class="row"><input type="checkbox" id="cat-' + c.c + '"><span class="sw" style="background:' + c.color + '"></span>' +
          '<span class="lbl">' + esc(c.name) + '<span class="note' + (c.warn ? ' warn' : '') + '">' + esc(c.note) + '</span></span></label>'
        ).join('') + '</div></div>'
      ).join('') + '</div></div>';
    if ($('dnrPrograms')) $('kids-state').appendChild($('dnrPrograms')); // HAP and Commercial Forest rows, from index.html
    PROGRAMS.forEach(id => $(id).addEventListener('change', () => applyCats()));
    host.querySelectorAll('.twisty').forEach(b => b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      $(b.getAttribute('aria-controls')).hidden = !open;
    }));
    $('grp-all').addEventListener('change', e => {
      state.cats = e.target.checked ? ALL_CODES.slice() : [];
      setPrograms(e.target.checked); applyCats();
    });
    GROUPS.forEach(g => {
      $('grp-' + g.id).addEventListener('change', e => {
        const codes = g.cats.map(c => c.c);
        state.cats = state.cats.filter(c => codes.indexOf(c) < 0);
        if (e.target.checked) state.cats = state.cats.concat(codes);
        if (g.id === 'state') setPrograms(e.target.checked);
        applyCats();
      });
      g.cats.forEach(c => $('cat-' + c.c).addEventListener('change', e => {
        state.cats = state.cats.filter(x => x !== c.c);
        if (e.target.checked) state.cats.push(c.c);
        applyCats();
      }));
    });
    applyCats(); // show the saved choices right away (the map filter waits for the map)
  }
  function setPanel(open) {
    $('panel').dataset.open = String(open);
    $('btnLayers').setAttribute('aria-expanded', String(open));
  }
  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(on));
      $('tab-' + b.dataset.tab).hidden = !on;
    });
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  buildLandList();
  setPanel(window.matchMedia('(min-width: 800px)').matches);
  $('btnLayers').addEventListener('click', () => setPanel($('panel').dataset.open !== 'true'));
  $('btnClose').addEventListener('click', () => setPanel(false));
  $('btnWind').addEventListener('click', () => loadWind(true));
  document.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => setBase(b.dataset.base)));
  $('chkContours').checked = state.contours;
  $('chkContours').addEventListener('change', e => { state.contours = e.target.checked; setVis('contours', state.contours); save(); });
  $('chkWind').checked = state.wind;
  $('chkWind').addEventListener('change', e => { state.wind = e.target.checked; setVis('wind', state.wind); save(); });
  $('landOpacity').value = state.opacity; $('landOpacityVal').textContent = state.opacity + '%';
  $('landOpacity').addEventListener('input', e => {
    state.opacity = +e.target.value; $('landOpacityVal').textContent = state.opacity + '%';
    map.setPaintProperty('land-fill', 'fill-opacity', state.opacity / 100); save();
  });
  $('btnHunt').addEventListener('click', () => {
    const huntOnly = $('btnHunt').textContent === 'Show all';
    state.cats = huntOnly ? ALL_CODES.slice() : HUNTING_CODES.slice();
    setPrograms(true); // HAP and Commercial Forest are hunting land either way
    applyCats();
  });

  map.on('load', () => {
    Object.keys(WIND_CLASSES).forEach(k => map.addImage('wind-' + k, arrowImage(WIND_CLASSES[k]), { pixelRatio: 2 }));
    map.addImage('wind-calm', calmImage(), { pixelRatio: 2 });
    setBase(state.base);
    setVis('contours', state.contours);
    setVis('wind', state.wind);
    applyCats();
    loadLand();
    loadWind(false);
    windTimer = setInterval(() => loadWind(false), 10 * 60 * 1000);
    setInterval(showWindAge, 30 * 1000);
  });

  map.on('moveend', () => {
    state.view = { center: map.getCenter().toArray().map(v => +v.toFixed(5)), zoom: +map.getZoom().toFixed(2) };
    save();
    if (mapLoaded) loadLand(); // starts West Virginia's land the first time the map shows it
    if (mapLoaded && windRegions && windRegions !==REGIONS.filter(r => r.start || r.state).map(r => r.id).join(',')) loadWind(false);
    if (!userPos) showNearestWind();
  });

  map.on('click', e => {
    if (window.MHM.measureClick && window.MHM.measureClick(e)) return; // measure tool (measure.js)
    if (window.MHM.friendClick && window.MHM.friendClick(e)) return; // friend dots (friends.js)
    if (window.MHM.onMapClick && window.MHM.onMapClick(e)) return; // pins (pins.js)
    const pad = 12;
    const wind = state.wind ? map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['wind'] }) : [];
    if (wind.length) { openPopup(wind[0].geometry.coordinates, windHtml(wind[0].properties)); return; }
    if (window.MHM.hapClick && window.MHM.hapClick(e)) return; // HAP land (hap.js)
    if (window.MHM.cfClick && window.MHM.cfClick(e)) return; // Commercial Forest (cf.js)
    const hits = landAt(e.lngLat.lng, e.lngLat.lat);
    const parcel = window.MHM.parcelAt && window.MHM.parcelAt(e.point); // county parcels (parcels.js)
    const html = parcel && !hits.length ? '<div class="pop">' + window.MHM.parcelHtml(parcel) + '</div>'
      : landHtml(hits) + (parcel ? '<div class="pop">' + window.MHM.parcelHtml(parcel) + '</div>' : '');
    // Extras add their own sections, only while they're switched on (trees.js, crops.js).
    const extras = [window.MHM.windFlowPop, window.MHM.treePop, window.MHM.cropPop].map(f => f && f(e.lngLat, e.point)).filter(Boolean);
    if (!extras.length) { openPopup(e.lngLat, html); return; }
    const el = document.createElement('div'); el.innerHTML = html; extras.forEach(x => el.appendChild(x));
    openPopup(e.lngLat, el);
  });
  map.on('mouseenter', 'wind', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'wind', () => { map.getCanvas().style.cursor = ''; });

  let firstFix = true;
  geo.on('geolocate', pos => {
    userPos = [pos.coords.longitude, pos.coords.latitude];
    showNearestWind();
    if (firstFix && landLoaded) {
      firstFix = false;
      const hap = window.MHM.hapAt && window.MHM.hapAt(userPos[0], userPos[1]);
      const hits = landAt(userPos[0], userPos[1]);
      const cf = window.MHM.cfAt && window.MHM.cfAt(userPos[0], userPos[1]);
      toast(hap ? 'You are on HAP land: property #' + hap.HAPID + ' (' + String(hap.HuntType || '').trim().replace(/\.$/, '') + '). Check in before hunting.'
        : cf ? 'You are on Commercial Forest land: private, open to hunting on foot.'
        : hits.length ? 'You are on ' + (CATS[hits[0].c] ? CATS[hits[0].c].name.toLowerCase() : 'public land') + (hits[0].n ? ': ' + hits[0].n : '')
        : 'You are not on mapped public land.');
    }
  });
  geo.on('trackuserlocationend', () => { firstFix = true; });
  geo.on('error', () => toast('Location is off or blocked. Allow location for this page to see where you are.'));

  // Shared with pins.js
  window.MHM = { map, onLoad, toast, openPopup, closePopup, esc, $, setPanel, showTab, geo, getUserPos: () => userPos };

  // ---- Extras. Off by default; each one's file is only downloaded when it's switched on.
  // They get the same ?v= tag index.html gave this file, so a phone never mixes old and new.
  [
    { chk: 'chkTrees', key: 'mhm.trees.v1', file: 'trees.js', api: 'trees', name: 'Tree types' },
    { chk: 'chkCrops', key: 'mhm.crops.v1', file: 'crops.js', api: 'crops', name: 'Crop fields' },
    { chk: 'chkWindFlow', key: 'mhm.windflow.v1', file: 'windflow.js', api: 'windflow', name: 'Wind flow' },
  ].forEach(x => {
    const pref = () => { try { return JSON.parse(localStorage.getItem(x.key)) || {}; } catch (e) { return {}; } };
    function set(on) {
      try { localStorage.setItem(x.key, JSON.stringify(Object.assign(pref(), { on }))); } catch (e) { /* storage blocked */ }
      const api = window.MHM[x.api];
      if (api) { if (on) api.on(); else api.off(); return; }
      if (!on || document.querySelector('script[data-extra="' + x.api + '"]')) return; // still downloading: it checks the box when it runs
      const s = document.createElement('script');
      s.src = x.file + (VER ? '?' + VER : '');
      s.dataset.extra = x.api;
      s.onerror = () => { s.remove(); $(x.chk).checked = false; toast('Could not load ' + x.name + '. Check your connection.'); };
      document.head.appendChild(s);
    }
    $(x.chk).checked = !!pref().on;
    $(x.chk).addEventListener('change', e => set(e.target.checked));
    if (pref().on) { $('extras').open = true; set(true); }
  });
})();
