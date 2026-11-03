// Michigan Hunting Map - Commercial Forest (CF) land.
// Private timberland enrolled in the DNR Commercial Forest program, open to the public on
// foot for hunting, fishing and trapping. Outlines come from the DNR open data layer; the
// owner and legal description are looked up live when a parcel is tapped. The last copy of
// the outlines is kept on the device (IndexedDB, it is too big for localStorage).

(function () {
  'use strict';
  const { map, toast, openPopup, esc, $ } = window.MHM;

  const BASE = 'https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/';
  const SHAPES = BASE + 'CommercialForestOPENDATA/FeatureServer/0/query';
  const DETAILS = BASE + 'CommercialForestParcels_View/FeatureServer/0/query';
  const DNR_CF_PAGE = 'https://www.michigan.gov/dnr/managing-resources/forestry/private/cf';
  const UI_KEY = 'mhm.cfui.v1';
  const COLOR = '#2f7bff'; // blue hatch: not used by any public land category
  const PAGE = 2000, MAX_AGE = 7 * 864e5; // enrollment changes a few times a year

  const ui = (() => { try { return Object.assign({ show: true }, JSON.parse(localStorage.getItem(UI_KEY))); } catch (e) { return { show: true }; } })();
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* storage blocked */ } }
  let cf = null, fetchedAt = 0, index = [];

  // ---- Saved copy (IndexedDB) -----------------------------------------------------
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('mhm', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('cache');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function readCache() {
    try {
      const d = await db();
      const c = await new Promise((resolve, reject) => {
        const r = d.transaction('cache').objectStore('cache').get('cf');
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      if (c && c.data) { cf = c.data; fetchedAt = c.fetched || 0; }
    } catch (e) { /* no saved copy */ }
  }
  async function writeCache() {
    try { (await db()).transaction('cache', 'readwrite').objectStore('cache').put({ fetched: fetchedAt, data: cf }, 'cf'); }
    catch (e) { /* blocked: live only */ }
  }

  // ---- Data ---------------------------------------------------------------------------
  async function getJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('DNR answered ' + res.status);
    return res.json();
  }
  async function fetchCf() {
    const n = (await getJson(SHAPES + '?where=1%3D1&returnCountOnly=true&f=json')).count;
    if (!n) throw new Error('No Commercial Forest parcels returned');
    const pages = [];
    // Simplified to about 5 m, plenty for a property outline.
    for (let offset = 0; offset < Math.min(n, 60000); offset += PAGE) {
      pages.push(getJson(SHAPES + '?where=1%3D1&outFields=parid,GISAcres&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.00005' +
        '&orderByFields=OBJECTID&resultOffset=' + offset + '&resultRecordCount=' + PAGE + '&f=geojson'));
    }
    const features = [];
    (await Promise.all(pages)).forEach(gj => features.push.apply(features, (gj.features || []).filter(f => f.geometry)));
    return { type: 'FeatureCollection', features };
  }
  function buildIndex() {
    index = (cf ? cf.features : []).map(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      polys.forEach(p => p[0].forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }));
      return { f, polys, bb: [minX, minY, maxX, maxY] };
    });
  }

  // ---- Map layers ---------------------------------------------------------------------
  // Hatched the opposite way from HAP so the two read apart where they meet.
  function hatch() {
    const s = 16, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.strokeStyle = COLOR; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-4, -4); g.lineTo(s + 4, s + 4); g.moveTo(-4, s - 4); g.lineTo(4, s + 4); g.moveTo(s - 4, -4); g.lineTo(s + 4, 4); g.stroke();
    return g.getImageData(0, 0, s, s);
  }
  function applyVisibility() {
    if (!map.getLayer('cf-fill')) return;
    ['cf-fill', 'cf-line'].forEach(id => map.setLayoutProperty(id, 'visibility', ui.show ? 'visible' : 'none'));
  }
  function pushData() { if (map.getSource('cf')) map.getSource('cf').setData(cf || { type: 'FeatureCollection', features: [] }); }
  function initLayers() {
    map.addImage('cf-hatch', hatch(), { pixelRatio: 2 });
    map.addSource('cf', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Commercial Forest: Michigan DNR' });
    // Under HAP, so a HAP parcel inside CF land still shows its own color.
    const before = map.getLayer('hap-inactive') ? 'hap-inactive' : map.getLayer('wind') ? 'wind' : undefined;
    map.addLayer({ id: 'cf-fill', type: 'fill', source: 'cf', paint: { 'fill-pattern': 'cf-hatch', 'fill-opacity': 0.85 } }, before);
    map.addLayer({ id: 'cf-line', type: 'line', source: 'cf',
      paint: { 'line-color': COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 14, 2.5] } }, before);
    pushData(); applyVisibility();
  }

  // ---- Lookups and popup ----------------------------------------------------------------
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function cfAt(lng, lat) {
    if (!ui.show) return null;
    const hit = index.find(({ polys, bb }) => lng >= bb[0] && lng <= bb[2] && lat >= bb[1] && lat <= bb[3] &&
      polys.some(poly => inRing(lng, lat, poly[0]) && !poly.slice(1).some(h => inRing(lng, lat, h))));
    return hit ? hit.f.properties : null;
  }
  const clean = s => (s == null ? '' : String(s).trim());
  function cfPopup(p) {
    const el = document.createElement('div');
    el.className = 'pop';
    el.innerHTML =
      '<h4>Commercial Forest land</h4>' +
      '<div class="tag"><i style="background:' + COLOR + '"></i>Private, open to the public on foot</div>' +
      '<dl class="cf-details">' +
      (p.GISAcres ? '<dt>Size</dt><dd>' + Math.round(p.GISAcres) + ' acres</dd>' : '') +
      (clean(p.parid) ? '<dt>CF parcel</dt><dd>' + esc(clean(p.parid)) + '</dd>' : '') +
      '</dl>' +
      '<p class="note-text">Open to hunting, fishing and trapping on foot; a gate or fence does not close it. ' +
      'Driving, ORVs, camping and anything else need the owner\'s OK. No permanent blinds or other structures. ' +
      'The owner may close areas during active logging.</p>' +
      '<div class="pin-actions"><a class="btn" target="_blank" rel="noopener" href="' + DNR_CF_PAGE + '">DNR Commercial Forest rules</a></div>';
    // Owner and legal description, live from the DNR by CF parcel number (that view can't
    // be searched by location). Skipped quietly with no signal.
    const parid = parseInt(p.parid, 10);
    if (!(parid > 0)) return el;
    const url = DETAILS + '?where=parid%3D' + parid +
      '&outFields=FullLegalName,CountyName,TownName,Town,Range_,Section,ParcelStatusText,Acres&returnGeometry=false&resultRecordCount=1&f=json';
    getJson(url).then(j => {
      const a = j.features && j.features[0] && j.features[0].attributes;
      if (!a) return;
      const trs = [clean(a.Town), clean(a.Range_), a.Section ? 'Sec ' + clean(a.Section) : ''].filter(Boolean).join(' ');
      el.querySelector('.cf-details').innerHTML =
        (clean(a.FullLegalName) ? '<dt>Owner</dt><dd>' + esc(clean(a.FullLegalName)) + '</dd>' : '') +
        (clean(a.CountyName) ? '<dt>Where</dt><dd>' + esc(clean(a.CountyName)) + ' County' + (clean(a.TownName) ? ', ' + esc(clean(a.TownName)) : '') +
          (trs ? '<br><small>' + esc(trs) + '</small>' : '') + '</dd>' : '') +
        (clean(a.ParcelStatusText) ? '<dt>Status</dt><dd>' + esc(clean(a.ParcelStatusText)) + '</dd>' : '') +
        ((a.Acres || p.GISAcres) ? '<dt>Size</dt><dd>' + Math.round(a.Acres || p.GISAcres) + ' acres</dd>' : '');
    }).catch(() => { /* offline: the outline facts are enough */ });
    return el;
  }

  // Called from app.js after HAP: show the CF popup if the tap is on Commercial Forest land.
  window.MHM.cfClick = e => {
    const p = cfAt(e.lngLat.lng, e.lngLat.lat);
    if (!p) return false;
    openPopup(e.lngLat, cfPopup(p));
    return true;
  };
  window.MHM.cfAt = cfAt;

  // ---- Panel controls -------------------------------------------------------------------
  function status(msg) {
    const acres = cf ? cf.features.reduce((s, f) => s + (f.properties.GISAcres || 0), 0) : 0;
    $('cfStatus').textContent = msg || (cf
      ? cf.features.length.toLocaleString() + ' parcels, ' + (acres / 1e6).toFixed(1) + ' million acres' +
        (fetchedAt ? ', checked ' + new Date(fetchedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '') + '.'
      : 'Loading Commercial Forest land...');
  }
  $('chkCf').checked = ui.show;
  $('chkCf').addEventListener('change', e => { ui.show = e.target.checked; saveUi(); applyVisibility(); });

  async function refresh() {
    try {
      cf = await fetchCf(); fetchedAt = Date.now();
      writeCache(); buildIndex(); pushData(); status();
    } catch (err) {
      console.error(err);
      status(cf ? 'Showing the saved copy (could not reach the DNR just now).' : 'Could not load Commercial Forest land from the DNR. Check your connection.');
    }
  }

  const mapReady = new Promise(resolve => window.MHM.onLoad(resolve));
  status();
  Promise.all([readCache(), mapReady]).then(() => {
    initLayers(); buildIndex(); status();
    if (!cf || Date.now() - fetchedAt > MAX_AGE) refresh();
  });
})();
