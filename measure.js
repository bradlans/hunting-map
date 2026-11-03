// Michigan Hunting Map - measure tool.
// Ruler button (top right): tap points on the map for a distance in yards / miles, or
// switch to Area for acres. Each leg is labeled on the map. Distances are along the
// ground (great-circle), so they hold at any zoom.

(function () {
  'use strict';
  const { map, toast, $, getUserPos } = window.MHM;

  const R = 6371008.8; // mean earth radius, meters
  const COLOR = '#ffd23f'; // yellow: reads on satellite and topo, unlike the blaze orange pins
  let pts = [], mode = 'line', active = false;

  // ---- Math ---------------------------------------------------------------------------
  const rad = d => d * Math.PI / 180;
  function meters(a, b) {
    const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Area of a polygon on the sphere (same method as turf.js), square meters.
  function sqMeters(ring) {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      s += rad(b[0] - a[0]) * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
    }
    return Math.abs(s * R * R / 2);
  }
  const legs = () => pts.slice(1).map((p, i) => meters(pts[i], p)).concat(mode === 'area' && pts.length > 2 ? [meters(pts[pts.length - 1], pts[0])] : []);
  function dist(m) {
    const yd = m * 1.0936133;
    if (yd < 1760 / 2) return Math.round(yd) + ' yd';
    const mi = m / 1609.344;
    return (mi < 10 ? mi.toFixed(2) : mi.toFixed(1)) + ' mi';
  }
  function acres(m2) {
    const ac = m2 / 4046.8564;
    if (ac >= 640) return (ac / 640).toFixed(2) + ' sq mi (' + Math.round(ac).toLocaleString() + ' acres)';
    return (ac < 10 ? ac.toFixed(2) : ac < 100 ? ac.toFixed(1) : Math.round(ac).toLocaleString()) + ' acres';
  }

  // ---- Map layers ---------------------------------------------------------------------
  function geojson() {
    const f = [];
    if (mode === 'area' && pts.length > 2) f.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts.concat([pts[0]])] }, properties: { k: 'fill' } });
    if (pts.length > 1) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: mode === 'area' && pts.length > 2 ? pts.concat([pts[0]]) : pts }, properties: { k: 'line' } });
    const L = legs();
    L.forEach((m, i) => {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }, properties: { k: 'leg', t: dist(m) } });
    });
    pts.forEach((p, i) => f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { k: 'pt', first: i === 0 } }));
    return { type: 'FeatureCollection', features: f };
  }
  function draw() {
    if (map.getSource('measure')) map.getSource('measure').setData(geojson());
    readout();
  }
  function initLayers() {
    map.addSource('measure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'measure-fill', type: 'fill', source: 'measure', filter: ['==', ['get', 'k'], 'fill'], paint: { 'fill-color': COLOR, 'fill-opacity': 0.18 } });
    map.addLayer({ id: 'measure-casing', type: 'line', source: 'measure', filter: ['==', ['get', 'k'], 'line'], paint: { 'line-color': 'rgba(0,0,0,.6)', 'line-width': 5 } });
    map.addLayer({ id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['get', 'k'], 'line'], paint: { 'line-color': COLOR, 'line-width': 2.5, 'line-dasharray': [2, 1.2] } });
    map.addLayer({ id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', ['get', 'k'], 'pt'],
      paint: { 'circle-radius': ['case', ['get', 'first'], 6, 4.5], 'circle-color': COLOR, 'circle-stroke-color': '#1b1b1b', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'measure-legs', type: 'symbol', source: 'measure', filter: ['==', ['get', 'k'], 'leg'],
      layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#1b1b1b', 'text-halo-color': COLOR, 'text-halo-width': 2 } });
  }

  // ---- Readout bar --------------------------------------------------------------------
  function readout() {
    const L = legs(), total = L.reduce((s, m) => s + m, 0);
    let msg;
    if (!pts.length) msg = 'Tap the map to start. Each tap adds a point.';
    else if (pts.length === 1) msg = mode === 'area' ? 'Keep tapping around the area.' : 'Tap the next point.';
    else if (mode === 'area' && pts.length > 2) msg = '<b>' + acres(sqMeters(pts)) + '</b> · around the edge ' + dist(total);
    else if (mode === 'area') msg = 'Tap one more point to make an area.';
    else msg = '<b>' + dist(total) + '</b>' + (L.length > 1 ? ' total · last leg ' + dist(L[L.length - 1]) : '');
    $('measureReadout').innerHTML = msg;
    $('btnMeasureUndo').disabled = !pts.length;
    $('btnMeasureClear').disabled = !pts.length;
    $('measureLine').setAttribute('aria-pressed', mode === 'line');
    $('measureArea').setAttribute('aria-pressed', mode === 'area');
  }

  // ---- Start / stop -------------------------------------------------------------------
  function start() {
    if (active) return;
    if (!$('placebar').hidden) $('btnPlaceCancel').click(); // one tool at a time
    active = true; window.MHM.measuring = true;
    if (!window.matchMedia('(min-width: 800px)').matches) window.MHM.setPanel(false);
    window.MHM.closePopup();
    $('measurebar').hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    map.getCanvas().style.cursor = 'crosshair';
    draw();
  }
  function stop() {
    active = false; window.MHM.measuring = false;
    pts = [];
    $('measurebar').hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    map.getCanvas().style.cursor = '';
    draw();
  }
  // Called first from app.js: while measuring, taps add points instead of opening popups.
  window.MHM.measureClick = e => {
    if (!active) return false;
    pts.push([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]);
    draw();
    return true;
  };

  $('btnAddPin').addEventListener('click', () => { if (active) stop(); }, true);
  $('btnMeasureUndo').addEventListener('click', () => { pts.pop(); draw(); });
  $('btnMeasureClear').addEventListener('click', () => { pts = []; draw(); });
  $('btnMeasureDone').addEventListener('click', stop);
  $('measureLine').addEventListener('click', () => { mode = 'line'; draw(); });
  $('measureArea').addEventListener('click', () => { mode = 'area'; draw(); });
  $('btnMeasureMe').addEventListener('click', () => {
    const pos = getUserPos();
    if (!pos) { toast('Turn on the GPS button (top right) first, then try again.'); return; }
    pts.unshift([+pos[0].toFixed(6), +pos[1].toFixed(6)]);
    draw();
    toast('Started from your location.');
  });
  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape') stop();
    else if ((e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); pts.pop(); draw(); }
  });

  // ---- Ruler button (map control under the GPS button) ---------------------------------
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'measure-btn';
  btn.title = 'Measure distance or area';
  btn.setAttribute('aria-label', 'Measure distance or area');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g transform="rotate(-45 12 12)" fill="none" stroke="currentColor">' +
    '<rect x="1.5" y="8.5" width="21" height="7" rx="1.2" stroke-width="1.8"/><path d="M5.5 8.5v3M9 8.5v2M12.5 8.5v3M16 8.5v2M19.5 8.5v3" stroke-width="1.5"/></g></svg>';
  btn.addEventListener('click', () => (active ? stop() : start()));
  map.addControl({
    onAdd() { const d = document.createElement('div'); d.className = 'maplibregl-ctrl maplibregl-ctrl-group'; d.appendChild(btn); return d; },
    onRemove() {},
  }, 'top-right');

  window.MHM.onLoad(initLayers);
})();
