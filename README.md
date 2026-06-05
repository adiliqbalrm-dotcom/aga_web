# PvP Agar-Style Browser Game

A clean-room HTML5 Canvas + WebSocket multiplayer Agar-style game.

## Run

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

Open multiple browser tabs to test multiplayer.

## Controls

- Move: mouse / touch joystick
- Split: `Space`
- Eject mass: `W`
- Cashout: `C` or the cashout button
- Chat: `Enter`

## Latest update

- Added a skin picker with the uploaded skin set.
- Added skins to players and bots.
- Added bright player outline/rim.
- Changed wall molding so cells flatten against arena walls.
- Increased and restyled mass dots.
- Maintains 6 total active participants: 1 player = 5 bots, 2 players = 4 bots, etc.
- Changed death/cashout-fail UI to a red eliminated screen.
- Changed cashout-success UI to a win screen.
- Improved split behavior and added split-stretch cell shape.
- Fixed killing bots so player kills and kill popup/events count.
- Made speed decrease more clearly as mass increases.

## Notes

This is an original local demo implementation. The money/cashout values are simulated demo values only.


## Latest revision

- After death or cashout, the result button returns the player to the player-selection lobby.
- Player skins now render with crisp nearest-neighbor scaling so large skins stay less blurry.
- Each player starts with $5.00 and earns the defeated player's full balance on a kill.
- Updated wall-mold deformation for a flatter pressed-against-the-wall look.
- Updated split control button icon and stronger split-stretch shape.


## Virus / density / HD revision

- Upscaled skin assets to 1024x1024 and switched cell rendering to high-quality image smoothing for cleaner large skins.
- Restyled the virus to match the bright spiky green reference more closely.
- Increased virus size and increased total dot count for a denser field like the reference.
- When a virus pops a player, the player's earnings are reduced and the remaining total is divided across the new split pieces.

## Careful revision: timer, mold, virus, split earnings

- Reset timer is now 10 minutes.
- Timer starts only when the first real player enters.
- When no real player is alive, the timer resets back to 10:00; the next first player always starts a fresh 10-minute round.
- Wall mold was rewritten so a cell touching top/right/left/bottom walls flattens/molds against those sides, including top+right combined molding.
- Virus was redrawn as a bright green circular serrated virus matching the provided reference style.
- Earnings are now stored per cell. Splitting divides earnings into the split pieces; eating/collecting a piece transfers that piece's earnings to the collector.
- Virus breaking reduces earnings first, then divides the remaining earnings across all pieces.


## Precision revision

- Reset timer is now 10:00.
- Timer starts only when a real player enters. If all real players leave/die/cashout, the timer resets back to 10:00 and the next first real player starts from a fresh 10:00.
- Wall molding now clips cells flat against touched walls, including top/right corner molding.
- Virus/breaker art was changed to a round neon green body with a small jagged edge like the provided reference.
- Virus collision now pops the player when the player overlaps the virus enough, with a reduced earnings total divided across split parts.
- Eating/collecting any split player part transfers that specific part's earnings to the collector; merging your own parts combines their earnings back together.

## v5 careful fix

- Skin assets are now 2048x2048 with extra sharpening, and canvas skin rendering uses high-quality image smoothing.
- Wall molding was rewritten to deform only from the side touching the arena wall; touching top + right creates a combined flattened corner.
- Virus rendering now matches the simple bright green reference: solid center with a small jagged darker rim.
- Virus splitting no longer permanently removes earnings. The touched cell's value is divided across the split parts. Eating a part transfers that part's value. Merging all owned pieces restores the full pre-virus earning total.
- The 10-minute reset timer behavior from v4 is kept: it starts with the first real player and resets when no real player is present.

## v6 wall mold update

- Rebuilt the player cell outline to use a persistent organic point contour, closer to the uploaded video behavior.
- Wall molding now visually pushes the blob into the wall and clamps only the touched side, so right/top/top+right contacts flatten like a soft cell pressed against the border.
- The physics remains clamped; only the rendered path is deformed.

## v7 mold fix

- Fixed the folded wall-mold artifact.
- The cell image, name, money text, cashout ring, and outline now use the same visual molded center, so the picture no longer slides aside from the molded shape.
- Wall molding now uses independent side clamping only; x/y are never recalculated after a side clamp, which prevents the shape from crossing over itself.
- Organic wobble is reduced on the flattened side so the wall-facing edge stays clean while the rest remains blob-like.


## HD panther skin pack

- Replaced the main panther skin with a sharper HD version based on the provided reference image.
- Added multiple HD panther-style variants: blue, gold, red, violet, and emerald.
- Updated the skin picker so these new HD skins are available in the project.
