"""
Folder Browser plugin — routes.py
Scans the sloppak DLC directory and returns a folder-grouped song tree.
"""

from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import JSONResponse


def setup(app, context):
    log = context["log"]
    router = APIRouter(prefix="/api/plugin/folder_browser")

    # ── helpers ──────────────────────────────────────────────────────────

    def _dlc_dir() -> Path | None:
        """Prefer the sloppak source dir; fall back to the main DLC dir."""
        try:
            d = context.get("get_sloppak_cache_dir", lambda: None)()
            if d and Path(d).exists():
                return Path(d)
        except Exception:
            pass
        try:
            return Path(context["get_dlc_dir"]())
        except Exception:
            return None

    def _is_song(p: Path) -> bool:
        ext = p.suffix.lower()
        if ext in (".psarc", ".sloppak"):
            return True
        if p.is_dir() and ext == ".sloppak":
            return True
        return False

    def _meta(p: Path) -> dict:
        m = {"filename": p.name, "title": None, "artist": None,
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
        {
          "folders": [{"name": str, "songs": [meta, ...]}, ...],
          "root_songs": [meta, ...]
        }
        """
        dlc = _dlc_dir()
        if not dlc or not dlc.exists():
            log.warning("folder_browser: DLC dir not found (%s)", dlc)
            return JSONResponse({"folders": [], "root_songs": [],
                                 "error": "DLC directory not found"})

        folders: dict[str, list] = {}
        root_songs: list = []

        try:
            for entry in sorted(dlc.iterdir(), key=lambda p: p.name.lower()):
                if entry.name.startswith("."):
                    continue
                if _is_song(entry):
                    root_songs.append(_meta(entry))
                elif entry.is_dir():
                    kids = []
                    try:
                        for child in sorted(entry.iterdir(),
                                            key=lambda p: p.name.lower()):
                            if not child.name.startswith(".") and _is_song(child):
                                kids.append(_meta(child))
                    except PermissionError:
                        log.warning("permission denied: %s", entry)
                    if kids:
                        folders[entry.name] = kids
        except PermissionError:
            log.error("permission denied reading DLC dir: %s", dlc)
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
