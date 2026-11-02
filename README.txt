MICHIGAN HUNTING MAP - version 1

What it is
  A web map that replaces the Google Earth setup: satellite / hybrid / topo base maps,
  contour lines, Michigan public land by category (tick categories on/off), and live
  wind arrows from NWS stations that refresh on their own every 10 minutes.

On this PC
  Double-click index.html. It opens in your web browser. Needs internet for the base
  maps and wind; the public land data is in data\public_land.js.

On your phone
  The folder has to be on a web host (phones can't open it from Dropbox). Upload the
  whole "Hunting Map App" folder to a free static host such as Netlify, Cloudflare
  Pages or GitHub Pages, then open the link on your phone and choose "Add to Home
  Screen". Allow location when asked to get the GPS dot.
  Note: anyone with the link can open the page. It only holds public data.

Using it
  Layers       - base map, contours, wind, and public land categories
  Hunting only - shows just state forest, state game areas, state parks,
                 national forest and BLM land
  Tap the map  - who owns that spot and whether it's open to the public
  Tap an arrow - station, wind direction and speed, gusts, how old the reading is
  Wind button  - refresh wind now
  GPS button   - (top right) shows where you are and whether you're on public land

Arrows point DOWNWIND (the way scent drifts). Labels give the direction the wind is
coming FROM, then mph, g = gusts. Green under 8 mph, yellow 8-14, orange 15-24, red 25+.

Boundaries are approximate (USGS PAD-US 4.1). Always check Michigan DNR rules,
seasons and safety zones.

Files
  index.html, app.js      the app
  data\public_land.js     public land, built from ..\PADUS4_1_MI\PADUS4_1Fee_StateMI.kmz
  serve.ps1               small local web server, only for testing
