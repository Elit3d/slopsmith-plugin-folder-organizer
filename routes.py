"""
Folder Browser plugin — routes.py
"""

from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import shutil
import re


def setup(app, context):
    log = context["log"]
    router = APIRouter(prefix="/api/plugin/folder_organizer")

    def _dlc_root() -> Path | None:
        try:
            return Path(context["get_dlc_dir"]())
        except Exception:
            return None

    def _scan_root(dlc: Path) -> Path:
        sloppak = dlc / "sloppak"
        return sloppak if sloppak.exists() else dlc

    def _is_song(p: Path) -> bool:
        ext = p.suffix.lower()
        if ext in (".psarc", ".sloppak"):
            return True
        if p.is_dir() and ext == ".sloppak":
            return True
        return False

    def _safe_name(name: str) -> bool:
        if not name or name.strip() != name:
            return False
        if re.search(r'[\\/:*?"<>|]', name):
            return False
        if name in ('.', '..'):
            return False
        return True

    def _meta(p: Path, dlc: Path) -> dict:
        try:
            rel = p.relative_to(dlc)
            filename = "/".join(rel.parts)
        except ValueError:
            filename = p.name
        m = {"filename": filename, "title": None, "artist": None,
             "album": None, "duration": None, "year": None,
             "tuning": None, "added": None,
             "arrangements": [], "stems": [], "lyrics": False}
        try:
            stat = p.stat()
            m["added"] = stat.st_mtime
        except Exception:
            pass
        try:
            raw = context["extract_meta"](p)
            if raw:
                m["title"]    = raw.get("title")    or raw.get("name")
                m["artist"]   = raw.get("artist")   or raw.get("artistName")
                m["album"]    = raw.get("album")     or raw.get("albumName")
                m["duration"] = raw.get("duration")
                m["year"]     = raw.get("year")
                m["tuning"]   = raw.get("tuning")

                # arrangements — objects with a "name" key e.g. [{name:"Lead",...}, ...]
                raw_arr = raw.get("arrangements") or []
                if isinstance(raw_arr, (list, tuple)):
                    m["arrangements"] = [
                        a["name"] if isinstance(a, dict) else str(a)
                        for a in raw_arr
                        if (isinstance(a, dict) and "name" in a) or isinstance(a, str)
                    ]

                # stems — try common key variants
                for _key in ("stems", "stem_types", "available_stems", "stem_names", "stemTypes"):
                    _val = raw.get(_key)
                    if _val:
                        m["stems"] = list(_val) if isinstance(_val, (list, tuple)) else [str(_val)]
                        break

                # lyrics — try common key variants
                for _key in ("lyrics", "hasLyrics", "has_lyrics", "lyric", "hasLyric"):
                    _val = raw.get(_key)
                    if _val is not None:
                        if isinstance(_val, str):
                            m["lyrics"] = _val.lower() not in ("", "false", "no", "0")
                        else:
                            m["lyrics"] = bool(_val)
                        break
        except Exception as exc:
            log.debug("meta failed for %s: %s", p.name, exc)
        if not m["title"]:
            m["title"] = p.stem
        return m

    @router.get("/tree")
    def get_tree():
        dlc = _dlc_root()
        if not dlc or not dlc.exists():
            return JSONResponse({"folders": [], "root_songs": [],
                                 "error": "DLC directory not found"})
        root = _scan_root(dlc)
        log.info("folder_browser: scanning %s", root)
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
                    folders[entry.name] = kids
        except PermissionError:
            return JSONResponse({"folders": [], "root_songs": [],
                                 "error": "Permission denied"})
        folder_list = [
            {"name": n, "songs": s}
            for n, s in sorted(folders.items(), key=lambda kv: kv[0].lower())
        ]
        return JSONResponse({"folders": folder_list, "root_songs": root_songs})

    @router.post("/folder/create")
    async def create_folder(request: Request):
        body = await request.json()
        name = (body.get("name") or "").strip()
        if not _safe_name(name):
            return JSONResponse({"error": "Invalid folder name"}, status_code=400)
        dlc = _dlc_root()
        if not dlc:
            return JSONResponse({"error": "DLC dir not found"}, status_code=500)
        target = _scan_root(dlc) / name
        if target.exists():
            return JSONResponse({"error": "Folder already exists"}, status_code=400)
        try:
            target.mkdir(parents=False)
            return JSONResponse({"ok": True})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/folder/rename")
    async def rename_folder(request: Request):
        body = await request.json()
        old = (body.get("old") or "").strip()
        new = (body.get("new") or "").strip()
        if not _safe_name(old) or not _safe_name(new):
            return JSONResponse({"error": "Invalid folder name"}, status_code=400)
        dlc = _dlc_root()
        if not dlc:
            return JSONResponse({"error": "DLC dir not found"}, status_code=500)
        root = _scan_root(dlc)
        src, dst = root / old, root / new
        if not src.exists():
            return JSONResponse({"error": "Folder not found"}, status_code=404)
        if dst.exists():
            return JSONResponse({"error": "Name already taken"}, status_code=400)
        try:
            src.rename(dst)
            return JSONResponse({"ok": True})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/folder/delete")
    async def delete_folder(request: Request):
        body = await request.json()
        name = (body.get("name") or "").strip()
        if not _safe_name(name):
            return JSONResponse({"error": "Invalid folder name"}, status_code=400)
        dlc = _dlc_root()
        if not dlc:
            return JSONResponse({"error": "DLC dir not found"}, status_code=500)
        root = _scan_root(dlc)
        target = root / name
        if not target.exists():
            return JSONResponse({"error": "Folder not found"}, status_code=404)
        try:
            for child in target.iterdir():
                if _is_song(child):
                    dest = root / child.name
                    if not dest.exists():
                        child.rename(dest)
            shutil.rmtree(target)
            return JSONResponse({"ok": True})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/song/move")
    async def move_song(request: Request):
        body = await request.json()
        filename = (body.get("filename") or "").strip()
        dest_folder = (body.get("folder") or "").strip()
        dlc = _dlc_root()
        if not dlc:
            return JSONResponse({"error": "DLC dir not found"}, status_code=500)
        src = dlc / Path(*filename.split("/"))
        if not src.exists():
            return JSONResponse({"error": "Song not found"}, status_code=404)
        root = _scan_root(dlc)
        if dest_folder:
            if not _safe_name(dest_folder):
                return JSONResponse({"error": "Invalid folder name"}, status_code=400)
            dst_dir = root / dest_folder
            if not dst_dir.exists():
                return JSONResponse({"error": "Destination folder not found"}, status_code=404)
        else:
            dst_dir = root
        dst = dst_dir / src.name
        if dst.exists():
            return JSONResponse({"error": "File already exists at destination"}, status_code=400)
        try:
            src.rename(dst)
            return JSONResponse({"ok": True})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    app.include_router(router)
    log.info("folder_browser routes registered")
