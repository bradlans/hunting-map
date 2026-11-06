MICHIGAN HUNTING MAP - version 3 (updated Nov 5, 2026)

What it is
  A web map for hunting Michigan and West Virginia: satellite / hybrid / topo base maps,
  contour lines, public land by category (tick categories on/off), live wind arrows from
  NWS stations, forecast wind flow, and your own pins in folders, synced between devices
  through a private GitHub repo.

West Virginia
  Public land for WV (national forests, WMAs, state forests and parks, Corps of Engineers
  lakes) loads by itself the first time the map shows WV, so Michigan-only use stays as
  light as before. It is the same USGS PAD-US 4.1 data as Michigan. WV DNR land is sorted by
  its PAD-US type: conservation areas (WMAs) show as state game / wildlife area, parks as
  state park, resource management areas as state forest. Parcel lines cover all of WV
  (statewide map from the WV GIS Technical Center, tax year 2023, with owner names).
  HAP, Commercial Forest and the DNR forest stands are Michigan programs and show nothing
  in WV. Check WV DNR rules, seasons and safety zones.

Open it
  https://bradlans.github.io/hunting-map/
  On a phone, open the link and choose "Add to Home Screen". Allow location when asked
  to get the GPS dot.

Using it
  Layers and Pins button (top) opens the panel:
  Layers tab   - base map, then a public land tree: All public land > State land (DNR)
                 (with HAP and Commercial Forest inside it) / Federal / Local & other.
                 Groups start folded; the arrow opens one. Contours, wind arrows, parcel
                 lines, tree types and crop fields are under Extras at the bottom.
  Wind and     - (Layers tab, under Public land) two tree branches sharing one Time slider
  weather        (now to 48 hours ahead; moving either slider moves both):
                 Wind (checkbox turns all three on/off):
                   Observed - station arrows, measured now (not on the slider)
                   Cones at pins - a cone from each pin on screen pointing where its scent
                     goes at the slider's time; longer with more wind, wide when light,
                     narrow when strong, a small circle when calm. Colored by speed. Tap
                     inside one for its wind. Forecast from Open-Meteo.
                   Flow - forecast streaks over the whole map (see Extras note below)
                 Weather (checkbox shows/hides the chip): the icon and temperature at the
                   top right are the forecast for the middle of the map at the slider's
                   time ("+6h" when not now). Tap it for sky, feels-like, rain/snow
                   chance, wind, clouds and humidity. Updates as you move the map.
  Hunting only - shows just state forest, state game areas / WMAs, state parks,
                 national forest, BLM land, Corps of Engineers lakes and joint
                 state / federal land (mostly WMAs)
  HAP land     - Hunting Access Program parcels (magenta stripes), live from the
                 Michigan DNR; tap one for hunt type, check-in rules, hunter limit
                 and directions to the check-in. A saved copy works with no signal.
  Commercial   - Commercial Forest land (blue hatch), live from the Michigan DNR: private
  Forest         timberland open to the public on foot for hunting, fishing and trapping.
                 No vehicles, camping or permanent blinds without the owner's OK. Tap for
                 owner, township/range/section and acres. A saved copy works with no signal.
  Parcels      - private property lines (zoom in close) for the 24 counties that share
                 them free: Allegan, Barry, Cheboygan, Grand Traverse, Ionia, Jackson,
                 Kalamazoo, Kent, Lake, Lenawee, Macomb, Mason, Midland, Monroe,
                 Montcalm, Muskegon, Newaygo, Oakland, Oceana, Osceola, Ottawa,
                 Roscommon, Saginaw, St. Clair; and all of West Virginia. Tap for owner /
                 parcel # / acres (and address in WV).
  Tap the map  - who owns that spot and whether it's open to the public
  Tap an arrow - station, wind direction and speed, gusts, how old the reading is
  Wind button  - refresh wind now
  GPS button   - (top right) shows where you are and whether you're on public land;
                 the blue cone shows which way the phone is pointing (compass)
  Map route    - (top) records your walk with GPS as a red line. The button shows the
                 distance while recording; Pause/Resume, Save (name it and pick a folder;
                 it becomes a line like any other), Discard, Hide. Rough GPS fixes and
                 standing-still wander are left out. The screen stays on while recording
                 (phones stop GPS for web pages when the screen sleeps). A route in
                 progress survives closing the page; it comes back paused.
  Ruler button - (under GPS) measure: tap points for distance in yards / miles, each
                 leg labeled; switch to Area for acres. "From me" starts at your GPS
                 spot. Undo, Clear, Save (keep it as a line or area in a folder), Done.

Extras (bottom of the Layers tab, tap "Extras" to open)
  Wind flow    - (now under Wind and weather > Wind > Flow) off by default; when off,
                 nothing for it is downloaded or run. When on:
                 forecast wind for the area on screen as streaks flowing downwind (dark on
                 Topo and Hybrid, white on Satellite) over a speed-colored wash (blue calm,
                 green under 15 mph, yellow, orange, red 35+). The Time slider steps
                 through the next 48 hours. Tap the map for the
                 forecast at that spot. From Open-Meteo (free, NOAA weather models): a
                 forecast, not a measurement, so it is best for the general pattern and for
                 planning; the station arrows (Observed wind) show what was really measured.
                 Streaks pause while the map moves and when the screen is hidden (battery).
                 Needs signal. Open-Meteo's free limit is per day; heavy panning on a busy
                 day can hit it, and the panel says so.
  Tree types   - off by default; when off, nothing for it is downloaded or run. Two published
                 sources, each with its own checkbox, in the same colors (aspen, maple /
                 northern hardwood, oak, pine, spruce/fir, cedar/lowland conifer, ...):
                 State forest stands - Michigan DNR forest inventory, mapped by DNR foresters.
                   Zoom in to see them. Tap one for cover type, the year it started (age),
                   tree size, planted or natural, canopy, acres, the DNR's last recorded work
                   (cuts), its current plan, survey date and the forester's note. State
                   forest only.
                 All land, 2018 model - US Forest Service FIA BIGMAP forest type groups, 30 m.
                   Tap off a stand for its type. Good for the main type of a big block of
                   woods; it is from 2018, so it misses newer cuts and clearings, and it
                   often calls oak "maple / beech / birch".
                 Same Michigan DNR data terms as the HAP and Commercial Forest layers.
  Crop fields  - off by default. When off, nothing for it is downloaded or run. When on:
                 farm fields colored by crop from the USDA Cropland Data Layer (a yearly
                 satellite crop map, 10 m for 2024 on, 30 m back to 2008); woods, water and
                 towns stay clear. Pick the year and fill. Zoom in to see fields. Tapping
                 the map adds that spot's crop history to the popup, plus a "likely this
                 year" guess when the field is the same crop 3+ years or swaps two crops.
                 Usually right for corn and soybeans, often wrong for hay and pasture, and
                 misses small food plots. Each year's map comes out the next February.
                 Needs signal (not saved for offline).

Pins
  Double-click (computer) or press and hold (phone) the map to drop a pin right there.
  + Pin        - or use the crosshair: move it to the spot and tap "Drop pin here";
                 pick the pin's type and folder, add a name and notes
  Tap a pin    - details, Copy GPS, Edit, Move, Directions
  Paste GPS    - paste coordinates (Ctrl+V on the map, or the box in + Pin mode) and the
                 crosshair jumps there; reads 44.24, -85.45 / 44 14 24 N 85 27 0 W /
                 N44 14.4 W85 27.0 / Google Maps links
  Pins tab     - folders with show/hide checkboxes, share, rename, delete; tap a pin to go to it
  Lines/areas  - routes and outlines kept in folders like pins, with their length or acres
                 on the map. Make one with the ruler (measure, then Save), or import them
                 from Google Earth. Tap a line, or an area's edge or label, for its popup
                 and Edit (name, folder, color, notes, delete). A tap inside an area still
                 shows who owns the land. They sync, share and back up like pins.
  Pin types    - edit the list of pin types (name, color, 1-2 letter badge)

Sharing a folder
  Pins tab > a folder > Share, then pick one:
  Share live   - everyone you invite can add, edit and delete the folder's pins. It shows
                 a SHARED badge, who is in it, and who last edited each pin. Changes show
                 up when the map opens, when you tap Refresh on the folder, and a few
                 seconds after an edit. Invite sends the join link; Leave takes it off
                 your map (the others keep it). Newest edit wins if two people change
                 the same pin.
  Send a copy  - a one-time copy: "Send link", "Copy link" or "Save as file". Whoever
                 opens it gets the pins as they are now. Sending the same folder again
                 later updates their copy instead of doubling up.
  Anyone with a link can see those pins, so only send it to people you trust.

How live sharing is stored
  Each live folder is one file, folders/<folder id>.json, in the private repo
  bradlans/shared-pins: the folder name, its pins, deletes, and who has joined.
  Everyone's own pins.json just lists which shared folders they are in.
  Each person's GitHub key needs Contents: Read and write on bradlans/shared-pins
  as well as their own pins repo.

Friends (location sharing)
  Friends button (top) > "Share my location" switch, and pick how long (1-12 hours).
  It turns off by itself at the end; flip the switch to stop early. While on, the
  button turns orange and says "Sharing".
  Share with   - tick the friends who can see you (you can change it while sharing).
                 Friends appear in this list once they've opened Friends on their own
                 map. Someone new starts unticked. The map hides your dot from anyone
                 you didn't tick, but anyone who opens the shared-pins repo itself on
                 GitHub could still read it.
  Your spot is sent every ~15 s while you move and every 2 min sitting still, while
  the map is open on screen; friends' dots refresh every 15 s while someone is active.
  Accuracy: rough cell/Wi-Fi fixes are skipped (the first spot waits up to 20 s for
  real GPS), and sitting still the last ~45 s of GPS fixes are blended, which takes
  typical wander of 5-10 yd down to a yard or two. The shaded ring around a dot is
  how far off it could be. "Keep my screen on while sharing" stops the phone from
  sleeping so the spot keeps updating (uses more battery).
  Phones pause sharing when the screen is off or you switch apps, so a friend's dot
  (purple, gray once it's 10+ minutes old) shows where they were last seen. Tap a dot
  or a name in the list for distance and direction from you, Copy GPS and Directions.
  Never use it to decide whether a shot is safe.
  Stored in bradlans/shared-pins as locations/<name>.json (with the list of who it's
  for) and people/<name>.json (the group list); turning sharing off
  deletes the file. GitHub keeps past versions, so the repo holds a history of spots
  sent while sharing was on.

Sync between devices
  Pins are saved on each device. "Sync with GitHub" (Pins tab) keeps them the same
  everywhere by merging with pins.json in a private repo. It syncs when the app opens,
  when it comes back to the front, when signal returns, and shortly after any change.
  Newest edit wins per pin, and deletes carry over.
  Setup per device: make a fine-grained GitHub key limited to the private pins repo
  with Contents: Read and write, then paste it into the Sync section. The key is kept
  in that device's browser only; revoke it on GitHub if a device is lost.
  Each person gets their own private pins repo and key, so nobody sees anyone else's
  pins unless a folder is shared. A setup link fills in the repo name:
    https://bradlans.github.io/hunting-map/#sync=bradlans/ben-hunting-pins
  Export / Import pins makes a backup file as well.

Importing map files (GeoJSON, GPX)
  Pins tab > Backup > Import pins also takes .geojson / .json map files (CalTopo, Gaia GPS,
  QGIS, county GIS sites) and .gpx files (Garmin, onX, most GPS apps). Points / waypoints
  become pins, lines, routes and GPS tracks become lines, and polygons become areas
  (outer edge). Names, descriptions and colors come along; the folder is the file's own
  folder (CalTopo folders, a "folder" field) or else the file name. Already-imported items
  are skipped. GeoJSON must be in latitude/longitude (WGS84); a file in state plane or
  UTM feet/meters is refused with a note to export it again.

Importing from Google Earth
  Pins tab > Backup > Import pins, then pick a .kml or .kmz (in Google Earth: right-click
  a folder or place > Save Place As). Points become pins, paths become lines and
  polygons become areas (keeping their Google Earth color). Names and descriptions come
  along, the Google Earth folder becomes the folder (made if it doesn't exist), and a
  pin's type is picked from its name (scrape, rub, stand/blind, trail cam, bedding,
  parking, deer sighting), or "Imported" if unclear. GPS tracks and 3D models are
  skipped. Anything already on the map (same name, same spot) is skipped, so importing
  the same file twice is safe.

Wind arrows point DOWNWIND (the way scent drifts). Labels give the direction the wind
is coming FROM, then mph, g = gusts. Green under 8 mph, yellow 8-14, orange 15-24,
red 25+.

Boundaries are approximate (USGS PAD-US 4.1). Always check Michigan DNR rules,
seasons and safety zones.

Files
  index.html, app.js      the map
  pins.js                 pins, folders, pin types, GitHub sync
  hap.js                  Hunting Access Program layer (Michigan DNR open data)
  cf.js                   Commercial Forest layer (Michigan DNR open data)
  parcels.js              county parcel lines (each county's free public GIS service)
  compass.js              view cone on the location dot
  measure.js              measure tool (distance and area)
  friends.js              friend location sharing
  route.js                Map route (record a GPS track as a line)
  crops.js                Extras > Crop fields (loaded only when switched on)
  trees.js                Extras > Tree types (loaded only when switched on)
  windflow.js             Wind > Flow (loaded only when switched on)
  wx.js                   Wind and weather tree, shared Time slider, cones at pins, weather chip
  data/public_land.js     public land (USGS PAD-US 4.1, Michigan, simplified)
  data/public_land_wv.js  public land (USGS PAD-US 4.1, West Virginia; loaded when the map shows WV)
