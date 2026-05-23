/* Folder Browser — screen.js
 * Plain JS, global scope, IIFE. Follows slopsmith plugin conventions.
 * References: CLAUDE.md, app_tour_library/script.js, drums/screen.js
 */
(function () {
'use strict';

const PLUGIN_ID   = 'folder_browser';
const SCREEN_ID   = 'plugin-' + PLUGIN_ID;

// ── Safe localStorage helpers (see drums/screen.js pattern) ──────────
function _store(key, val) {
    try {
        if (val === undefined) return localStorage.getItem('fb:' + key);
        localStorage.setItem('fb:' + key, val);
    } catch (_) { return null; }
}
function _storeJSON(key, val) {
    try {
        if (val === undefined) return JSON.parse(localStorage.getItem('fb:' + key) || 'null');
        localStorage.setItem('fb:' + key, JSON.stringify(val));
    } catch (_) { return null; }
}

// ── State ─────────────────────────────────────────────────────────────
let _tree        = null;   // { folders: [], root_songs: [] } from backend
let _openFolders = new Set(_storeJSON('open') || []);
let _query       = '';
let _loaded      = false;

// ── DOM refs (resolved lazily after screen HTML is in the DOM) ────────
function _el(id)   { return document.getElementById(id); }
function _tree_el() { return _el('fb-tree'); }

// ── Status line ───────────────────────────────────────────────────────
function _status(msg, isErr) {
    const el = _el('fb-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-xs ml-1 ' + (isErr ? 'text-red-400' : 'text-gray-500');
}

// ── Fetch ─────────────────────────────────────────────────────────────
async function _load() {
    _status('Loading…');
    try {
        const res  = await fetch('/api/plugin/folder_browser/tree');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.error) { _status('⚠ ' + data.error, true); return; }
        _tree   = data;
        _loaded = true;
        _status('');
        _render();
    } catch (err) {
        _status('Load failed: ' + err.message, true);
    }
}

// ── Filter helpers ────────────────────────────────────────────────────
function _match(song) {
    if (!_query) return true;
    const q = _query.toLowerCase();
    return (
        (song.title  || '').toLowerCase().includes(q) ||
        (song.artist || '').toLowerCase().includes(q) ||
        (song.album  || '').toLowerCase().includes(q) ||
        song.filename.toLowerCase().includes(q)
    );
}

function _filtered() {
    if (!_tree) return { folders: [], root_songs: [] };
    if (!_query) return _tree;
    const folders = _tree.folders
        .map(f => ({ name: f.name, songs: f.songs.filter(_match) }))
        .filter(f => f.songs.length);
    return { folders, root_songs: _tree.root_songs.filter(_match) };
}

// ── Song row ──────────────────────────────────────────────────────────
function _songRow(song) {
    const row = document.createElement('button');
    row.className = [
        'w-full flex items-center gap-3 px-3 py-2 rounded text-left',
        'hover:bg-dark-500 group transition-colors duration-100',
    ].join(' ');
    row.dataset.filename = song.filename;

    // play chevron
    const icon = document.createElement('span');
    icon.className = 'shrink-0 w-4 h-4 text-dark-400 group-hover:text-blue-400 transition-colors';
    icon.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
        <path fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
              clip-rule="evenodd"/></svg>`;

    // title + artist line
    const meta = document.createElement('div');
    meta.className = 'flex-1 min-w-0';

    const title = document.createElement('div');
    title.className = 'text-sm text-gray-200 truncate group-hover:text-white';
    title.textContent = song.title || song.filename;

    const sub = document.createElement('div');
    sub.className = 'text-xs text-gray-500 truncate';
    sub.textContent = [song.artist, song.album].filter(Boolean).join(' — ') || '';

    meta.appendChild(title);
    meta.appendChild(sub);

    row.appendChild(icon);
    row.appendChild(meta);

    // duration
    if (song.duration != null) {
        const dur = document.createElement('span');
        dur.className = 'shrink-0 text-xs text-gray-600 tabular-nums';
        const m = Math.floor(song.duration / 60);
        const s = String(Math.floor(song.duration % 60)).padStart(2, '0');
        dur.textContent = m + ':' + s;
        row.appendChild(dur);
    }

    row.addEventListener('click', function () {
        if (typeof window.playSong === 'function') window.playSong(song.filename);
    });

    return row;
}

// ── Folder section ────────────────────────────────────────────────────
function _folderSection(folder) {
    // In search mode force-open all folders
    const open = _query ? true : _openFolders.has(folder.name);

    const wrap = document.createElement('div');

    // Header button
    const hdr = document.createElement('button');
    hdr.className = [
        'w-full flex items-center gap-2 px-3 py-2 rounded text-left',
        'hover:bg-dark-500 transition-colors duration-100',
    ].join(' ');
    hdr.setAttribute('aria-expanded', String(open));

    // chevron
    const chev = document.createElement('span');
    chev.className = 'shrink-0 w-4 h-4 text-gray-500 transition-transform duration-150';
    chev.style.transform = open ? 'rotate(90deg)' : '';
    chev.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
        <path fill-rule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clip-rule="evenodd"/></svg>`;

    // folder icon
    const ico = document.createElement('span');
    ico.className = 'shrink-0 w-4 h-4 text-yellow-500';
    ico.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`;

    const lbl = document.createElement('span');
    lbl.className = 'flex-1 text-sm font-medium text-gray-200 truncate';
    lbl.textContent = folder.name;

    const cnt = document.createElement('span');
    cnt.className = 'shrink-0 text-xs text-gray-600 tabular-nums';
    cnt.textContent = String(folder.songs.length);

    hdr.appendChild(chev);
    hdr.appendChild(ico);
    hdr.appendChild(lbl);
    hdr.appendChild(cnt);

    // Song list
    const list = document.createElement('div');
    list.className = 'ml-5 mt-0.5 space-y-0 overflow-hidden';
    list.style.display = open ? '' : 'none';
    folder.songs.forEach(s => list.appendChild(_songRow(s)));

    hdr.addEventListener('click', function () {
        if (_query) return;
        const nowOpen = list.style.display === 'none';
        list.style.display = nowOpen ? '' : 'none';
        chev.style.transform = nowOpen ? 'rotate(90deg)' : '';
        hdr.setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) _openFolders.add(folder.name);
        else         _openFolders.delete(folder.name);
        _storeJSON('open', [..._openFolders]);
    });

    wrap.appendChild(hdr);
    wrap.appendChild(list);
    return wrap;
}

// ── Render ────────────────────────────────────────────────────────────
function _render() {
    const treeEl = _tree_el();
    if (!treeEl) return;

    const data = _filtered();
    const frag = document.createDocumentFragment();

    // Root-level songs under an "Unsorted" label
    if (data.root_songs.length) {
        const sec = document.createElement('div');
        sec.className = 'mb-2';

        const lbl = document.createElement('div');
        lbl.className = 'flex items-center gap-2 px-3 py-1';
        lbl.innerHTML = `
            <span class="w-4 h-4 shrink-0 text-gray-600">
              <svg viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                <path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
              </svg>
            </span>
            <span class="text-xs font-semibold uppercase tracking-widest text-gray-600">Unsorted</span>`;

        sec.appendChild(lbl);
        data.root_songs.forEach(s => sec.appendChild(_songRow(s)));
        frag.appendChild(sec);
    }

    // Folder sections
    data.folders.forEach(f => frag.appendChild(_folderSection(f)));

    // Empty state
    if (!data.folders.length && !data.root_songs.length) {
        const emp = document.createElement('div');
        emp.className = 'flex flex-col items-center justify-center py-24 gap-3 text-gray-700';
        emp.innerHTML = `
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"
                 class="w-12 h-12">
              <path d="M6 12a4 4 0 014-4h8l4 4h16a4 4 0 014 4v20a4 4 0 01-4 4H10a4 4 0 01-4-4V12z"/>
            </svg>
            <p class="text-sm">${_query ? 'No songs match your search.' : 'No songs found.'}</p>`;
        frag.appendChild(emp);
    }

    // Restore scroll
    const prevScroll = parseInt(_store('scroll') || '0', 10);
    treeEl.innerHTML = '';
    treeEl.appendChild(frag);
    if (!_query) treeEl.scrollTop = prevScroll;
}

// ── Expand / collapse all ─────────────────────────────────────────────
function _expandAll() {
    if (!_tree) return;
    _tree.folders.forEach(f => _openFolders.add(f.name));
    _storeJSON('open', [..._openFolders]);
    _render();
}
function _collapseAll() {
    _openFolders.clear();
    _storeJSON('open', []);
    _render();
}

// ── Init ──────────────────────────────────────────────────────────────
function _init() {
    const search      = _el('fb-search');
    const reload      = _el('fb-reload');
    const expandAll   = _el('fb-expand-all');
    const collapseAll = _el('fb-collapse-all');
    const treeEl      = _tree_el();

    if (!search) return;   // screen HTML not in DOM yet

    search.addEventListener('input', function (e) {
        _query = e.target.value.trim();
        _render();
    });
    reload.addEventListener('click', function () {
        _loaded = false;
        _load();
    });
    expandAll.addEventListener('click', _expandAll);
    collapseAll.addEventListener('click', _collapseAll);
    treeEl.addEventListener('scroll', function () {
        _store('scroll', treeEl.scrollTop);
    }, { passive: true });

    // Load data on first visit
    if (!_loaded) _load();
}

// ── React to screen changes (from app_tour_library/script.js pattern) ─
// Use slopsmith event bus — same as how the tour plugin watches screens.
function _onScreenChanged(ev) {
    const id = ev && ev.detail && ev.detail.id;
    if (id === SCREEN_ID && !_loaded) _load();
}

if (window.slopsmith && typeof window.slopsmith.on === 'function') {
    window.slopsmith.on('screen:changed', _onScreenChanged);
} else {
    // slopsmith bus not ready yet — poll briefly (same pattern as tour plugin)
    var _deadline = performance.now() + 5000;
    var _pollId = setInterval(function () {
        if (window.slopsmith && typeof window.slopsmith.on === 'function') {
            clearInterval(_pollId);
            window.slopsmith.on('screen:changed', _onScreenChanged);
        } else if (performance.now() > _deadline) {
            clearInterval(_pollId);
        }
    }, 100);
}

// ── Keyboard shortcut: / to focus search ─────────────────────────────
if (typeof window.registerShortcut === 'function') {
    window.registerShortcut({
        key: '/',
        description: 'Focus folder search',
        scope: 'plugin-' + PLUGIN_ID,
        handler: function (e) {
            e.preventDefault();
            var s = _el('fb-search');
            if (s) { s.focus(); s.select(); }
        },
    });
}

// ── Wait for DOM then wire up ─────────────────────────────────────────
// The plugin loader injects screen.html before running screen.js,
// so the elements should already exist — but guard anyway.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init, { once: true });
} else {
    _init();
}

})();
