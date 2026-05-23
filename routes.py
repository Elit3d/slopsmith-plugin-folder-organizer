"""
Folder Browser plugin — routes.py
Scans the sloppak DLC directory and returns a folder-grouped song tree.
Groups songs by the immediate subfolder they sit in, so the user can
organise songs simply by creating folders.
"""

from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import JSONResponse


def setup(app, context):
    log = context["log"]
    router = APIRouter(prefix="/api/plugin/folder_browser")

    # ── helpers ──────────────────────────────────────────────────────────

    def _dlc_root() -> Path | None:
        try:
            return Path(context["get_dlc_dir"]())
        except Exception:
            return None

    def _scan_root(dlc: Path) -> Path:
        """Scan dlc/sloppak/ if it exists, otherwise dlc/ directly."""
        sloppak = dlc / "sloppak"
        return sloppak if sloppak.exists() else dlc

    def _is_song(p: Path) -> bool:
        ext = p.suffix.lower()
        if ext in (".psarc", ".sloppak"):
            return True
        if p.is_dir() and ext == ".sloppak":
            return True
        return False

    def _meta(p: Path, dlc: Path) -> dict:
        # Relative path from DLC root, forward-slash joined — matches
        # the format playSong() expects e.g. "sloppak/CH/Artist - Title.sloppak"
        try:
            rel = p.relative_to(dlc)
            filename = "/".join(rel.parts)
        except ValueError:
            filename = p.name

        m = {"filename": filename, "title": None, "artist": None,
             "album": None, "duration": None}
        try:
            raw = context["extract_meta"](p)
            if raw:
                m["title"]    = raw.get("title")    or raw.get("name")
                m["artist"]   = raw.get("artist")   or raw.get("artistName")
                m["album"]    = raw.get("album")     or raw.get("albumName")
                m["duration"] = raw.get("duration")
        except Exception as exc:
            log.debug("meta failed for %s: %s", p.name, exc)
        if not m["title"]:
            m["title"] = p.stem
        return m

    # ── route ─────────────────────────────────────────────────────────────

    @router.get("/tree")
    def get_tree():
        """
        Scans <dlc>/sloppak/ one level deep (falls back to <dlc>/).
        Songs directly in the root → root_songs ("Unsorted").
        Songs inside a subfolder → that folder's entry.

        {
          "folders": [{"name": str, "songs": [meta, ...]}, ...],
          "root_songs": [meta, ...]
        }
        """
        dlc = _dlc_root()
        if not dlc or not dlc.exists():
            log.warning("folder_browser: DLC root not found (%s)", dlc)
            return JSONResponse({"folders": [], "root_songs": [],
                                 "error": "DLC directory not found"})

        root = _scan_root(dlc)
        log.info("folder_browser: scanning %s (dlc root: %s)", root, dlc)

        folders: dict[str, list] = {}
        root_songs: list = []

        try:
            for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
                if entry.name.startswith("."):
                    continue

                if _is_song(entry):
                    root_songs.append(_meta(entry, dlc))

                elif entry.is_dir():
                    kids = []
                    try:
                        for child in sorted(entry.iterdir(),
                                            key=lambda p: p.name.lower()):
                            if not child.name.startswith(".") and _is_song(child):
                                kids.append(_meta(child, dlc))
                    except PermissionError:
                        log.warning("permission denied: %s", entry)
                    if kids:
                        folders[entry.name] = kids

        except PermissionError:
            log.error("permission denied reading scan root: %s", root)
            return JSONResponse({"folders": [], "root_songs": [],
                                 "error": "Permission denied"})

        folder_list = [
            {"name": n, "songs": s}
            for n, s in sorted(folders.items(), key=lambda kv: kv[0].lower())
        ]
        log.info("folder_browser: %d folders, %d root songs",
                 len(folder_list), len(root_songs))
        return JSONResponse({"folders": folder_list, "root_songs": root_songs})

    app.include_router(router)
    log.info("folder_browser routes registered")
