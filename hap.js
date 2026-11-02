// Michigan Hunting Map - Hunting Access Program (HAP) land.
// Live from the Michigan DNR Wildlife Division open data layer (public record, no use
// restrictions). The last copy is kept on the device so HAP land still shows with no signal.

(function () {
  'use strict';
  const { map, toast, openPopup, esc, $ } = window.MHM;

  const SERVICE = 'https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/DNRWILDLandsOPENDATA/FeatureServer/0/query';
  const FIELDS = 'COUNTY,HAPID,ActiveOrInactive,HAPPermit,acres,AgriculturalAcres,ForestAcres,GrasslandandBushAcres,WetlandAcres,SpecialComment,HAPInfo,HuntType,HeadquartersLat,HeadquartersLong,last_edited_date';
  const DNR_HAP_PAGE = 'https://www.michigan.gov/dnr/things-to-do/hunting/where/hap';
  const CACHE_KEY = 'mhm.hap.v1', UI_KEY = 'mhm.hapui.v1';
  const COLOR = '#d61c8c'; // magenta: nothing else on the map uses it

  const ui = (() => { try { return Object.assign({ show: true, inactive: false }, JSON.parse(localStorage.getItem(UI_KEY))); } catch (e) { return { show: true, inactive: false }; } })();
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* storage blocked */ } }
  let hap = null, fetchedAt = 0, index = [];

  // ---- Data ---------------------------------------------------------------------
  function readCache() {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c && c.data) { hap = c.data; fetchedAt = c.fetched || 0; } } catch (e) { /* no cache */ }
  }
  function writeCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetched: fetchedAt, data: hap })); } catch (e) { /* too big or blocked: live only */ }
  }
  async function fetchHap() {
    const features = [];
    for (let offset = 0; offset < 20000; offset += 2000) {
      const url = SERVICE + '?where=1%3D1&outFields=' + FIELDS + '&outSR=4326&geometryPrecision=6&resultOffset=' + offset + '&resultRecordCount=2000&f=geojson';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('DNR answered ' + res.status);
      const gj = await res.json();
      features.push.apply(features, gj.features || []);
      if (!(gj.properties && gj.properties.exceededTransferLimit) && !gj.exceededTransferLimit) break;
    }
    if (!features.length) throw new Error('No HAP parcels returned');
    return { type: 'FeatureCollection', features };
  }
  function buildIndex() {
    index = (hap ? hap.features : []).filter(f => f.geometry).map(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      polys.forEach(p => p[0].forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }));
      return { f, polys, bb: [minX, minY, maxX, maxY] };
    });
  }
  const isActive = p => String(p.ActiveOrInactive).toLowerCase() === 'active';
  function hqPoints() {
    return {
      type: 'FeatureCollection',
      features: (hap ? hap.features : []).filter(f => isActive(f.properties) && isFinite(f.properties.HeadquartersLat) && f.properties.HeadquartersLat)
        .map(f => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.properties.HeadquartersLong, f.properties.HeadquartersLat] }, properties: f.properties })),
    };
  }

  // ---- Map layers ---------------------------------------------------------------
  function stripes() {
    const s = 16, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.strokeStyle = COLOR; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-4, s + 4); g.lineTo(s + 4, -4); g.moveTo(-4, 4); g.lineTo(4, -4); g.moveTo(s - 4, s + 4); g.lineTo(s + 4, s - 4); g.stroke();
    return g.getImageData(0, 0, s, s);
  }
  function applyVisibility() {
    if (!map.getLayer('hap-fill')) return;
    const vis = ui.show ? 'visible' : 'none';
    ['hap-fill', 'hap-line', 'hap-hq', 'hap-hq-label'].forEach(id => map.setLayoutProperty(id, 'visibility', vis));
    map.setLayoutProperty('hap-inactive', 'visibility', ui.show && ui.inactive ? 'visible' : 'none');
  }
  function pushData() {
    if (!map.getSource('hap')) return;
    map.getSource('hap').setData(hap || { type: 'FeatureCollection', features: [] });
    map.getSource('hap-hq').setData(hqPoints());
  }
  function initLayers() {
    map.addImage('hap-stripes', stripes(), { pixelRatio: 2 });
    map.addSource('hap', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'HAP: Michigan DNR' });
    map.addSource('hap-hq', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = map.getLayer('wind') ? 'wind' : undefined;
    const active = ['==', ['downcase', ['to-string', ['get', 'ActiveOrInactive']]], 'active'];
    map.addLayer({ id: 'hap-inactive', type: 'line', source: 'hap', filter: ['!', active],
      paint: { 'line-color': '#9a9a9a', 'line-width': 1.5, 'line-dasharray': [2, 2] } }, before);
    map.addLayer({ id: 'hap-fill', type: 'fill', source: 'hap', filter: active,
      paint: { 'fill-pattern': 'hap-stripes', 'fill-opacity': 0.9 } }, before);
    map.addLayer({ id: 'hap-line', type: 'line', source: 'hap', filter: active,
      paint: { 'line-color': COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 14, 3] } }, before);
    map.addLayer({ id: 'hap-hq', type: 'circle', source: 'hap-hq', minzoom: 10,
      paint: { 'circle-radius': 6, 'circle-color': COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } }, before);
    map.addLayer({ id: 'hap-hq-label', type: 'symbol', source: 'hap-hq', minzoom: 12,
      layout: { 'text-field': 'HAP check-in', 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4 } }, before);
    pushData(); applyVisibility();
    map.on('mouseenter', 'hap-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'hap-fill', () => { map.getCanvas().style.cursor = ''; });
  }

  // ---- Lookups and popup --------------------------------------------------------
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // The HAP parcel under a point: active ones always, inactive only when shown.
  function hapAt(lng, lat) {
    if (!ui.show) return null;
    let best = null;
    index.forEach(({ f, polys, bb }) => {
      if (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]) return;
      const p = f.properties;
      if (!isActive(p) && !ui.inactive) return;
      if (polys.some(poly => inRing(lng, lat, poly[0]) && !poly.slice(1).some(h => inRing(lng, lat, h)))) {
        if (!best || (isActive(p) && !isActive(best))) best = p;
      }
    });
    return best;
  }
  const clean = s => (s == null ? '' : String(s).trim());
  function hapPopup(p) {
    const active = isActive(p);
    const youth = /youth|apprentice/i.test(clean(p.HuntType));
    const hab = [['Forest', p.ForestAcres], ['Grass/brush', p.GrasslandandBushAcres], ['Farm', p.AgriculturalAcres], ['Wetland', p.WetlandAcres]]
      .filter(([, v]) => v > 0).map(([k, v]) => k + ' ' + Math.round(v)).join(' Â· ');
    const hasHq = isFinite(p.HeadquartersLat) && p.HeadquartersLat;
    const el = document.createElement('div');
    el.className = 'pop';
    el.innerHTML =
      '<h4>HAP property #' + esc(p.HAPID) + '</h4>' +
      '<div class="tag"><i style="background:' + COLOR + '"></i>Hunting Access Program Â· ' + esc(clean(p.COUNTY)) + ' County</div>' +
      '<dl>' +
      '<dt>Status</dt><dd class="' + (active ? 'access-OA' : 'access-XA') + '">' + (active ? 'Active - open to HAP hunting' : 'Inactive - NOT open') + '</dd>' +
      (clean(p.HuntType) ? '<dt>Hunt type</dt><dd' + (youth ? ' class="access-RA"' : '') + '>' + esc(clean(p.HuntType)) + '</dd>' : '') +
      (clean(p.HAPInfo) ? '<dt>Check-in</dt><dd>' + esc(clean(p.HAPInfo)) + '</dd>' : '') +
      (p.HAPPermit ? '<dt>Hunters</dt><dd>Up to ' + esc(p.HAPPermit) + ' at a time</dd>' : '') +
      (p.acres ? '<dt>Size</dt><dd>' + Math.round(p.acres) + ' acres' + (hab ? '<br><small>' + esc(hab) + '</small>' : '') + '</dd>' : '') +
      '</dl>' +
      (clean(p.SpecialComment) ? '<p class="note-text">' + esc(clean(p.SpecialComment)) + '</p>' : '') +
      '<div class="pin-actions">' +
      (hasHq ? '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + p.HeadquartersLat + ',' + p.HeadquartersLong + '">Directions to check-in</a>' : '') +
      '<a class="btn" target="_blank" rel="noopener" href="' + DNR_HAP_PAGE + '">DNR HAP rules</a>' +
      '</div>' +
      '<div class="hint">Private land. Register or check in before you hunt and follow the posted rules.</div>';
    return el;
  }

  // Called from app.js: show a HAP popup if the tap is on HAP land or a check-in point.
  window.MHM.hapClick = e => {
    if (!ui.show || !map.getLayer('hap-hq')) return false;
    const pad = 8;
    const hq = map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['hap-hq'] });
    const p = hq.length ? hq[0].properties : hapAt(e.lngLat.lng, e.lngLat.lat);
    if (!p) return false;
    openPopup(hq.length ? hq[0].geometry.coordinates : e.lngLat, hapPopup(p));
    return true;
  };
  window.MHM.hapAt = (lng, lat) => { const p = hapAt(lng, lat); return p && isActive(p) ? p : null; };

  // ---- Panel controls ---------------------------------------------------------------
  function status(msg) {
    const active = hap ? hap.features.filter(f => isActive(f.properties)).length : 0;
    $('hapStatus').textContent = msg || (hap
      ? active + ' active HAP properties' + (fetchedAt ? ', checked ' + new Date(fetchedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '') + '.'
      : 'Loading HAP land...');
  }
  $('chkHap').checked = ui.show;
  $('chkHapInactive').checked = ui.inactive;
  $('chkHap').addEventListener('change', e => { ui.show = e.target.checked; saveUi(); applyVisibility(); });
  $('chkHapInactive').addEventListener('change', e => { ui.inactive = e.target.checked; saveUi(); applyVisibility(); });

  async function refresh() {
    try {
      hap = await fetchHap(); fetchedAt = Date.now();
      writeCache(); buildIndex(); pushData(); status();
    } catch (err) {
      console.error(err);
      status(hap ? 'Showing the saved copy of HAP land (could not reach the DNR just now).' : 'Could not load HAP land from the DNR. Check your connection.');
      if (!hap) toast('Could not load HAP land from the DNR.');
    }
  }

  readCache(); buildIndex(); status();
  map.once('load', () => {
    initLayers();
    // Refresh from the DNR at most every 12 hours; HAP enrollment changes a few times a year.
    if (!hap || Date.now() - fetchedAt > 12 * 3600 * 1000) refresh();
  });
})();
