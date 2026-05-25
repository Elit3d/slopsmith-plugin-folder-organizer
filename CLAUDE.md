# Folder Organizer — AI Agent Guide

A Slopsmith plugin that adds a **Folders** nav screen showing your sloppak DLC songs grouped by subfolder name. Create, rename, and delete folders directly in the UI. One-click playback, collapsible folders, live search.

## File Structure

```
plugin.json     Plugin manifest — id, name, nav entry, file declarations
routes.py       FastAPI backend — scans DLC dir, returns folder/song tree, handles folder/song operations
screen.html     Plugin screen content — injected by Slopsmith into the plugin div automatically
screen.js       Frontend logic — renders folder tree, search, expand/collapse, modals
```

## Architecture

This plugin follows the standard Slopsmith plugin pattern (see the main Slopsmith `CLAUDE.md` for the full plugin system reference).

- **Backend** (`routes.py`) — registers routes under `GET/POST /api/plugin/folder_organizer/`. Uses `context["get_dlc_dir"]()` and `context["extract_meta"]()`. Scans `<dlc>/sloppak/` if it exists, otherwise `<dlc>/`. Returns a folder tree and handles create/rename/delete folder and move song operations.
- **Frontend** (`screen.js`) — plain vanilla JS in an IIFE. Fetches the tree from the backend on screen load, renders collapsible folder sections and song rows or cards (grid view). Uses `window.slopsmith.on('screen:changed', ...)` to trigger load when the user navigates here. Calls `window.playSong(filename)` on song click with the full relative path from the DLC root.
- **No dependencies** — no npm, no build step. Tailwind utility classes available globally from the Slopsmith host.

## Critical Layout Lessons (Hard-Won)

These are non-obvious behaviours of the Slopsmith desktop app that took significant debugging to discover:

### 1. Do NOT put an outer wrapper div in screen.html
Slopsmith automatically creates `<div id="plugin-folder_organizer" class="screen">` and injects `screen.html` content inside it. If you add your own outer div with `class="screen"`, you get a nested screen element which gets `display:none` applied, hiding all content.

**Wrong:**
```html
<div id="plugin-folder_organizer" class="screen">
  <div>toolbar</div>
  <div>content</div>
</div>
```

**Correct:**
```html
<!-- no outer wrapper — Slopsmith provides it -->
<div>toolbar</div>
<div>content</div>
```

### 2. The .screen CSS class sets display:none by default
`.screen { display: none }` and `.screen.active { display: block }`. There is no height set. The screen div gets its height purely from its content. Do not try to set height via CSS classes — use inline styles or JS if needed.

### 3. The Slopsmith navbar is position:fixed with z-index:50
The navbar sits at `top:0, z-index:50`. Plugin toolbars must use `position:fixed; top:64px; z-index:40` to sit below the navbar. Use a solid `background-color` (not Tailwind bg classes — those may not apply correctly) to prevent content showing through.

### 4. Content must have padding-top to clear the fixed toolbar
Since the toolbar is `position:fixed`, it floats above the content. The content container needs `padding-top: 120px` to ensure the first item isn't hidden behind the toolbar. This accounts for the Slopsmith navbar (64px) plus the plugin toolbar height (~56px). Adding more toolbar buttons increases this height, so if content is clipped, increase the padding further.

### 5. Electron blocks window.prompt() and window.confirm()
The Slopsmith desktop app is built on Electron which throws `Error: prompt() is not supported`. Use a custom inline modal instead. See `_showModal()` in `screen.js` for the implementation — it returns a Promise and supports both text input and confirm modes.

### 6. The nav plugin dropdown has z-index:50 and blocks clicks
When navigating to a plugin screen via the Plugins dropdown, the dropdown stays open and sits on top of the screen. Call `_closeDropdown()` on screen load to dismiss it. The dropdown element id is `plugin-dropdown`.

### 7. playSong() expects a relative path from the DLC root
`window.playSong()` expects the path relative to the DLC root with forward slashes, e.g. `sloppak/CH/Artist - Title.sloppak`. Not just the filename. Build this in `routes.py` using `p.relative_to(dlc)` and `"/".join(rel.parts)`.

### 8. FastAPI POST routes need `from fastapi import Request`
Routes that receive a JSON body must import `Request` from fastapi explicitly and use `async def route(request: Request)` with `body = await request.json()`. Missing this import crashes the server on plugin load.

### 9. Plugin id must be consistent everywhere
The plugin id (`folder_organizer`) must match in:
- `plugin.json` → `"id"` and `"nav.screen"`
- `screen.html` → not needed (Slopsmith creates the div)
- `screen.js` → `PLUGIN_ID` constant and `API` constant (`/api/plugin/folder_organizer`)
- `routes.py` → `APIRouter(prefix="/api/plugin/folder_organizer")`

A mismatch in any of these causes silent failures (blank screen, 404 API calls).

## Key Conventions

- **IIFE + `'use strict'`** — all frontend code wrapped in `(function(){ 'use strict'; ... })();`
- **localStorage prefix** — all keys prefixed `fo:` (e.g. `fo:open`, `fo:unsorted_open`)
- **Safe storage access** — all `localStorage` reads/writes wrapped in try/catch
- **Logging** — backend uses `context["log"]`, never `print()`
- **Sibling imports** — use `context["load_sibling"]("name")` not bare `import name`
- **Keyboard shortcut** — `/` focuses the search box, registered via `window.registerShortcut()` with `scope: 'plugin-' + PLUGIN_ID`

## Backend Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/plugin/folder_organizer/tree` | Returns folder tree: `{folders: [{name, songs}], root_songs: []}` |
| POST | `/api/plugin/folder_organizer/folder/create` | Body: `{name}` — creates a new subfolder |
| POST | `/api/plugin/folder_organizer/folder/rename` | Body: `{old, new}` — renames a subfolder |
| POST | `/api/plugin/folder_organizer/folder/delete` | Body: `{name}` — deletes folder, moves songs to root |
| POST | `/api/plugin/folder_organizer/song/move` | Body: `{filename, folder}` — moves song to folder (empty = unsorted) |

## Song Metadata Format

Each song object returned by `/tree`:
```json
{
  "filename": "sloppak/CH/Artist - Title.sloppak",
  "title": "Title",
  "artist": "Artist",
  "album": "Album Name",
  "duration": 213.5,
  "year": 1993,
  "tuning": "E Standard",
  "added": 1748132400.0,
  "arrangements": ["Lead", "Rhythm", "Bass"],
  "stems": ["Drums", "Bass", "Vocals"],
  "lyrics": true
}
```

`filename` is the full relative path from the DLC root — pass it directly to `window.playSong()`.

`added` is a Unix timestamp (float, seconds) from `stat().st_mtime` — convert with `new Date(added * 1000)`.

### extract_meta returns arrangements/stems as objects, not strings

`context["extract_meta"]()` returns arrangements as a list of objects `{index, name, notes}`, not plain strings. The backend extracts `.name` from each:

```python
raw_arr = raw.get("arrangements") or []
m["arrangements"] = [
    a["name"] if isinstance(a, dict) else str(a)
    for a in raw_arr
    if (isinstance(a, dict) and "name" in a) or isinstance(a, str)
]
```

The same pattern applies to stems. If you add new metadata fields that come from `extract_meta`, check the raw shape before assuming it's a plain value.

## Folder Scan Logic

`routes.py` scans one level deep inside `<dlc>/sloppak/` (or `<dlc>/` if no sloppak subdir exists):
- Files matching `.psarc` or `.sloppak` at the root → `root_songs` (shown under "Unsorted")
- Subdirectories containing song files → named folder entries
- Empty subdirectories are included (shown with 0 count)

To add more grouping options (by artist, album, etc.), modify `get_tree()` in `routes.py` to use a different key than `entry.name`.

## View Modes (List / Grid)

The toolbar has a list/grid toggle. Current view is stored in `localStorage` under `fo:view` (`'list'` or `'grid'`).

- **List view** — uses `_songRow()`, renders inside a `ml-5 space-y-0` div
- **Grid view** — uses `_songCard()`, renders inside a CSS grid div (`auto-fill, minmax(150px,1fr)`)
- Both `_folderSection()` and `_unsortedSection()` branch on `_view` to pick the right renderer and container
- Album art is fetched via `/api/song/<encoded-path>/art` where each path segment is individually `encodeURIComponent`-encoded. On error the `<img>` is hidden and a placeholder SVG is shown instead
- The collapse/expand toggle correctly restores `display:grid` (not just `display:''`) when reopening a folder in grid mode — always check this when changing the toggle logic

### Lazy folder rendering

Folders do **not** render their song list on initial load. `_folderSection()` sets a `_listPopulated` flag and only calls `_populateFolderList()` the first time a folder is opened. This keeps the initial render fast with large libraries. When search is active all folders are forced open and populated immediately (search overrides lazy loading).

### 10. Use inline styles for grid layout, not Tailwind
Tailwind's `grid` and `grid-cols-*` classes may not apply reliably inside the plugin div. Use `element.style.cssText` with explicit `display:grid; grid-template-columns:...` for the grid container.

## Sort System

The toolbar has a sort select (`#fb-sort`) and a direction toggle (`#fb-sort-dir`). State is stored in `localStorage` under `fo:sort` and `fo:sortDir`.

- `_sort` — `'default' | 'title' | 'artist' | 'duration' | 'year' | 'tuning' | 'added'`
- `_sortDir` — `'asc' | 'desc'`
- `_sortSongs(songs)` — returns a sorted copy; direction is applied by reversing after sort. Returns the array unchanged when `_sort === 'default'`.
- The sort direction button is dimmed (`opacity: 0.35`) and non-interactive when sort is `'default'`.

## Filter System

Filters are stored in `localStorage` under `fo:filters` as a JSON object.

### Filter state shape

```js
_filters = {
    arrangements: { Lead: 'on', Bass: 'exclude', Rhythm: 'off' },
    stems:        { Drums: 'off' },
    lyrics:       'off',   // 'off' | 'on' | 'exclude'
    tunings:      ['E Standard', 'Eb Standard'],
}
```

Each arrangement/stem value is `'off' | 'on' | 'exclude'`.

### Include vs exclude logic

`_matchFilters(song)` uses **OR logic for includes, AND logic for excludes**:

- **Include (`'on'`)** — song passes if it has *at least one* of the selected arrangements/stems. Selecting more includes widens the result set.
- **Exclude (`'exclude'`)** — each excluded tag independently removes songs that have it. Selecting more excludes narrows the result set.

This matches standard multi-select filter UX (similar to Spotify/library filters).

### Data-driven filter panel

All filter sections are built from the actual library data — nothing is hardcoded:

- `_getArrangements()` — scans every song and returns unique arrangement names sorted by frequency (most common first), then alphabetically. The filter panel builds pills from this list.
- `_getStems()` — same pattern for stem names.
- `_getAvailableFilters()` — returns `{ arrangements, stems, lyrics, tuning }` booleans used to gate the lyrics and tuning sections (arrangements and stems gate themselves via the length of `_getArrangements()` / `_getStems()`).

If a song has a non-standard arrangement name (e.g. `"Bonus"`), it will appear as a pill in the filter panel automatically — no constants to update. The stems section only appears if at least one song in the library has stems data.

### Split pill UI

`_makeSplitPill(label, state, onChange)` renders a two-zone pill:
- Left zone (label) — click to toggle `'off' ↔ 'on'` (include, turns blue)
- Right zone (`✕`) — click to toggle `'off' ↔ 'exclude'` (exclude, turns red)

The filter badge on the toolbar (`#fb-filter-badge`) shows the active filter count via `_activeFilterCount()`.

## Hover Badges

Each song row/card has two hidden hover-reveal layers, built once and toggled via CSS `max-height` + `opacity` transitions.

### `_badge(text, active, type)`

Renders a single metadata badge. Type controls the inactive colour:

| type | inactive border | inactive text |
|---|---|---|
| `'arrangement'` | amber `#92400e` | amber `#fcd34d` |
| `'stem'` | violet `#5b21b6` | violet `#c4b5fd` |
| `'lyrics'` | rose `#9f1239` | rose `#fda4af` |
| `'tuning'` | teal `#0f766e` | teal `#5eead4` |

Active state is always blue (`#1d4ed8` fill, `#3b82f6` border, white text) regardless of type.

### `_buildSongBadges(song)`

Builds the badge row (arrangements, stems, lyrics, tuning). Deduplicates within each category — if a song's raw data has the same arrangement name twice, only one badge is shown. Clicking a badge toggles that filter on/off and re-renders.

Returns `null` if the song has no filterable metadata.

### `_buildSongDateInfo(song)`

Builds a separate plain-text hover line showing `year · date added` (e.g. `1993  ·  24 May 2026`). Uses `#cbd5e1` text. Always shown on hover regardless of filter state — not connected to the filter system.

### Reveal / hide

```js
_revealBadges(el)  // max-height:120px, opacity:1, margin-top:4px
_hideBadges(el)    // max-height:0, opacity:0, margin-top:0
```

Both badge layers (`rowBadges` / `cardBadges` and `rowDateInfo` / `cardDateInfo`) are wired to the same `mouseenter`/`mouseleave` events on the row or card element.

## Drag-and-Drop

Drag-and-drop uses **pointer events** (mousedown/mousemove/mouseup), not the HTML5 DnD API. HTML5 DnD blocks wheel events and gives unreliable edge positions inside Electron — pointer events give full control.

- `_makeDraggable(el, song, folderName)` — attaches a `mousedown` listener. A drag only becomes "live" after the pointer moves more than `_DRAG_THRESH` (5 px), preventing accidental drags on clicks.
- Once live, a ghost `div` is created and follows the cursor. Auto-scroll activates when the pointer is within `_DRAG_ZONE` (150 px) of the viewport top or bottom.
- `_makeDropTarget(el, targetFolder)` — sets `data-dropFolder` on an element so it can receive drops. Both folder headers and song list containers are drop targets.
- `_dragFindTarget(x, y)` — uses `document.elementsFromPoint` to find the topmost element with `data-dropFolder` under the cursor.
- **Esc to cancel** — `_onDragKeyDown` calls `_endPointerDrag()` on `Escape`, removing the ghost and clearing state without executing a drop.
- On successful drop, `_executeDrop()` does an **optimistic UI update** (moves the song in `_tree` immediately and re-renders) then calls `/song/move`. If the API call fails it reloads the full tree.
- A one-time `click` capture listener is added after mouseup to suppress the click event that fires after a drag, preventing accidental song playback.

## Modal Behaviour

`_showModal(msg, withInput, defaultVal)` is the custom modal used for all prompts and confirms (Electron blocks `window.prompt()` and `window.confirm()`). It returns a Promise.

- `_confirm(msg)` — resolves `true` on OK, `null` on cancel
- `_prompt(msg, default)` — resolves the trimmed input string on OK, `null` on cancel
- **Esc cancels** — a `keydown` listener inside the modal resolves with `null` on `Escape`, same as clicking Cancel. This applies to all modal uses: rename, delete, create folder, and move song.
- **Enter confirms** — same listener submits on `Enter` (equivalent to clicking OK).

## Planned Features (Roadmap)

Features not yet implemented, in rough priority order:

- **Nested subfolders** — currently one level deep. Make `get_tree()` recursive and update `_folderSection()` to render children.
- **Auto-play on hover** — with an on/off toggle preference saved to localStorage.
- **Bulk move** — multi-select songs and move them all at once.
- **Thumbnail performance** — faster loading and smoother scrolling with large libraries.
- **Adjustable thumbnail/row sizes** — user-resizable song cards and list rows.
- **Custom themes** — switchable colour schemes.
- **Favoriting songs** — mark songs as favourites; likely needs a new backend route and a `fo:favorites` localStorage key.
- **Editing song metadata** — edit title, artist, album etc. in-plugin; needs new backend write routes.
