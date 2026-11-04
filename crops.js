// Michigan Hunting Map - Crop fields (a bonus, off by default).
// This file is only downloaded when "Crop fields" is switched on under Layers > Extras, and
// switching it off removes everything it added. Data: the USDA NASS Cropland Data Layer, a
// yearly crop map made from satellite images (10 m for 2024 on, 30 m before), served by the
// USDA's CroplandCROS image service. Only farm classes are drawn, so woods, water and towns
// stay clear. Tapping the map adds the spot's crop history to the land popup.

(function () {
  'use strict';
  const { map, esc, $ } = window.MHM;

  const B = 'https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer';
  const KEY = 'mhm.crops.v1';
  const FIRST_YEAR = 2008; // first year with the whole state at 30 m

  // USDA class code: [name, color]. Names shortened where the USDA one is cryptic.
  const C = {1:['Corn','ffd300'],2:['Cotton','ff2626'],3:['Rice','00a8e4'],4:['Sorghum','ff9e0b'],5:['Soybeans','267000'],6:['Sunflower','ffff00'],10:['Peanuts','70a500'],11:['Tobacco','00af4b'],12:['Sweet Corn','dda50b'],13:['Popcorn','dda50b'],14:['Mint','7ed3ff'],21:['Barley','e2007c'],22:['Durum Wheat','896254'],23:['Spring Wheat','d8b56b'],24:['Winter Wheat','a57000'],25:['Other Small Grains','d69ebc'],26:['Wheat, then soybeans','707000'],27:['Rye','ac007c'],28:['Oats','a05989'],29:['Millet','700049'],30:['Speltz','d69ebc'],31:['Canola','d1ff00'],32:['Flaxseed','7e99ff'],33:['Safflower','d6d600'],34:['Rape Seed','d1ff00'],35:['Mustard','00af4b'],36:['Alfalfa','ffa5e2'],37:['Hay','a5f28c'],38:['Camelina','00af4b'],39:['Buckwheat','d69ebc'],41:['Sugarbeets','a800e4'],42:['Dry Beans','a50000'],43:['Potatoes','702600'],44:['Other Crops','00af4b'],45:['Sugarcane','b17eff'],46:['Sweet Potatoes','702600'],47:['Vegetables / fruit','ff6666'],48:['Watermelons','ff6666'],49:['Onions','ffcc66'],50:['Cucumbers','ff6666'],51:['Chick Peas','00af4b'],52:['Lentils','00ddaf'],53:['Peas','54ff00'],54:['Tomatoes','f2a377'],55:['Caneberries','ff6666'],56:['Hops','00af4b'],57:['Herbs','7ed3ff'],58:['Clover / wildflowers','e8bfff'],59:['Sod / grass seed','afffdd'],60:['Switchgrass','00af4b'],61:['Fallow / idle field','bfbf77'],63:['Woods','93cc93'],64:['Brush / shrubland','c6d69e'],65:['Barren','ccbfa3'],66:['Cherries','ff00ff'],67:['Peaches','ff8eaa'],68:['Apples','ba004f'],69:['Grapes','704489'],70:['Christmas Trees','007777'],71:['Other Tree Crops','b19a70'],72:['Citrus','ffff7e'],74:['Pecans','b5705b'],75:['Almonds','00a582'],76:['Walnuts','e9d6af'],77:['Pears','b19a70'],81:['No data','f2f2f2'],82:['Developed','9a9a9a'],83:['Water','4b70a3'],87:['Wetland','7eb1b1'],88:['Non-farm','e8ffbf'],92:['Aquaculture','00ffff'],111:['Water','4b70a3'],112:['Ice / snow','d3e2f9'],121:['Developed (lawns, roads)','9a9a9a'],122:['Developed','9a9a9a'],123:['Developed','9a9a9a'],124:['Developed','9a9a9a'],131:['Barren','ccbfa3'],141:['Woods','93cc93'],142:['Pine / evergreen woods','93cc93'],143:['Woods','93cc93'],152:['Brush / shrubland','c6d69e'],176:['Grass / pasture','e8ffbf'],190:['Wooded wetland','7eb1b1'],195:['Marsh / wetland','7eb1b1'],204:['Pistachios','00ff8c'],205:['Triticale','d69ebc'],206:['Carrots','ff6666'],207:['Asparagus','ff6666'],208:['Garlic','ff6666'],209:['Cantaloupes','ff6666'],210:['Prunes','ff8eaa'],211:['Olives','334933'],212:['Oranges','e47026'],213:['Honeydew Melons','ff6666'],214:['Broccoli','ff6666'],215:['Avocados','66994c'],216:['Peppers','ff6666'],217:['Pomegranates','b19a70'],218:['Nectarines','ff8eaa'],219:['Greens','ff6666'],220:['Plums','ff8eaa'],221:['Strawberries','ff6666'],222:['Squash','ff6666'],223:['Apricots','ff8eaa'],224:['Vetch','00af4b'],225:['Wheat, then corn','ffd300'],226:['Oats, then corn','ffd300'],227:['Lettuce','ff6666'],228:['Triticale, then corn','ffd200'],229:['Pumpkins','ff6666'],230:['Lettuce, then wheat','896254'],231:['Lettuce, then melons','ff6666'],232:['Lettuce, then cotton','ff2626'],233:['Lettuce, then barley','e2007c'],234:['Wheat, then sorghum','ff9e0b'],235:['Barley, then sorghum','ff9e0b'],236:['Wheat, then sorghum','a57000'],237:['Barley, then corn','ffd300'],238:['Wheat, then cotton','a57000'],239:['Soybeans, then cotton','267000'],240:['Soybeans, then oats','267000'],241:['Corn, then soybeans','ffd300'],242:['Blueberries','000099'],243:['Cabbage','ff6666'],244:['Cauliflower','ff6666'],245:['Celery','ff6666'],246:['Radishes','ff6666'],247:['Turnips','ff6666'],248:['Eggplants','ff6666'],249:['Gourds','ff6666'],250:['Cranberries','ff6666'],254:['Barley, then soybeans','267000']};
  const LEGEND = [1, 5, 24, 36, 37, 42, 41, 28, 43, 70, 66, 68, 242, 61];
  const isCrop = v => (v >= 1 && v <= 61) || (v >= 66 && v <= 77) || v >= 204;
  const name = v => (C[v] ? C[v][0] : isCrop(v) ? 'Other crop' : 'Not farmed');
  const color = v => '#' + (C[v] ? C[v][1] : '888888');

  let ui = load(), years = [], live = false, offError = null;
  function load() { try { return Object.assign({ year: 0, opacity: 70 }, JSON.parse(localStorage.getItem(KEY))); } catch (e) { return { year: 0, opacity: 70 }; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(load(), { year: ui.year, opacity: ui.opacity }))); } catch (e) { /* storage blocked */ } }

  // Only farm classes get a color; everything else comes back see-through.
  const RULE = JSON.stringify({ rasterFunction: 'Colormap', outputPixelType: 'U8', rasterFunctionArguments: {
    Colormap: Object.keys(C).map(Number).filter(isCrop).map(v => [v].concat(C[v][1].match(/../g).map(h => parseInt(h, 16)))) } });
  const enc = encodeURIComponent;
  const tiles = y => B + '/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true' +
    '&mosaicRule=' + enc(JSON.stringify({ where: 'Year=' + y })) + '&renderingRule=' + enc(RULE) + '&f=image';

  // ---- Panel --------------------------------------------------------------------------
  const box = $('cropBox');
  function status(msg) { const s = $('cropStatus'); if (s) s.textContent = msg; }
  function buildBox() {
    const list = years.length ? years : [new Date().getFullYear() - 1];
    box.innerHTML =
      '<div class="crop-ctl"><label>Year <select id="cropYear">' + list.map(y => '<option' + (y === ui.year ? ' selected' : '') + '>' + y + '</option>').join('') + '</select></label>' +
      '<div class="slider" style="padding:0;flex:1"><span>Fill</span><input type="range" id="cropOpacity" min="20" max="100" value="' + ui.opacity + '" aria-label="Crop fill opacity"><span id="cropOpacityVal">' + ui.opacity + '%</span></div></div>' +
      '<div class="crop-legend" aria-hidden="true">' + LEGEND.map(v => '<span><i style="background:' + color(v) + '"></i>' + esc(name(v)) + '</span>').join('') + '</div>' +
      '<p class="small" id="cropStatus">Zoom in to see fields. Tap a field for its crop history.</p>';
    $('cropYear').addEventListener('change', e => { ui.year = +e.target.value; save(); addLayer(); });
    $('cropOpacity').addEventListener('input', e => {
      ui.opacity = +e.target.value; $('cropOpacityVal').textContent = ui.opacity + '%'; save();
      if (map.getLayer('crops')) map.setPaintProperty('crops', 'raster-opacity', ui.opacity / 100);
    });
    box.hidden = false;
  }

  // ---- Map layer ----------------------------------------------------------------------
  function removeLayer() {
    if (map.getLayer('crops')) map.removeLayer('crops');
    if (map.getSource('crops')) map.removeSource('crops');
  }
  function addLayer() {
    if (!live) return;
    removeLayer();
    map.addSource('crops', { type: 'raster', tiles: [tiles(ui.year)], tileSize: 512, minzoom: 8, maxzoom: 15,
      attribution: 'Crops: USDA NASS Cropland Data Layer' });
    // Just above the base map, under contours, public land, parcels and pins.
    const above = map.getStyle().layers.find(l => !/^base-/.test(l.id) && l.type !== 'background');
    map.addLayer({ id: 'crops', type: 'raster', source: 'crops', minzoom: 8,
      paint: { 'raster-opacity': ui.opacity / 100, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, above && above.id);
  }
  function onError(e) { if (e && e.sourceId === 'crops') status('The USDA crop map is not answering right now. Try again later.'); }

  // ---- Tap: crop history for the land popup -------------------------------------------
  async function history(lng, lat) {
    const url = B + '/identify?geometry=' + enc(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } })) +
      '&geometryType=esriGeometryPoint&returnCatalogItems=true&returnGeometry=false&f=json';
    const res = await fetch(url);
    if (!res.ok) throw new Error('USDA answered ' + res.status);
    const j = await res.json();
    const vals = (j.properties && j.properties.Values) || [];
    const items = (j.catalogItems && j.catalogItems.features) || [];
    const byYear = {};
    // Values line up with the catalog items; the newest image wins where a year has two.
    items.forEach((f, i) => { const v = parseInt(vals[i], 10), y = f.attributes.Year; if (y >= FIRST_YEAR && v > 0 && !(y in byYear)) byYear[y] = v; });
    return Object.keys(byYear).map(Number).sort((a, b) => b - a).map(y => ({ y, v: byYear[y] }));
  }
  // A plain guess from the rotation: same crop 3+ years running, or a two-crop swap.
  function guess(h) {
    const v = h.map(x => x.v);
    if (h.length < 3 || !isCrop(v[0])) return null;
    let run = 1; while (run < v.length && v[run] === v[0]) run++;
    if (run >= 3) return { v: v[0], why: name(v[0]).toLowerCase() + ' ' + run + ' years running' };
    if (v[1] !== v[0] && isCrop(v[1]) && v[2] === v[0] && (v.length < 4 || v[3] === v[1]))
      return { v: v[1], why: 'it has been switching between ' + name(v[0]).toLowerCase() + ' and ' + name(v[1]).toLowerCase() };
    return null;
  }
  function render(el, h) {
    if (!h.length) { el.innerHTML = '<h4>Crops here</h4><div class="hint">No USDA crop data for this spot.</div>'; return; }
    const runs = [];
    h.slice(0, 12).forEach(x => { const r = runs[runs.length - 1]; if (r && r.v === x.v) r.from = x.y; else runs.push({ v: x.v, from: x.y, to: x.y }); });
    const now = new Date().getFullYear(), g = h[0].y < now ? guess(h) : null;
    el.innerHTML = '<h4>Crops here</h4>' +
      (g ? '<div class="crop-guess">Likely in ' + now + ': <b>' + esc(name(g.v)) + '</b> <small>(' + esc(g.why) + ')</small></div>' : '') +
      '<ul class="crop-hist">' + runs.map(r => '<li><i style="background:' + color(r.v) + '"></i><span>' + (r.from === r.to ? r.to : r.from + '–' + r.to) + '</span>' + esc(name(r.v)) + '</li>').join('') + '</ul>' +
      '<div class="hint">USDA satellite crop map. Usually right for corn and soybeans, often wrong for hay and pasture. ' +
      (h[0].y < now ? now + ' comes out early ' + (now + 1) + '.' : '') + '</div>';
  }
  function cropPop(lngLat) {
    const el = document.createElement('div');
    el.className = 'pop crop-pop';
    el.innerHTML = '<h4>Crops here</h4><div class="hint">Looking up crop history...</div>';
    history(lngLat.lng, lngLat.lat).then(h => render(el, h))
      .catch(() => { el.innerHTML = '<h4>Crops here</h4><div class="hint">Could not reach the USDA crop map.</div>'; });
    return el;
  }

  // ---- On / off -----------------------------------------------------------------------
  async function loadYears() {
    try {
      const j = await (await fetch(B + '/query?where=' + enc('Year>=' + FIRST_YEAR) + '&outFields=Year&returnGeometry=false&f=json')).json();
      years = Array.from(new Set((j.features || []).map(f => f.attributes.Year))).sort((a, b) => b - a);
    } catch (e) { years = []; }
    if (!years.length) for (let y = new Date().getFullYear() - 1; y >= FIRST_YEAR; y--) years.push(y);
    if (years.indexOf(ui.year) < 0) ui.year = years[0];
  }
  async function on() {
    if (live) return;
    live = true;
    window.MHM.cropPop = cropPop;
    box.hidden = false; box.innerHTML = '<p class="small">Loading crop map...</p>';
    await loadYears();
    if (!live) return; // switched off while loading
    buildBox();
    offError = onError; map.on('error', offError);
    window.MHM.onLoad(addLayer);
  }
  function off() {
    live = false;
    window.MHM.cropPop = null;
    removeLayer();
    if (offError) { map.off('error', offError); offError = null; }
    box.hidden = true; box.innerHTML = '';
  }

  window.MHM.crops = { on, off, history, guess };
  on();
})();
