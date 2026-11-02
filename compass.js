// Michigan Hunting Map - a view cone on your location dot showing which way the phone points.
// Uses the phone's compass, so it works standing still; with no compass (a PC) it uses the
// GPS direction of travel when moving.

(function () {
  'use strict';
  const { map, geo, getUserPos } = window.MHM;

  const el = document.createElement('div');
  el.className = 'view-cone';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<svg viewBox="0 0 120 120" width="120" height="120">' +
    '<defs><radialGradient id="coneFade" cx="60" cy="60" r="58" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#1da1f2" stop-opacity=".55"/><stop offset="1" stop-color="#1da1f2" stop-opacity="0"/></radialGradient></defs>' +
    '<path d="M60 60 L32 8 A58 58 0 0 1 88 8 Z" fill="url(#coneFade)"/></svg>';
  const cone = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
  let shown = false, heading = null, smooth = null, fromCompass = false;

  function place() {
    const pos = getUserPos();
    const dot = document.querySelector('.maplibregl-user-location-dot');
    if (!pos || !dot || heading == null) { if (shown) { cone.remove(); shown = false; } return; }
    cone.setLngLat(pos).setRotation(heading);
    if (!shown) { cone.addTo(map); shown = true; }
  }

  // Compass: smooth the reading and correct for the screen being turned sideways.
  function onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iPhone
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;        // Android
    if (h == null || isNaN(h)) return;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    h = (h + angle + 360) % 360;
    smooth = smooth == null ? h : (smooth + ((((h - smooth) % 360) + 540) % 360 - 180) * 0.25 + 360) % 360;
    heading = smooth; fromCompass = true;
    place();
  }
  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
    else window.addEventListener('deviceorientation', onOrientation);
  }
  // iPhone asks permission for the compass; that request must come from a tap.
  function askThenListen() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      D.requestPermission().then(state => { if (state === 'granted') listen(); }).catch(() => { /* no compass then */ });
    } else listen();
  }
  const geoButton = () => document.querySelector('.maplibregl-ctrl-geolocate');
  document.addEventListener('click', e => { if (geoButton() && geoButton().contains(e.target)) askThenListen(); }, true);

  geo.on('geolocate', pos => {
    listen();
    // No compass reading yet: use GPS heading while walking or driving.
    if (!fromCompass && pos.coords.heading != null && !isNaN(pos.coords.heading) && pos.coords.speed > 0.5) heading = pos.coords.heading;
    place();
  });
  ['trackuserlocationend', 'trackuserlocationstart', 'error'].forEach(n => geo.on(n, () => setTimeout(place, 0)));
  // Stand-in so the compass can be checked without a phone.
  window.MHM.setHeadingForTest = h => { heading = h; fromCompass = true; place(); };
})();
