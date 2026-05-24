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
Since the toolbar is `position:fixed`, it floats above the content. The content container needs `padding-top: 80px` to ensure the first item isn't hidden behind the toolbar.

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
  "duration": 213.5
}
```

`filename` is the full relative path from the DLC root — pass it directly to `window.playSong()`.

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
- Album art is fetched via `/api/art/<encoded-filename>`. On error the `<img>` is hidden and a placeholder SVG is shown instead
- The collapse/expand toggle correctly restores `display:grid` (not just `display:''`) when reopening a folder in grid mode — always check this when changing the toggle logic

### 10. Use inline styles for grid layout, not Tailwind
Tailwind's `grid` and `grid-cols-*` classes may not apply reliably inside the plugin div. Use `element.style.cssText` with explicit `display:grid; grid-template-columns:...` for the grid container.

## Extending This Plugin

**Add sorting within folders** — songs are sorted by filename. To sort by title, call `sorted(kids, key=lambda s: s["title"] or "")` after building the kids list.

**Add album art thumbnails** — hit `/api/art/<filename>` and set as an `<img>` in `_songCard()`. Already implemented in grid view.

**Add nested subfolders** — currently one level deep. Make `get_tree()` recursive and update `_folderSection()` to render children.

**Add drag-and-drop** — add `draggable="true"` to song rows and folder headers, then call `/song/move` on drop.
