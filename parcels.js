// Michigan Hunting Map - private parcel lines from counties that publish them for free.
// Each county runs its own public ArcGIS service; parcels load for the area on screen
// once zoomed in. Tap a parcel for owner / parcel number / acres where the county shares them.

(function () {
  'use strict';
  const { map, esc, $ } = window.MHM;

  // One entry per county with a free public parcel service (checked Nov 2026).
  // url: the parcel polygon layer; owner / pin / acres: field names (null if the county omits them);
  // bbox: county bounds [w, s, e, n] from Census TIGERweb, so only counties on screen are asked.
  // resolve: where to look up a service whose name changes with each county update.
  const SOURCES = [
    { county: 'Allegan', url: 'https://gis.allegancounty.org/server/rest/services/Hosted/ParcelLayer_November2026_3/FeatureServer/0',
      owner: 'ownername1', pin: 'pnum', acres: 'totalacres', max: 2000, paging: true, bbox: [-87.059, 42.417, -85.543, 42.768],
      resolve: { from: 'https://gis.allegancounty.org/portal/sharing/rest/content/items/1df7bb10376c4aa58236914ac0680650/data?f=json',
                 match: /https:\/\/gis\.allegancounty\.org\/server\/rest\/services\/Hosted\/ParcelLayer_[^"\/]+\/FeatureServer\/\d+/ } },
    { county: 'Barry', url: 'https://services.arcgis.com/i0SsdDzLI3mLGmPR/arcgis/rest/services/Parcels_OpenData_View/FeatureServer/14',
      owner: null, pin: 'Tparcel', acres: 'Acres', max: 2000, paging: true, bbox: [-85.546, 42.421, -85.072, 42.771] },
    { county: 'Cheboygan', url: 'https://services6.arcgis.com/j6ueqNZduqQcCpQQ/arcgis/rest/services/Relationship_class/FeatureServer/0',
      owner: 'ownername1', pin: 'PARCEL_NO', acres: null, max: 2000, paging: true, bbox: [-84.734, 45.199, -84.201, 45.81] },
    { county: 'Grand Traverse', url: 'https://gis.gtcountymi.gov/arcgis/rest/services/Public_Services/Tax_Parcel_Public/FeatureServer/0',
      owner: 'OWNERNME1', pin: 'PARCELID', acres: 'ASSACRES', max: 1000, paging: true, bbox: [-85.818, 44.512, -85.333, 45.12] },
    { county: 'Ionia', url: 'https://services9.arcgis.com/i2awudUyJK8gxxEe/arcgis/rest/services/Ionia_County_Tax_Parcels/FeatureServer/0',
      owner: 'Parcel_Data_OWNERNAME', pin: 'CountyParcels_PIN', acres: 'Acreage', max: 1000, paging: true, bbox: [-85.313, 42.77, -84.837, 43.119] },
    { county: 'Jackson', url: 'https://gis.mijackson.org/countygis/rest/services/ParcelViewer/Parcels/FeatureServer/0',
      owner: 'OWNER', pin: 'PIN', acres: 'P_ACREAGE', max: 2000, paging: true, bbox: [-84.718, 42.07, -84.131, 42.425] },
    { county: 'Kalamazoo', url: 'https://gis.kalcounty.com/server/rest/services/Hosted/Parcels_2026_view/FeatureServer/0',
      owner: 'onername1', pin: 'pelnumber', acres: 'acres', max: 1000, paging: true, bbox: [-85.765, 42.069, -85.294, 42.421] },
    { county: 'Kent', url: 'https://gis.kentcountymi.gov/agisprod/rest/services/OpenData/Parcel_Related_Layers/MapServer/0',
      owner: null, pin: 'PNUM', acres: 'ACREAGE', max: 2000, paging: true, bbox: [-85.79, 42.768, -85.31, 43.294] },
    { county: 'Lake', url: 'https://services6.arcgis.com/077PZZsPIOhJKfvk/arcgis/rest/services/Parcels2026_View/FeatureServer/0',
      owner: 'OWNERNAME', pin: 'PARCELID', acres: 'ACREAGE', max: 2000, paging: true, bbox: [-86.044, 43.815, -85.562, 44.167] },
    { county: 'Lenawee', url: 'https://services6.arcgis.com/mjEvhc9AE3ceAXtG/arcgis/rest/services/Lenawee_Parcels_Public/FeatureServer/2',
      owner: 'OWNNM1', pin: 'TAXID', acres: 'ACREREC', max: 2000, paging: true, bbox: [-84.363, 41.707, -83.763, 42.082] },
    { county: 'Macomb', url: 'https://gis.macombgov.org/arcgis1/rest/services/PARCEL_FABRIC/Parcels_Web/FeatureServer/0',
      owner: 'ownername1', pin: 'TAX_ID', acres: null, max: 2000, paging: true, bbox: [-83.103, 42.447, -82.706, 42.898] },
    { county: 'Mason', url: 'https://services6.arcgis.com/eojfSqF7rM94Z7MZ/arcgis/rest/services/Parcels_2026/FeatureServer/3',
      owner: 'OwnerName', pin: 'pnum', acres: 'GISAC', max: 2000, paging: true, bbox: [-87.093, 43.816, -86.038, 44.183] },
    { county: 'Midland', url: 'https://services6.arcgis.com/9ALftzD3ElQ7KAgT/arcgis/rest/services/Land_Information/FeatureServer/0',
      owner: 'OwnerName', pin: 'ParcelNumber', acres: 'SummaryTotalAcreage', max: 2000, paging: true, bbox: [-84.608, 43.466, -84.167, 43.826] },
    { county: 'Monroe', url: 'https://gis.mocogeo.org/server/rest/services/Hosted/July2026_Tax_Parcel_Update_view/FeatureServer/0',
      owner: 'owner_name_1', pin: 'parcel_number', acres: 'acres', max: 1000, paging: true, bbox: [-83.774, 41.724, -83.112, 42.089] },
    { county: 'Montcalm', url: 'https://services6.arcgis.com/GJ2uZAPsEvtmqpe1/arcgis/rest/services/Tax_Parcels/FeatureServer/0',
      owner: 'BSAEXPORT_ONERNAME1', pin: 'TaxParcel_PARCELID', acres: 'MapAcreage', max: 1000, paging: true, bbox: [-85.563, 43.119, -84.837, 43.468] },
    { county: 'Muskegon', url: 'https://maps.muskegoncountygis.com/arcgis/rest/services/PropertyViewer/MapServer/23',
      owner: 'Owner_Name1', pin: 'PIN', acres: 'Acreage_per_GIS', max: 1000, paging: true, bbox: [-87.147, 43.118, -85.79, 43.471] },
    { county: 'Newaygo', url: 'https://arcgisweb.countyofnewaygo.com/hosting/rest/services/WebMaps/PublicCountyViewerProV3/MapServer/2',
      owner: 'OWNER_NAME', pin: 'PIN', acres: 'CALC_ACRE', max: 2000, paging: true, bbox: [-86.039, 43.293, -85.562, 43.816] },
    { county: 'Oakland', url: 'https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1',
      owner: 'NAME1', pin: 'PIN', acres: null, max: 2000, paging: true, bbox: [-83.689, 42.431, -83.083, 42.889] },
    { county: 'Oceana', url: 'https://services8.arcgis.com/qB4jROUe2zYBi3yY/arcgis/rest/services/Parcel_View_Layer_New/FeatureServer/0',
      owner: null, pin: 'PIN', acres: 'Acres', max: 2000, paging: true, bbox: [-87.14, 43.467, -86.038, 43.82] },
    { county: 'Osceola', url: 'https://services8.arcgis.com/FmKMwUEmDSC75SQm/arcgis/rest/services/OsceolaCountyParcels_view20240111/FeatureServer/0',
      owner: 'OWNER', pin: 'PIN', acres: 'BSA_ACRES', max: 2000, paging: true, bbox: [-85.565, 43.814, -85.087, 44.165] },
    { county: 'Ottawa', url: 'https://gis.miottawa.org/arcgis/rest/services/HostedServices/ParcelsPublic/MapServer/0',
      owner: 'OwnerName', pin: 'FinalPIN', acres: 'Acreage', max: 2000, paging: true, bbox: [-87.108, 42.765, -85.782, 43.206] },
    { county: 'Roscommon', url: 'https://services3.arcgis.com/rAGekBpQuVeYptc1/arcgis/rest/services/2027_Parcel_Layer202696/FeatureServer/0',
      owner: null, pin: 'PIN', acres: 'Acres', max: 2000, paging: true, bbox: [-84.852, 44.161, -84.368, 44.511] },
    { county: 'Saginaw', url: 'https://services3.arcgis.com/CmHnqlf5e6ltOCrY/ArcGIS/rest/services/County_Parcels/FeatureServer/1',
      owner: 'ownername', pin: 'PIN', acres: 'totalacres', max: 2000, paging: true, bbox: [-84.37, 43.128, -83.696, 43.569],
      note: 'Saginaw County\'s free copy dates from 2023, so ownership may have changed since.' },
    { county: 'St. Clair', url: 'https://maps.stclaircounty.org/GeoCortex_wa/rest/services/Public_GISweb/TaxParcels_Nightly/MapServer/0',
      owner: 'OWNER', pin: 'PIN', acres: 'Calc_Acres', max: 1000, paging: true, bbox: [-82.996, 42.478, -82.334, 43.17] },
  ];

  const MIN_ZOOM = 14;
  const MAX_FEATURES = 15000; // kept in memory; older areas drop off first
  const UI_KEY = 'mhm.parcelui.v1';
  const ui = (() => { try { return Object.assign({ show: true }, JSON.parse(localStorage.getItem(UI_KEY))); } catch (e) { return { show: true }; } })();
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* storage blocked */ } }

  // Some counties rename their service on every update; look up the current one.
  async function resolveUrls() {
    await Promise.all(SOURCES.filter(s => s.resolve).map(async s => {
      try {
        const text = await (await fetch(s.resolve.from)).text();
        const m = text.match(s.resolve.match);
        if (m) s.url = m[0];
      } catch (err) { /* keep the last known address */ }
    }));
  }

  // ---- Loading parcels for the view -----------------------------------------------
  const features = new Map(); // key county|id -> feature (insertion order = age)
  const loadedTiles = new Set(); // county|tile already fetched
  let pending = 0;
  // Work in ~1.2 km tiles so panning only fetches new ground.
  const TILE = 0.0125;
  function tilesFor(b) {
    const out = [];
    for (let x = Math.floor(b.getWest() / TILE); x <= Math.floor(b.getEast() / TILE); x++)
      for (let y = Math.floor(b.getSouth() / TILE); y <= Math.floor(b.getNorth() / TILE); y++) out.push([x, y]);
    return out;
  }
  const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  async function fetchTile(s, tx, ty) {
    const env = [tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE];
    const fields = [s.owner, s.pin, s.acres, s.address].filter(Boolean).join(',') || '*';
    const page = s.max || 1000;
    for (let offset = 0, guard = 0; guard < 10; guard++, offset += page) {
      const url = s.url + '/query?geometry=' + env.join(',') + '&geometryType=esriGeometryEnvelope&inSR=4326' +
        '&spatialRel=esriSpatialRelIntersects&outFields=' + encodeURIComponent(fields) + '&outSR=4326&geometryPrecision=6' +
        '&resultRecordCount=' + page + (s.paging ? '&resultOffset=' + offset : '') + '&f=geojson';
      const res = await fetch(url);
      if (!res.ok) throw new Error(s.county + ' ' + res.status);
      const gj = await res.json();
      (gj.features || []).forEach((f, i) => {
        if (!f.geometry) return;
        const id = f.id != null ? f.id : (f.properties && s.pin && f.properties[s.pin]) || (tx + ':' + ty + ':' + offset + ':' + i);
        const key = s.county + '|' + id;
        f.properties = Object.assign({}, f.properties, { _c: s.county });
        features.delete(key); features.set(key, f);
      });
      const more = gj.exceededTransferLimit || (gj.properties && gj.properties.exceededTransferLimit);
      if (!s.paging || !more) break;
    }
  }
  function trim() {
    while (features.size > MAX_FEATURES) features.delete(features.keys().next().value);
  }
  function pushData() {
    const src = map.getSource('parcels');
    if (src) src.setData({ type: 'FeatureCollection', features: Array.from(features.values()) });
  }
  let timer = null;
  function scheduleLoad() { clearTimeout(timer); timer = setTimeout(loadView, 350); }
  async function loadView() {
    status();
    if (!ui.show || map.getZoom() < MIN_ZOOM || !SOURCES.length) return;
    const b = map.getBounds();
    const view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const jobs = [];
    SOURCES.forEach(s => {
      if (!overlaps(s.bbox, view)) return;
      tilesFor(b).forEach(([tx, ty]) => {
        const key = s.county + '|' + tx + ',' + ty;
        if (loadedTiles.has(key)) return;
        loadedTiles.add(key);
        jobs.push(fetchTile(s, tx, ty).catch(err => { loadedTiles.delete(key); console.warn('Parcels:', err.message); }));
      });
    });
    if (!jobs.length) return;
    pending += jobs.length; status();
    await Promise.all(jobs);
    pending -= jobs.length;
    trim(); pushData(); status();
  }

  // ---- Map layers ------------------------------------------------------------------
  function applyVisibility() {
    ['parcels-hit', 'parcels-casing', 'parcels-line'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', ui.show ? 'visible' : 'none');
    });
  }
  function initLayers() {
    map.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Parcels: county GIS' });
    const before = map.getLayer('hap-inactive') ? 'hap-inactive' : (map.getLayer('wind') ? 'wind' : undefined);
    map.addLayer({ id: 'parcels-hit', type: 'fill', source: 'parcels', minzoom: MIN_ZOOM, paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, before);
    map.addLayer({ id: 'parcels-casing', type: 'line', source: 'parcels', minzoom: MIN_ZOOM,
      paint: { 'line-color': 'rgba(0,0,0,.55)', 'line-width': 2.6 } }, before);
    map.addLayer({ id: 'parcels-line', type: 'line', source: 'parcels', minzoom: MIN_ZOOM,
      paint: { 'line-color': '#fff4c2', 'line-width': 1.2 } }, before);
    applyVisibility();
    resolveUrls().then(loadView);
    map.on('moveend', scheduleLoad);
  }
  window.MHM.onLoad(initLayers);

  // ---- Tap lookup (used by app.js) ----------------------------------------------------
  window.MHM.parcelAt = point => {
    if (!ui.show || !map.getLayer('parcels-hit') || map.getZoom() < MIN_ZOOM) return null;
    const hit = map.queryRenderedFeatures(point, { layers: ['parcels-hit'] });
    return hit.length ? hit[0].properties : null;
  };
  window.MHM.parcelHtml = p => {
    const s = SOURCES.find(x => x.county === p._c) || {};
    const v = k => (k && p[k] != null && String(p[k]).trim() !== '' ? String(p[k]).trim() : '');
    const n = +v(s.acres);
    const acres = v(s.acres) && isFinite(n) ? (n > 0 ? n.toFixed(n < 10 ? 2 : 1) + ' acres' : '') : v(s.acres); // some counties store 0 for town lots
    return '<div class="parcel-block"><h4>' + esc(v(s.owner) || 'Private parcel') + '</h4>' +
      '<dl>' +
      (v(s.pin) ? '<dt>Parcel #</dt><dd>' + esc(v(s.pin)) + '</dd>' : '') +
      (acres ? '<dt>Size</dt><dd>' + esc(acres) + '</dd>' : '') +
      (v(s.address) ? '<dt>Address</dt><dd>' + esc(v(s.address)) + '</dd>' : '') +
      '<dt>County</dt><dd>' + esc(p._c) + '</dd>' +
      '</dl>' +
      (!v(s.owner) ? '<div class="hint">' + esc(p._c) + ' County does not share owner names in its free data.</div>' : '') +
      (s.note ? '<div class="hint">' + esc(s.note) + '</div>' : '') +
      '<div class="hint">From ' + esc(p._c) + ' County GIS. Lines are approximate and ownership can be out of date; ask permission before hunting private land.</div></div>';
  };

  // ---- Panel ---------------------------------------------------------------------------
  function status() {
    const el = $('parcelStatus');
    if (!el) return;
    if (!SOURCES.length) { el.textContent = 'No counties added yet.'; return; }
    if (!ui.show) { el.textContent = SOURCES.length + ' counties available.'; return; }
    if (map.getZoom() < MIN_ZOOM) { el.textContent = 'Zoom in closer to see parcel lines.'; return; }
    el.textContent = pending ? 'Loading parcels...' : 'Showing parcels for this area (' + features.size + ' loaded).';
  }
  $('chkParcels').checked = ui.show;
  $('chkParcels').addEventListener('change', e => { ui.show = e.target.checked; saveUi(); applyVisibility(); loadView(); });
  $('parcelCounties').textContent = SOURCES.length
    ? 'Counties: ' + SOURCES.map(s => s.county + (s.owner ? '' : '*')).join(', ') + (SOURCES.some(s => !s.owner) ? '. * = no owner names.' : '.')
    : '';
  map.on('zoomend', status);
  status();
  // For tests and the console.
  window.MHM.parcels = { sources: SOURCES, stats: () => ({ loaded: features.size, tiles: loadedTiles.size, pending }), sample: () => features.values().next().value };
})();
