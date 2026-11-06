// Extras > Wind flow: forecast wind drawn as moving streaks over a speed-colored wash,
// with a slider for the next 48 hours. Loaded only when switched on (app.js); off()
// removes everything. Data: Open-Meteo forecast API (free, no key; NOAA models in the US),
// asked for a 10 x 10 grid over the area on screen. It is a forecast, not a measurement;
// the station arrows (Observed wind) show what was actually measured.

(function () {
  'use strict';
  const { map, esc, $ } = window.MHM;

  const N = 10;                 // grid points per side
  const HOURS = 48;
  const MIN_GAP = 4000;         // ms between requests while panning
  const MAX_AGE = 60 * 60e3;    // refetch after an hour
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  // Speed colors (mph), same breaks as the station arrows, with calm and 30+ added.
  const RAMP = [[0, [70, 120, 200]], [4, [90, 170, 220]], [8, [110, 200, 110]], [15, [250, 210, 60]], [25, [245, 130, 40]], [35, [220, 40, 40]], [50, [150, 40, 160]]];
  const LEGEND = [['Calm', 0], ['8', 8], ['15', 15], ['25', 25], ['35+', 35]];

  let on = false, grid = null, hour = 0, fetching = false, lastFetch = 0, moveTimer = null;
  let shade = null, trails = null, raf = 0, particles = [], field = null, moving = false;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Panel ---------------------------------------------------------------------------------
  const box = $('windFlowBox');
  box.innerHTML =
    '<div class="crop-ctl"><span id="wfWhen">Now</span></div>' +
    '<div class="slider" style="padding-left:0"><input type="range" id="wfHour" min="0" max="' + (HOURS - 1) + '" value="0" aria-label="Forecast hour"><span id="wfHourVal" style="min-width:34px">+0 h</span></div>' +
    '<div class="crop-legend" aria-hidden="true">' + LEGEND.map(([t, mph]) => '<span><i style="background:' + rgb(color(mph)) + '"></i>' + t + '</span>').join('') + '<span>mph</span></div>' +
    '<p class="small" id="wfStatus"></p>' +
    '<p class="small">Forecast from Open-Meteo (NOAA models), not measured. Streaks flow downwind (dark on Topo and Hybrid, white on Satellite). Pauses while you move the map.</p>';
  // Switching base maps: clear old-colored streaks and redraw in the new color.
  document.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => { if (on && !moving) rebuild(); }));
  const status = t => { $('wfStatus').textContent = t || ''; };
  $('wfHour').addEventListener('input', e => { hour = +e.target.value; labelHour(); rebuild(); });

  function labelHour() {
    $('wfHourVal').textContent = '+' + hour + ' h';
    const t = grid && grid.times[hour];
    $('wfWhen').textContent = t ? (hour === 0 ? 'Now: ' : '') + new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric' }) : 'Now';
  }

  // ---- Colors ------------------------------------------------------------------------------------
  function color(mph) {
    for (let i = 1; i < RAMP.length; i++) {
      if (mph <= RAMP[i][0]) {
        const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (mph - a) / (b - a);
        return ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
      }
    }
    return RAMP[RAMP.length - 1][1];
  }
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }

  // ---- Data --------------------------------------------------------------------------------------
  function viewBox() { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
  function covers(g, v) { return g && v[0] >= g.box[0] && v[1] >= g.box[1] && v[2] <= g.box[2] && v[3] <= g.box[3]; }
  function needFetch() {
    const v = viewBox();
    if (!grid) return true;
    if (Date.now() - grid.at > MAX_AGE) return true;
    if (!covers(grid, v)) return true;
    // Zoomed in a lot: the grid is too coarse for the view.
    return (v[2] - v[0]) < (grid.box[2] - grid.box[0]) / 6;
  }
  async function fetchGrid() {
    if (fetching || !on) return;
    const wait = MIN_GAP - (Date.now() - lastFetch);
    if (wait > 0) { clearTimeout(moveTimer); moveTimer = setTimeout(fetchGrid, wait); return; }
    fetching = true; lastFetch = Date.now();
    const v = viewBox(), padX = (v[2] - v[0]) * 0.3, padY = (v[3] - v[1]) * 0.3;
    const b = [Math.max(-180, v[0] - padX), Math.max(-85, v[1] - padY), Math.min(180, v[2] + padX), Math.min(85, v[3] + padY)];
    const lats = [], lngs = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      lngs.push((b[0] + (b[2] - b[0]) * i / (N - 1)).toFixed(4));
      lats.push((b[1] + (b[3] - b[1]) * j / (N - 1)).toFixed(4));
    }
    status('Loading forecast...');
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') + '&longitude=' + lngs.join(',') +
        '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph&forecast_hours=' + HOURS + '&timeformat=unixtime&timezone=GMT';
      const res = await fetch(url);
      if (res.status === 429) throw new Error('busy');
      if (!res.ok) throw new Error('answered ' + res.status);
      let j = await res.json();
      if (!Array.isArray(j)) j = [j];
      const times = j[0].hourly.time;
      // u/v in mph, pointing the way the wind blows (toward), per hour per grid point.
      const u = [], w = [], s = [], g = [];
      for (let h = 0; h < times.length; h++) {
        u.push(new Float32Array(N * N)); w.push(new Float32Array(N * N)); s.push(new Float32Array(N * N)); g.push(new Float32Array(N * N));
      }
      j.forEach((loc, k) => {
        const H = loc.hourly;
        for (let h = 0; h < times.length; h++) {
          const spd = H.wind_speed_10m[h], dir = H.wind_direction_10m[h];
          if (spd == null || dir == null) continue;
          const r = (dir + 180) * Math.PI / 180;
          u[h][k] = spd * Math.sin(r); w[h][k] = spd * Math.cos(r); s[h][k] = spd; g[h][k] = H.wind_gusts_10m[h] || 0;
        }
      });
      if (!on) return;
      grid = { box: b, times, u, v: w, s, g, at: Date.now() };
      hour = Math.min(hour, times.length - 1);
      $('wfHour').max = String(times.length - 1);
      labelHour();
      status('');
      rebuild();
    } catch (err) {
      console.warn('Wind flow:', err.message);
      status(err.message === 'busy' ? 'The forecast service is busy (too many requests today). Try again later.' : 'Could not load the forecast. Check your connection.');
    } finally { fetching = false; }
  }
  // Bilinear sample of the grid at lng/lat for the current hour -> [u, v, speed, gust].
  function sample(lng, lat) {
    const gr = grid, b = gr.box;
    let fx = (lng - b[0]) / (b[2] - b[0]) * (N - 1), fy = (lat - b[1]) / (b[3] - b[1]) * (N - 1);
    if (fx < 0 || fy < 0 || fx > N - 1 || fy > N - 1) return null;
    const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fy)), tx = fx - i, ty = fy - j;
    const k00 = j * N + i, k10 = k00 + 1, k01 = k00 + N, k11 = k01 + 1;
    const lerp = a => (a[k00] * (1 - tx) + a[k10] * tx) * (1 - ty) + (a[k01] * (1 - tx) + a[k11] * tx) * ty;
    const h = hour;
    return [lerp(gr.u[h]), lerp(gr.v[h]), lerp(gr.s[h]), lerp(gr.g[h])];
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  const CELL = 10; // px per field cell
  function makeCanvas(opacity) {
    const c = document.createElement('canvas');
    c.className = 'wind-flow-canvas';
    c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;opacity:' + opacity;
    const mc = map.getCanvas();
    mc.parentNode.insertBefore(c, mc.nextSibling);
    return c;
  }
  function sizeCanvases() {
    const mc = map.getCanvas(), w = mc.clientWidth, h = mc.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    [shade, trails].forEach(c => { c.style.width = w + 'px'; c.style.height = h + 'px'; });
    shade.width = Math.ceil(w / CELL); shade.height = Math.ceil(h / CELL);
    trails.width = Math.round(w * dpr); trails.height = Math.round(h * dpr);
    trails.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }
  // Screen-space vectors: px per frame for each CELL x CELL block.
  function rebuild() {
    if (!on || !grid || moving) return;
    const [w, h] = sizeCanvases();
    const cols = Math.ceil(w / CELL) + 1, rows = Math.ceil(h / CELL) + 1;
    const fx = new Float32Array(cols * rows), fy = new Float32Array(cols * rows), sp = new Float32Array(cols * rows);
    // Screen directions of east and north at the center (handles a rotated map).
    const c = map.getCenter(), p0 = map.project(c), d = 0.001;
    const pe = map.project([c.lng + d, c.lat]), pn = map.project([c.lng, c.lat + d]);
    const ex = [(pe.x - p0.x), (pe.y - p0.y)], nx = [(pn.x - p0.x), (pn.y - p0.y)];
    const le = Math.hypot(ex[0], ex[1]) || 1, ln = Math.hypot(nx[0], nx[1]) || 1;
    ex[0] /= le; ex[1] /= le; nx[0] /= ln; nx[1] /= ln;
    const img = shade.getContext('2d').createImageData(shade.width, shade.height);
    const K = 0.11; // px per frame per mph
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const ll = map.unproject([q * CELL, r * CELL]);
      const s = sample(ll.lng, ll.lat), k = r * cols + q;
      if (!s) continue;
      fx[k] = (s[0] * ex[0] + s[1] * nx[0]) * K; fy[k] = (s[0] * ex[1] + s[1] * nx[1]) * K; sp[k] = s[2];
      if (q < shade.width && r < shade.height) {
        const col = color(s[2]), o = (r * shade.width + q) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    shade.getContext('2d').putImageData(img, 0, 0);
    field = { cols, rows, fx, fy, sp, w, h };
    trails.getContext('2d').clearRect(0, 0, w, h);
    const want = Math.max(400, Math.min(2500, Math.round(w * h / 450)));
    particles = [];
    for (let i = 0; i < want; i++) particles.push(spawn({}));
    start();
  }
  // White streaks only show up on dark satellite imagery; on Topo and Hybrid they're dark.
  function streakColor() {
    const b = document.querySelector('[data-base][aria-pressed="true"]');
    return b && b.dataset.base === 'sat' ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,20,0.8)';
  }
  function spawn(p) { p.x = Math.random() * field.w; p.y = Math.random() * field.h; p.age = Math.floor(Math.random() * 80); return p; }
  function vec(x, y) {
    const f = field, q = Math.max(0, Math.min(f.cols - 2, x / CELL)), r = Math.max(0, Math.min(f.rows - 2, y / CELL));
    const i = Math.floor(q), j = Math.floor(r), tx = q - i, ty = r - j, k = j * f.cols + i;
    const L = a => (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + f.cols] * (1 - tx) + a[k + f.cols + 1] * tx) * ty;
    return [L(f.fx), L(f.fy)];
  }
  function frame() {
    raf = 0;
    if (!on || moving || !field || document.hidden) return;
    const g = trails.getContext('2d'), f = field;
    // Fade what's there, keeping the canvas see-through.
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(0, 0, f.w, f.h);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = streakColor();
    g.lineWidth = 1.3;
    g.beginPath();
    for (const p of particles) {
      const [dx, dy] = vec(p.x, p.y);
      const nx = p.x + dx, ny = p.y + dy;
      if (++p.age > 90 || nx < 0 || ny < 0 || nx > f.w || ny > f.h || (dx === 0 && dy === 0)) { spawn(p); p.age = 0; continue; }
      g.moveTo(p.x, p.y); g.lineTo(nx, ny);
      p.x = nx; p.y = ny;
    }
    g.stroke();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (reduced) { // no animation: draw a still set of short streaks instead
      const g = trails.getContext('2d'); g.strokeStyle = streakColor(); g.lineWidth = 1.3; g.beginPath();
      for (let y = 12; y < field.h; y += 28) for (let x = 12; x < field.w; x += 28) { const [dx, dy] = vec(x, y); g.moveTo(x, y); g.lineTo(x + dx * 8, y + dy * 8); }
      g.stroke(); return;
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function clearAll() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (trails) trails.getContext('2d').clearRect(0, 0, trails.width, trails.height);
    if (shade) shade.getContext('2d').clearRect(0, 0, shade.width, shade.height);
  }

  // ---- Map events ----------------------------------------------------------------------------------
  const onMoveStart = () => { moving = true; clearAll(); };
  const onMoveEnd = () => {
    moving = false;
    if (needFetch()) fetchGrid(); else rebuild();
  };
  const onResize = () => { if (!moving) rebuild(); };
  const onVis = () => { if (!document.hidden && on) start(); };

  // ---- Tap: forecast for that spot (app.js adds it to the land popup) ---------------------------------
  window.MHM.windFlowPop = lngLat => {
    if (!on || !grid) return null;
    const s = sample(lngLat.lng, lngLat.lat);
    if (!s) return null;
    const from = s[2] < 2 ? 'Calm' : COMPASS[Math.round(((Math.atan2(-s[0], -s[1]) * 180 / Math.PI) + 360) % 360 / 22.5) % 16];
    const t = grid.times[hour];
    const el = document.createElement('div');
    el.className = 'pop crop-pop';
    el.innerHTML = '<div class="crop-guess"><b>Forecast wind</b> ' + esc(t ? new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric' }) : '') + ': ' +
      esc(from === 'Calm' ? 'calm' : 'from ' + from + ' ' + Math.round(s[2]) + ' mph' + (s[3] > s[2] + 3 ? ', gusts ' + Math.round(s[3]) : '')) + '</div>';
    return el;
  };

  // ---- On / off ---------------------------------------------------------------------------------------
  function onFn() {
    if (on) return;
    on = true;
    box.hidden = false;
    shade = makeCanvas(0.38); trails = makeCanvas(1);
    shade.style.imageRendering = 'auto';
    map.on('movestart', onMoveStart); map.on('moveend', onMoveEnd); map.on('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    moving = false;
    if (needFetch()) fetchGrid(); else rebuild();
  }
  function offFn() {
    if (!on) return;
    on = false;
    box.hidden = true;
    clearAll();
    map.off('movestart', onMoveStart); map.off('moveend', onMoveEnd); map.off('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
    clearTimeout(moveTimer);
    [shade, trails].forEach(c => c && c.remove());
    shade = trails = null; field = null; particles = []; grid = null;
    status('');
  }
  window.MHM.windflow = { on: onFn, off: offFn, sample: (lng, lat) => (grid ? sample(lng, lat) : null), state: () => ({ on, grid: !!grid, hour, particles: particles.length }) };
  labelHour();
  if ($('chkWindFlow').checked) onFn();
})();
