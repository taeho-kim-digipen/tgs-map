# TGS 2026 interest map

An iPhone-friendly, Korean-language interactive map using the official TGS 2026
English floor plan. Only Halls 1–8 exhibitors are interactive. The original Hall 1
academy inset is included as a separate map view.

- 160 main-plan booth rectangles and 67 academy-inset rectangles, each matched
  one-to-one to an official printed booth code; no estimated booth positions.
- 500 ms hold toggles a booth. Drag, pinch, cancellation and backgrounding cancel
  pending holds. A short tap opens the accessible interest button.
- Favorites are browser-local preferences. Initial choices are Bandai Namco,
  NEXON and Astrae Oratio from the user's earlier visit plans. Clearing all choices
  is preserved across reloads.
- Pan, pinch, wheel and zoom controls; portrait/landscape safe-area layout.
- Search all booth names, exhibitor names and codes, including common Korean
  aliases and flexible codes such as `7-c4`. Results are paginated and jump to
  the corresponding booth or facility.
- Explicit iPhone portrait, iPhone landscape and PC modes, plus automatic
  orientation. Manual phone modes rotate the workspace when needed. PC mode
  uses a side panel and scales to fit on smaller displays. Preferences persist.
- 48 official facility points: entrance/exit routes, lockers, food, information,
  Charge SPOT and restrooms. The 2F Central Mall is a separate facility view;
  entrance details preserve the official date/time and direction conditions.
  Nearby same-category facilities cluster with a visible location count.
- Original SVG glyph paths are now inserted directly into the map scene. Zoom
  changes SVG geometry instead of enlarging a CSS-composited image layer, so the
  device rasterizes the original vectors at its current display pixel density.
- The page is fixed to Safari's visual viewport, accounting for browser chrome
  and safe areas in both orientations. A shrinking map grid row prevents page
  overflow. Favorites use button pagination (three/four items), not scrolling.

## Official source

Source page: https://tgs.cesa.or.jp/2026/en/map

PDF: https://service.tgs.cesa.or.jp/2026/venue_pdf_en/

The original PDF is retained under `sources/`. `extract_map.py` produces exact
vector crops and machine-readable geometry. The base map itself is not redrawn.
Other halls, merchandise halls and meeting-room booths are outside this app's
interactive scope. Company booths are marked as whole booths; the official
overall plan does not establish game-specific positions inside them.

## Validation

Static entrypoint, JavaScript syntax, local assets and all 227 booth/code matches
were checked. Original map crops were rendered and visually verified.
A simulated interaction harness verified add/remove, short tap, drag/pinch/cancel
protection, saved-state restoration and preservation of an empty favorites list.
The updated harness also verifies 430×932 and 932×430 phone frame dimensions,
1440×900 PC sizing, manual rotation, the inline scene, favorites pagination,
Korean/name/code search, result pagination, facility floor navigation and entrance
conditions. All 227 booth bounds and 48 facility bounds lie inside their maps.
CSS and asset checks cover the fixed grid and removal of CSS image scaling.
The official PDF's CMYK battery icon is decoded through its PDF resource and
embedded as RGB PNG so its original pixels display correctly in web SVG.
No live browser or physical iPhone QA was requested or performed. The optional
WebMCP registrations use the same state actions; validation in a supported WebMCP
browser context was unavailable.

Plain static assets in `dist/` are the authored deployment output; no build or
package installation is required.
