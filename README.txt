MICHIGAN HUNTING MAP - version 2

What it is
  A web map for hunting Michigan: satellite / hybrid / topo base maps, contour lines,
  public land by category (tick categories on/off), live wind arrows from NWS stations,
  and your own pins in folders, synced between devices through a private GitHub repo.

Open it
  https://bradlans.github.io/hunting-map/
  On a phone, open the link and choose "Add to Home Screen". Allow location when asked
  to get the GPS dot.

Using it
  Layers tab   - base map, contours, wind, and public land categories
  Hunting only - shows just state forest, state game areas, state parks,
                 national forest and BLM land
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
                 Roscommon, Saginaw, St. Clair. Tap for owner / parcel # / acres.
  Tap the map  - who owns that spot and whether it's open to the public
  Tap an arrow - station, wind direction and speed, gusts, how old the reading is
  Wind button  - refresh wind now
  GPS button   - (top right) shows where you are and whether you're on public land;
                 the blue cone shows which way the phone is pointing (compass)
  Ruler button - (under GPS) measure: tap points for distance in yards / miles, each
                 leg labeled; switch to Area for acres. "From me" starts at your GPS
                 spot. Undo, Clear, Done.

Pins
  Double-click (computer) or press and hold (phone) the map to drop a pin right there.
  + Pin        - or use the crosshair: move it to the spot and tap "Drop pin here";
                 pick the pin's type and folder, add a name and notes
  Tap a pin    - details, Copy GPS, Edit, Move, Directions
  Paste GPS    - paste coordinates (Ctrl+V on the map, or the box in + Pin mode) and the
                 crosshair jumps there; reads 44.24, -85.45 / 44 14 24 N 85 27 0 W /
                 N44 14.4 W85 27.0 / Google Maps links
  Pins tab     - folders with show/hide checkboxes, share, rename, delete; tap a pin to go to it
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
  Your spot is sent about once a minute while the map is open on screen. Phones pause
  it when the screen is off or you switch apps, so a friend's dot (purple, gray once
  it's 10+ minutes old) shows where they were last seen. Tap a dot or a name in the
  list for distance and direction from you, Copy GPS and Directions.
  Never use it to decide whether a shot is safe.
  Stored in bradlans/shared-pins as locations/<name>.json; turning sharing off
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
  data/public_land.js     public land (USGS PAD-US 4.1, Michigan, simplified)
