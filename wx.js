// Wind and weather: the Layers tab's "Wind" and "Weather" tree, one shared forecast time
// (both sliders move together), scent cones at pins, and the weather chip at the top right.
// Forecasts come from Open-Meteo (free, no key; NOAA models in the US).
// Observed wind (station arrows) lives in app.js; Wind flow is windflow.js (loaded when on).

(function () {
  'use strict';
  const { map, esc, $ } = window.MHM;
  const KEY = 'mhm.wx.v1';
  const pref = (() => { try { return Object.assign({ cones: false, weather: true }, JSON.parse(localStorage.getItem(KEY))); } catch (e) { return { cones: false, weather: true }; } })();
  const savePref = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) { /* storage blocked */ } };
  const HOURS = 48;
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  const API = 'https://api.open-meteo.com/v1/forecast';

  // ---- Shared forecast time ------------------------------------------------------------------------
  // hour 0 = this hour. time() is the unix time (s) the sliders point at; data arrays are indexed
  // by time, so a forecast fetched an hour ago still lines up.
  const listeners = [];
  const fc = {
    hour: 0,
    time() { const now = new Date(); now.setMinutes(0, 0, 0); return now.getTime() / 1000 + fc.hour * 3600; },
    label(short) {
      if (!fc.hour) return 'Now';
      const t = new Date(fc.time() * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric' });
      return short ? t : t + ' (+' + fc.hour + ' h)';
    },
    set(h) { fc.hour = Math.max(0, Math.min(HOURS - 1, h | 0)); syncSliders(); listeners.forEach(fn => { try { fn(fc.hour); } catch (e) { console.error(e); } }); },
    on(fn) { listeners.push(fn); },
    // Index into an Open-Meteo hourly time array for the slider's time (null if out of range).
    index(times) { if (!times || !times.length) return null; const i = Math.round((fc.time() - times[0]) / 3600); return i >= 0 && i < times.length ? i : null; },
  };
  window.MHM.fc = fc;
  const SLIDERS = ['fcHourWind', 'fcHourWx'];
  function syncSliders() {
    SLIDERS.forEach(id => { const s = $(id); if (s && +s.value !== fc.hour) s.value = String(fc.hour); });
    document.querySelectorAll('.fc-when').forEach(el => { el.textContent = fc.label(); });
  }
  SLIDERS.forEach(id => $(id).addEventListener('input', e => fc.set(+e.target.value)));
  syncSliders();
  // Keep "Now" honest when the clock rolls into a new hour.
  setInterval(() => { if (!fc.hour) syncSliders(); }, 5 * 60e3);

  // ---- Tree: Wind node's checkbox follows its three branches ------------------------------------------
  const WIND_KIDS = ['chkWind', 'chkCones', 'chkWindFlow'];
  function tickWind() {
    const on = WIND_KIDS.filter(id => $(id).checked).length;
    $('grp-wind').checked = on === WIND_KIDS.length; $('grp-wind').indeterminate = on > 0 && on < WIND_KIDS.length;
    $('cnt-wind').textContent = on === WIND_KIDS.length ? '' : on + ' of ' + WIND_KIDS.length;
  }
  WIND_KIDS.forEach(id => $(id).addEventListener('change', tickWind));
  $('grp-wind').addEventListener('change', e => {
    WIND_KIDS.forEach(id => { const b = $(id); if (b.checked !== e.target.checked) { b.checked = e.target.checked; b.dispatchEvent(new Event('change')); } });
    tickWind();
  });
  document.querySelectorAll('#wxSec .twisty').forEach(b => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    $(b.getAttribute('aria-controls')).hidden = !open;
  }));

  // ---- Colors (same breaks as the station arrows and Wind flow) --------------------------------------
  const RAMP = [[0, [70, 120, 200]], [4, [90, 170, 220]], [8, [110, 200, 110]], [15, [250, 210, 60]], [25, [245, 130, 40]], [35, [220, 40, 40]], [50, [150, 40, 160]]];
  function color(mph) {
    for (let i = 1; i < RAMP.length; i++) if (mph <= RAMP[i][0]) {
      const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (mph - a) / (b - a);
      return 'rgb(' + ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(',') + ')';
    }
    return 'rgb(150,40,160)';
  }

  // ---- Wind cones at pins ----------------------------------------------------------------------------
  // Each visible pin gets a cone pointing downwind (where its scent goes). Longer with more wind;
  // wide when light (scent wanders), narrow when strong. Under 2 mph it's a small circle.
  const ptKey = (lng, lat) => lng.toFixed(2) + ',' + lat.toFixed(2); // ~1 km cells share a forecast
  const pointWx = new Map(); // key -> { times, spd, dir, gust, at }
  let coneTimer = null, coneBusy = false;
  function visiblePins() {
    const P = window.MHM.pins && window.MHM.pins.data;
    if (!P) return [];
    const shown = new Set(P.folders.filter(f => f.visible !== false).map(f => f.id));
    const b = map.getBounds(), padX = (b.getEast() - b.getWest()) * 0.25, padY = (b.getNorth() - b.getSouth()) * 0.25;
    const c = map.getCenter();
    return P.pins.filter(p => shown.has(p.folder) && p.lng > b.getWest() - padX && p.lng < b.getEast() + padX && p.lat > b.getSouth() - padY && p.lat < b.getNorth() + padY)
      .sort((a, z) => Math.hypot(a.lng - c.lng, a.lat - c.lat) - Math.hypot(z.lng - c.lng, z.lat - c.lat)).slice(0, 80);
  }
  async function fetchPoints(keys) {
    for (let i = 0; i < keys.length; i += 50) {
      const part = keys.slice(i, i + 50), ll = part.map(k => k.split(','));
      const url = API + '?latitude=' + ll.map(x => x[1]).join(',') + '&longitude=' + ll.map(x => x[0]).join(',') +
        '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph&forecast_hours=' + HOURS + '&timeformat=unixtime&timezone=GMT';
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status === 429 ? 'busy' : 'answered ' + res.status);
      let j = await res.json(); if (!Array.isArray(j)) j = [j];
      j.forEach((loc, n) => { const H = loc.hourly; pointWx.set(part[n], { times: H.time, spd: H.wind_speed_10m, dir: H.wind_direction_10m, gust: H.wind_gusts_10m, at: Date.now() }); });
    }
  }
  function destination(lng, lat, bearingDeg, meters) {
    const R = 6371008.8, d = meters / R, br = bearingDeg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
    const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [+(l2 * 180 / Math.PI).toFixed(6), +(p2 * 180 / Math.PI).toFixed(6)];
  }
  function coneFeature(p, w) {
    const i = fc.index(w.times);
    if (i == null || w.spd[i] == null || w.dir[i] == null) return null;
    const mph = w.spd[i], from = w.dir[i], gust = w.gust[i] || 0;
    const props = { mph: Math.round(mph), gust: Math.round(gust), from: compass(from), dir: from, name: p.name || '', color: color(mph) };
    let ring;
    if (mph < 2) {
      ring = []; for (let a = 0; a <= 360; a += 30) ring.push(destination(p.lng, p.lat, a, 45));
      props.calm = true;
    } else {
      const len = Math.min(900, 90 + 32 * mph), half = Math.max(12, Math.min(40, 42 - 1.6 * mph)), down = (from + 180) % 360;
      ring = [[p.lng, p.lat]];
      for (let a = -half; a <= half + 0.01; a += half / 6) ring.push(destination(p.lng, p.lat, down + a, len));
      ring.push([p.lng, p.lat]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props };
  }
  function drawCones() {
    const src = map.getSource('wind-cones');
    if (!src) return;
    if (!pref.cones) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
    const feats = visiblePins().map(p => { const w = pointWx.get(ptKey(p.lng, p.lat)); return w && coneFeature(p, w); }).filter(Boolean);
    src.setData({ type: 'FeatureCollection', features: feats });
  }
  async function refreshCones() {
    if (!pref.cones || coneBusy) return;
    const pins = visiblePins();
    const need = [...new Set(pins.map(p => ptKey(p.lng, p.lat)))].filter(k => { const w = pointWx.get(k); return !w || Date.now() - w.at > 60 * 60e3 || fc.index(w.times) == null; });
    const P = window.MHM.pins && window.MHM.pins.data;
    $('coneStatus').textContent = !P || !P.pins.length ? 'Add pins to see their wind cones.' : !pins.length ? 'No pins on screen.' : '';
    if (need.length) {
      coneBusy = true; $('coneStatus').textContent = 'Loading wind for ' + need.length + ' spot' + (need.length === 1 ? '' : 's') + '...';
      try { await fetchPoints(need); $('coneStatus').textContent = ''; }
      catch (err) { console.warn('Wind cones:', err.message); $('coneStatus').textContent = err.message === 'busy' ? 'The forecast service is busy. Try again later.' : 'Could not load wind for the pins. Check your connection.'; }
      finally { coneBusy = false; }
    }
    drawCones();
  }
  const scheduleCones = () => { clearTimeout(coneTimer); coneTimer = setTimeout(refreshCones, 600); };
  function initCones() {
    map.addSource('wind-cones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Forecast: Open-Meteo' });
    const before = map.getLayer('shapes-fill') ? 'shapes-fill' : map.getLayer('pins') ? 'pins' : undefined;
    map.addLayer({ id: 'wind-cones-fill', type: 'fill', source: 'wind-cones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.38 } }, before);
    // Dark edge under the colored one so cones show on imagery and on light topo alike.
    map.addLayer({ id: 'wind-cones-casing', type: 'line', source: 'wind-cones', paint: { 'line-color': 'rgba(0,0,0,0.7)', 'line-width': 3.4 } }, before);
    map.addLayer({ id: 'wind-cones-line', type: 'line', source: 'wind-cones', paint: { 'line-color': ['get', 'color'], 'line-width': 1.8 } }, before);
    map.on('moveend', () => { if (pref.cones) scheduleCones(); });
    // Pins added, moved, hidden or synced: the pins source gets new data.
    map.on('sourcedata', e => { if (pref.cones && e.sourceId === 'pins' && e.sourceDataType !== 'metadata') scheduleCones(); });
    if (pref.cones) refreshCones();
  }
  window.MHM.onLoad(initCones);
  $('chkCones').checked = pref.cones;
  $('chkCones').addEventListener('change', e => { pref.cones = e.target.checked; savePref(); $('coneStatus').textContent = ''; if (pref.cones) refreshCones(); else drawCones(); });
  fc.on(() => { if (pref.cones) refreshCones(); });
  // Tap inside a cone: app.js adds this to the popup.
  window.MHM.conePop = (lngLat, point) => {
    if (!pref.cones || !map.getLayer('wind-cones-fill')) return null;
    const hit = map.queryRenderedFeatures(point, { layers: ['wind-cones-fill'] })[0];
    if (!hit) return null;
    const p = hit.properties, el = document.createElement('div');
    el.className = 'pop crop-pop';
    el.innerHTML = '<div class="crop-guess"><b>Wind cone' + (p.name ? ': ' + esc(p.name) : '') + '</b> (' + esc(fc.label(true)) + ')<br>' +
      (p.calm ? 'Calm: scent pools and drifts around the pin.' : 'From ' + esc(p.from) + ' ' + p.mph + ' mph' + (p.gust > p.mph + 3 ? ', gusts ' + p.gust : '') +
        '. Scent carries toward ' + esc(compass((+p.dir + 180) % 360)) + '.') + '</div>';
    return el;
  };

  // ---- Weather chip (top right) ------------------------------------------------------------------------
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4.5" fill="#f5b400"/><g stroke="#f5b400" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g>',
    moon: '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z" fill="#c9cfe6"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 18z" fill="#aeb6c2"/>',
  };
  const partly = '<circle cx="8.5" cy="8.5" r="3.6" fill="#f5b400"/><path d="M8 19h9.5a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.2A3 3 0 0 0 8 19z" fill="#aeb6c2"/>';
  const partlyNight = '<path d="M11 3.5a5.5 5.5 0 1 0 2.2 9.6 4.5 4.5 0 0 1-2.2-9.6z" fill="#c9cfe6"/><path d="M8 20h9.5a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.2A3 3 0 0 0 8 20z" fill="#aeb6c2"/>';
  const cloudTop = '<path d="M7 14h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.2A3 3 0 0 0 7 14z" fill="#9aa3b0"/>';
  const rain = cloudTop + '<g stroke="#3d8bfd" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 16.5l-1 3M12.5 16.5l-1 3M16.5 16.5l-1 3"/></g>';
  const snow = cloudTop + '<g fill="#5aa9e6"><circle cx="8" cy="18" r="1.3"/><circle cx="12" cy="20" r="1.3"/><circle cx="16" cy="18" r="1.3"/></g>';
  const storm = cloudTop + '<path d="M12.5 14l-3 5h2.5l-1 4 4-6h-2.6l1.6-3z" fill="#f5b400"/>';
  const fog = '<g stroke="#aeb6c2" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M6 13h12M4 17h16"/></g>';
  // WMO weather codes -> [text, icon by day, icon by night]
  function sky(code) {
    if (code === 0) return ['Clear', ICONS.sun, ICONS.moon];
    if (code === 1) return ['Mostly clear', ICONS.sun, ICONS.moon];
    if (code === 2) return ['Partly cloudy', partly, partlyNight];
    if (code === 3) return ['Cloudy', ICONS.cloud, ICONS.cloud];
    if (code === 45 || code === 48) return ['Fog', fog, fog];
    if (code >= 51 && code <= 57) return [code >= 56 ? 'Freezing drizzle' : 'Drizzle', rain, rain];
    if (code >= 61 && code <= 67) return [code >= 66 ? 'Freezing rain' : code === 65 ? 'Heavy rain' : 'Rain', rain, rain];
    if (code >= 71 && code <= 77) return [code === 75 ? 'Heavy snow' : 'Snow', snow, snow];
    if (code >= 80 && code <= 82) return ['Rain showers', rain, rain];
    if (code === 85 || code === 86) return ['Snow showers', snow, snow];
    if (code >= 95) return ['Thunderstorms', storm, storm];
    return ['', ICONS.cloud, ICONS.cloud];
  }
  const svg = inner => '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' + inner + '</svg>';

  // The chip sits first in the top-right control column, above zoom.
  const holder = document.createElement('div');
  holder.className = 'maplibregl-ctrl wx-holder';
  holder.innerHTML = '<button type="button" class="wx-chip" id="wxChip" aria-expanded="false" aria-controls="wxCard" title="Weather at the map center">' +
    '<span id="wxIcon">' + svg(ICONS.cloud) + '</span><b id="wxTemp">--</b><small id="wxWhenChip"></small></button>';
  const card = document.createElement('div');
  card.className = 'wx-card'; card.id = 'wxCard'; card.hidden = true;
  document.body.appendChild(card);
  function placeChip() {
    const tr = document.querySelector('.maplibregl-ctrl-top-right');
    if (tr && holder.parentNode !== tr) tr.insertBefore(holder, tr.firstChild);
  }
  placeChip();
  let wx = null, wxAt = null, wxBusy = false, wxTimer = null;
  function renderWx() {
    holder.hidden = !pref.weather;
    if (!pref.weather) { card.hidden = true; return; }
    const i = wx ? fc.index(wx.times) : null;
    $('wxWhenChip').textContent = fc.hour ? '+' + fc.hour + 'h' : '';
    if (i == null) { $('wxTemp').textContent = '--'; card.innerHTML = '<p class="small">Loading weather...</p>'; return; }
    const H = wx, s = sky(H.code[i]), day = H.isDay[i] !== 0;
    $('wxIcon').innerHTML = svg(day ? s[1] : s[2]);
    $('wxTemp').textContent = Math.round(H.temp[i]) + '°';
    const wind = H.spd[i] < 2 ? 'Calm' : 'From ' + compass(H.dir[i]) + ' ' + Math.round(H.spd[i]) + ' mph' + (H.gust[i] > H.spd[i] + 3 ? ', gusts ' + Math.round(H.gust[i]) : '');
    card.innerHTML = '<div class="wx-head">' + svg(day ? s[1] : s[2]) + '<div><b>' + esc(s[0] || 'Weather') + ', ' + Math.round(H.temp[i]) + '°F</b><small>' + esc(fc.label()) + ' · map center</small></div>' +
      '<button type="button" class="close" id="wxClose" aria-label="Close weather">&times;</button></div>' +
      '<dl><dt>Feels like</dt><dd>' + Math.round(H.feels[i]) + '°F</dd>' +
      '<dt>Rain/snow</dt><dd>' + (H.pop[i] != null ? H.pop[i] + '% chance' : '') + (H.precip[i] > 0 ? ', ' + H.precip[i].toFixed(2) + ' in' : '') + '</dd>' +
      '<dt>Wind</dt><dd>' + esc(wind) + '</dd>' +
      '<dt>Clouds</dt><dd>' + Math.round(H.cloud[i]) + '%</dd>' +
      '<dt>Humidity</dt><dd>' + Math.round(H.rh[i]) + '%</dd></dl>' +
      '<p class="small">Forecast from Open-Meteo (NOAA models). Change the time with the slider in Layers &gt; Wind and weather.</p>';
    $('wxClose').addEventListener('click', () => toggleCard(false));
  }
  async function fetchWx() {
    if (!pref.weather || wxBusy) return;
    const c = map.getCenter();
    if (wx && wxAt && Date.now() - wx.at < 30 * 60e3 && Math.hypot(c.lng - wxAt[0], (c.lat - wxAt[1]) * 1.4) < 0.08 && fc.index(wx.times) != null) { renderWx(); return; }
    wxBusy = true;
    try {
      const url = API + '?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lng.toFixed(3) +
        '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day' +
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_hours=' + HOURS + '&timeformat=unixtime&timezone=GMT';
      const res = await fetch(url);
      if (!res.ok) throw new Error('answered ' + res.status);
      const H = (await res.json()).hourly;
      wx = { times: H.time, temp: H.temperature_2m, feels: H.apparent_temperature, pop: H.precipitation_probability, precip: H.precipitation, code: H.weather_code,
        cloud: H.cloud_cover, rh: H.relative_humidity_2m, spd: H.wind_speed_10m, dir: H.wind_direction_10m, gust: H.wind_gusts_10m, isDay: H.is_day, at: Date.now() };
      wxAt = [c.lng, c.lat];
    } catch (err) { console.warn('Weather:', err.message); }
    finally { wxBusy = false; }
    renderWx();
  }
  function toggleCard(open) {
    card.hidden = !open;
    $('wxChip').setAttribute('aria-expanded', String(open));
  }
  $('wxChip').addEventListener('click', () => toggleCard(card.hidden));
  map.on('moveend', () => { clearTimeout(wxTimer); wxTimer = setTimeout(fetchWx, 800); });
  setInterval(() => { if (pref.weather && !document.hidden) fetchWx(); }, 30 * 60e3);
  $('chkWeather').checked = pref.weather;
  $('chkWeather').addEventListener('change', e => { pref.weather = e.target.checked; savePref(); renderWx(); if (pref.weather) fetchWx(); });
  fc.on(() => { renderWx(); if (pref.weather && wx && fc.index(wx.times) == null) fetchWx(); });
  window.MHM.onLoad(() => { placeChip(); fetchWx(); });
  renderWx();
  tickWind();
})();
