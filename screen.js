/* Folder Browser — screen.js
 * Plain JS, global scope, IIFE. Follows slopsmith plugin conventions.
 */
(function () {
'use strict';

const PLUGIN_ID  = 'folder_organizer';
const SCREEN_ID  = 'plugin-' + PLUGIN_ID;
const API        = '/api/plugin/folder_organizer';

// ── Safe localStorage helpers ─────────────────────────────────────────
function _store(key, val) {
    try {
        if (val === undefined) return localStorage.getItem('fo:' + key);
        localStorage.setItem('fo:' + key, val);
    } catch (_) { return null; }
}
function _storeJSON(key, val) {
    try {
        if (val === undefined) return JSON.parse(localStorage.getItem('fo:' + key) || 'null');
        localStorage.setItem('fo:' + key, JSON.stringify(val));
    } catch (_) { return null; }
}

// ── State ─────────────────────────────────────────────────────────────
let _tree        = null;
let _openFolders = new Set(_storeJSON('open') || []);
let _unsortedOpen = _store('unsorted_open') !== 'false';
let _query       = '';
let _loaded      = false;
let _view        = _store('view') || 'list'; // 'list' | 'grid'
let _sort        = _store('sort') || 'default'; // 'default' | 'title' | 'artist' | 'duration'
let _sortDir     = _store('sortDir') || 'asc';  // 'asc' | 'desc'

// ── Filter constants ──────────────────────────────────────────────────
const _ARRANGEMENTS = ['Lead', 'Rhythm', 'Bass', 'Combo'];
const _STEMS        = ['Drums', 'Bass', 'Vocals', 'Guitar', 'Piano', 'Other'];

var _filtersRaw = _storeJSON('filters') || {};
let _filters = {
    arrangements: _filtersRaw.arrangements || {},
    stems:        _filtersRaw.stems        || {},
    lyrics:       _filtersRaw.lyrics       || 'any',
    tunings:      _filtersRaw.tunings      || [],
};

// ── DOM helpers ───────────────────────────────────────────────────────
function _el(id) { return document.getElementById(id); }


// ── Force screen to have height (Slopsmith .screen has no height set) ─
function _fixHeight() {
    const el = document.getElementById('plugin-' + PLUGIN_ID);
    const nav = document.querySelector('nav');
    const navH = nav ? nav.offsetHeight : 64;
    if (el) el.style.minHeight = (window.innerHeight - navH) + 'px';
}

// ── Close the nav plugin dropdown (it sits at z-50 and blocks clicks) ─
function _closeDropdown() {
    var dd = _el('plugin-dropdown');
    if (dd) dd.classList.add('hidden');
}

// ── Status ────────────────────────────────────────────────────────────
function _status(msg, isErr) {
    const el = _el('fb-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-xs ml-1 ' + (isErr ? 'text-red-400' : 'text-gray-500');
}

// ── API helpers ───────────────────────────────────────────────────────
async function _api(path, body) {
    const opts = body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body) }
        : {};
    const res = await fetch(API + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// ── Fetch tree ────────────────────────────────────────────────────────
async function _load() {
    _status('Loading…');
    try {
        const data = await _api('/tree');
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
    const hasQuery   = !!_query;
    const hasFilters = _activeFilterCount() > 0;
    if (!hasQuery && !hasFilters) return _tree;
    function _keep(s) {
        return (!hasQuery || _match(s)) && (!hasFilters || _matchFilters(s));
    }
    const folders = _tree.folders
        .map(function (f) { return { name: f.name, songs: f.songs.filter(_keep) }; })
        .filter(function (f) { return f.songs.length; });
    return { folders: folders, root_songs: _tree.root_songs.filter(_keep) };
}

// ── Filter helpers ────────────────────────────────────────────────────
function _saveFilters() {
    _storeJSON('filters', _filters);
}

function _activeFilterCount() {
    var n = 0;
    Object.values(_filters.arrangements).forEach(function (v) { if (v !== 'any') n++; });
    Object.values(_filters.stems).forEach(function (v) { if (v !== 'any') n++; });
    if (_filters.lyrics !== 'any') n++;
    n += (_filters.tunings || []).length;
    return n;
}

function _matchFilters(song) {
    // Arrangements
    var arr = song.arrangements || [];
    var arrF = _filters.arrangements || {};
    for (var a in arrF) {
        if (arrF[a] === 'require' && arr.indexOf(a) === -1) return false;
        if (arrF[a] === 'exclude' && arr.indexOf(a) !== -1) return false;
    }
    // Stems
    var stems = song.stems || [];
    var stemsF = _filters.stems || {};
    for (var s in stemsF) {
        if (stemsF[s] === 'require' && stems.indexOf(s) === -1) return false;
        if (stemsF[s] === 'exclude' && stems.indexOf(s) !== -1) return false;
    }
    // Lyrics
    if (_filters.lyrics === 'require' && !song.lyrics) return false;
    if (_filters.lyrics === 'exclude' &&  song.lyrics) return false;
    // Tunings
    var tunings = _filters.tunings || [];
    if (tunings.length && tunings.indexOf(song.tuning) === -1) return false;
    return true;
}

function _getTunings() {
    if (!_tree) return [];
    var counts = {};
    var allSongs = _tree.root_songs.concat(
        _tree.folders.reduce(function (acc, f) { return acc.concat(f.songs); }, [])
    );
    allSongs.forEach(function (s) {
        if (s.tuning) counts[s.tuning] = (counts[s.tuning] || 0) + 1;
    });
    return Object.keys(counts)
        .sort(function (a, b) { return counts[b] - counts[a]; })
        .map(function (t) { return { tuning: t, count: counts[t] }; });
}

function _cyclePillState(cur) {
    return cur === 'any' ? 'require' : cur === 'require' ? 'exclude' : 'any';
}

function _applyPillStyle(el, state) {
    if (state === 'require') {
        el.style.background   = '#1d4ed8';
        el.style.borderColor  = '#2563eb';
        el.style.color        = '#fff';
    } else if (state === 'exclude') {
        el.style.background   = '#7f1d1d';
        el.style.borderColor  = '#991b1b';
        el.style.color        = '#fca5a5';
    } else {
        el.style.background   = 'transparent';
        el.style.borderColor  = '#374151';
        el.style.color        = '#6b7280';
    }
}

function _pillLabel(state, name) {
    return (state === 'require' ? '✓ ' : state === 'exclude' ? '✕ ' : '') + name;
}

function _updateFilterBadge() {
    var badge = _el('fb-filter-badge');
    if (!badge) return;
    var n = _activeFilterCount();
    badge.style.display = n ? 'block' : 'none';
    badge.textContent   = String(n);
}

// ── Filter panel sections ─────────────────────────────────────────────
function _makePillSection(sectionTitle, subtitle, items, filterKey) {
    var section = document.createElement('div');
    section.style.marginBottom = '20px';

    var hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#6b7280; margin-bottom:4px;';
    hdr.textContent = sectionTitle;
    section.appendChild(hdr);

    if (subtitle) {
        var sub = document.createElement('div');
        sub.style.cssText = 'font-size:11px; color:#4b5563; margin-bottom:8px;';
        sub.textContent = subtitle;
        section.appendChild(sub);
    }

    var pills = document.createElement('div');
    pills.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';

    items.forEach(function (item) {
        var state = (_filters[filterKey] || {})[item] || 'any';
        var pill = document.createElement('button');
        pill.style.cssText = 'padding:4px 12px; border-radius:20px; border:1px solid; font-size:12px; cursor:pointer;';
        _applyPillStyle(pill, state);
        pill.textContent = _pillLabel(state, item);
        pill.addEventListener('click', function () {
            if (!_filters[filterKey]) _filters[filterKey] = {};
            var next = _cyclePillState((_filters[filterKey][item] || 'any'));
            _filters[filterKey][item] = next;
            _saveFilters();
            _applyPillStyle(pill, next);
            pill.textContent = _pillLabel(next, item);
            _updateFilterBadge();
            _render();
        });
        pills.appendChild(pill);
    });

    section.appendChild(pills);
    return section;
}

function _makeLyricsSection() {
    var section = document.createElement('div');
    section.style.marginBottom = '20px';

    var hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#6b7280; margin-bottom:8px;';
    hdr.textContent = 'LYRICS';
    section.appendChild(hdr);

    var state = _filters.lyrics || 'any';
    var pill = document.createElement('button');
    pill.style.cssText = 'padding:4px 12px; border-radius:20px; border:1px solid; font-size:12px; cursor:pointer;';
    _applyPillStyle(pill, state);
    pill.textContent = _pillLabel(state, 'Lyrics');
    pill.addEventListener('click', function () {
        var next = _cyclePillState(_filters.lyrics || 'any');
        _filters.lyrics = next;
        _saveFilters();
        _applyPillStyle(pill, next);
        pill.textContent = _pillLabel(next, 'Lyrics');
        _updateFilterBadge();
        _render();
    });
    section.appendChild(pill);
    return section;
}

function _makeTuningSection() {
    var section = document.createElement('div');
    section.style.marginBottom = '20px';

    var tunings = _getTunings();
    if (!tunings.length) return section;

    // header row with "N selected / All tunings" label
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';

    var titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#6b7280;';
    titleEl.textContent = 'TUNING';

    var allLbl = document.createElement('span');
    allLbl.style.cssText = 'font-size:11px; color:#6b7280;';
    function _updateAllLbl() {
        var n = (_filters.tunings || []).length;
        allLbl.textContent = n ? n + ' selected' : 'All tunings';
    }
    _updateAllLbl();

    titleRow.appendChild(titleEl);
    titleRow.appendChild(allLbl);
    section.appendChild(titleRow);

    var list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:2px;';

    tunings.forEach(function (entry) {
        var row = document.createElement('label');
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:5px 4px; cursor:pointer; border-radius:4px;';
        row.addEventListener('mouseenter', function () { row.style.background = '#111827'; });
        row.addEventListener('mouseleave', function () { row.style.background = ''; });

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = 'width:14px; height:14px; accent-color:#3b82f6; cursor:pointer; flex-shrink:0;';
        cb.checked = (_filters.tunings || []).indexOf(entry.tuning) !== -1;

        var lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1; font-size:13px; color:#d1d5db;';
        lbl.textContent = entry.tuning;

        var cnt = document.createElement('span');
        cnt.style.cssText = 'font-size:12px; color:#6b7280; font-variant-numeric:tabular-nums;';
        cnt.textContent = entry.count;

        cb.addEventListener('change', function () {
            if (!_filters.tunings) _filters.tunings = [];
            if (cb.checked) {
                if (_filters.tunings.indexOf(entry.tuning) === -1)
                    _filters.tunings.push(entry.tuning);
            } else {
                _filters.tunings = _filters.tunings.filter(function (t) { return t !== entry.tuning; });
            }
            _saveFilters();
            _updateAllLbl();
            _updateFilterBadge();
            _render();
        });

        row.appendChild(cb);
        row.appendChild(lbl);
        row.appendChild(cnt);
        list.appendChild(row);
    });

    section.appendChild(list);
    return section;
}

// ── Filter panel open / close ─────────────────────────────────────────
function _buildFilterPanel() {
    var panel = _el('fb-filter-panel');
    if (!panel) return;
    panel.innerHTML = '';

    // header
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid #1f2937; flex-shrink:0;';
    var titleEl = document.createElement('span');
    titleEl.style.cssText = 'font-size:15px; font-weight:600; color:#e5e7eb;';
    titleEl.textContent = 'Filters';
    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'padding:4px; color:#6b7280; background:none; border:none; cursor:pointer; border-radius:4px;';
    closeBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';
    closeBtn.addEventListener('click', _closeFilterPanel);
    hdr.appendChild(titleEl);
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    // scrollable content
    var content = document.createElement('div');
    content.style.cssText = 'overflow-y:auto; flex:1; padding:16px 20px;';
    content.appendChild(_makePillSection('ARRANGEMENTS', 'Click cycles: any → require → exclude', _ARRANGEMENTS, 'arrangements'));
    content.appendChild(_makePillSection('STEMS (sloppak)', 'Click cycles: any → require → exclude', _STEMS, 'stems'));
    content.appendChild(_makeLyricsSection());
    content.appendChild(_makeTuningSection());
    panel.appendChild(content);

    // footer
    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-top:1px solid #1f2937; flex-shrink:0;';
    var clearBtn = document.createElement('button');
    clearBtn.style.cssText = 'font-size:13px; color:#6b7280; background:none; border:none; cursor:pointer; padding:0;';
    clearBtn.textContent = 'Clear all';
    clearBtn.addEventListener('click', function () {
        _filters = { arrangements: {}, stems: {}, lyrics: 'any', tunings: [] };
        _saveFilters();
        _updateFilterBadge();
        _render();
        _buildFilterPanel(); // reset pill states
    });
    var doneBtn = document.createElement('button');
    doneBtn.style.cssText = 'padding:6px 20px; border-radius:6px; border:none; background:#3b82f6; color:#fff; font-size:13px; cursor:pointer; font-weight:500;';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', _closeFilterPanel);
    footer.appendChild(clearBtn);
    footer.appendChild(doneBtn);
    panel.appendChild(footer);
}

function _openFilterPanel() {
    _buildFilterPanel();
    var panel    = _el('fb-filter-panel');
    var backdrop = _el('fb-filter-backdrop');
    if (panel)    panel.style.display    = 'flex';
    if (backdrop) backdrop.style.display = 'block';
}

function _closeFilterPanel() {
    var panel    = _el('fb-filter-panel');
    var backdrop = _el('fb-filter-backdrop');
    if (panel)    panel.style.display    = 'none';
    if (backdrop) backdrop.style.display = 'none';
}

// ── Sort helper ───────────────────────────────────────────────────────
function _sortSongs(songs) {
    if (_sort === 'default') return songs;
    var arr = songs.slice();
    if (_sort === 'title') {
        arr.sort(function (a, b) {
            return (a.title || a.filename).localeCompare(b.title || b.filename);
        });
    } else if (_sort === 'artist') {
        arr.sort(function (a, b) {
            return (a.artist || '').localeCompare(b.artist || '');
        });
    } else if (_sort === 'duration') {
        arr.sort(function (a, b) {
            return (a.duration || 0) - (b.duration || 0);
        });
    } else if (_sort === 'year') {
        arr.sort(function (a, b) {
            return (a.year || 0) - (b.year || 0);
        });
    } else if (_sort === 'tuning') {
        arr.sort(function (a, b) {
            return (a.tuning || '').localeCompare(b.tuning || '');
        });
    } else if (_sort === 'added') {
        arr.sort(function (a, b) {
            return (a.added || 0) - (b.added || 0);
        });
    }
    if (_sortDir === 'desc') arr.reverse();
    return arr;
}

// ── Custom modal (Electron blocks prompt/confirm) ─────────────────────
function _showModal(msg, withInput, defaultVal) {
    return new Promise(function (resolve) {
        const modal  = _el('fb-modal');
        const msgEl  = _el('fb-modal-msg');
        const input  = _el('fb-modal-input');
        const okBtn  = _el('fb-modal-ok');
        const cancel = _el('fb-modal-cancel');
        if (!modal) { resolve(null); return; }

        msgEl.textContent = msg;
        if (withInput) {
            input.style.display = 'block';
            input.value = defaultVal || '';
            setTimeout(function () { input.focus(); input.select(); }, 50);
        } else {
            input.style.display = 'none';
        }
        modal.style.display = 'flex';

        function _done(val) {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', _ok);
            cancel.removeEventListener('click', _cancel);
            input.removeEventListener('keydown', _key);
            resolve(val);
        }
        function _ok()     { _done(withInput ? input.value.trim() : true); }
        function _cancel() { _done(null); }
        function _key(e) {
            if (e.key === 'Enter')  { e.preventDefault(); _ok(); }
            if (e.key === 'Escape') { e.preventDefault(); _cancel(); }
        }

        okBtn.addEventListener('click', _ok);
        cancel.addEventListener('click', _cancel);
        if (withInput) input.addEventListener('keydown', _key);
    });
}

function _confirm(msg)         { return _showModal(msg, false, ''); }
function _prompt(msg, def)     { return _showModal(msg, true,  def || ''); }

// ── Song card (grid view) ─────────────────────────────────────────────
function _songCard(song, folderName) {
    const card = document.createElement('div');
    card.className = 'flex flex-col rounded-lg overflow-hidden cursor-pointer group transition-transform duration-100 hover:scale-105';
    card.style.background = '#1a1d2e';
    card.dataset.filename = song.filename;

    // art
    const artWrap = document.createElement('div');
    artWrap.style.cssText = 'position:relative; width:100%; padding-bottom:100%; background:#111827; overflow:hidden;';

    const img = document.createElement('img');
    img.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover;';
    img.alt = '';
    img.loading = 'lazy';
    img.src = '/api/song/' + song.filename.split('/').map(encodeURIComponent).join('/') + '/art';

    // placeholder shown while loading or on error
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;';
    placeholder.innerHTML = `<svg viewBox="0 0 48 48" fill="none" stroke="#374151" stroke-width="1.5" style="width:40px;height:40px">
        <path d="M6 12a4 4 0 014-4h4l4 4h16a4 4 0 014 4v16a4 4 0 01-4 4H10a4 4 0 01-4-4V12z"/>
        <circle cx="20" cy="26" r="3"/><path d="M23 26v-8l8-2v8"/><circle cx="31" cy="24" r="3"/>
    </svg>`;

    img.addEventListener('error', function () {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
    });
    img.addEventListener('load', function () {
        placeholder.style.display = 'none';
    });

    // duration badge
    if (song.duration != null) {
        const badge = document.createElement('span');
        badge.style.cssText = 'position:absolute; bottom:6px; right:6px; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:600; color:#e5e7eb; background:rgba(0,0,0,0.7);';
        const m = Math.floor(song.duration / 60);
        const s = String(Math.floor(song.duration % 60)).padStart(2, '0');
        badge.textContent = m + ':' + s;
        artWrap.appendChild(badge);
    }

    artWrap.appendChild(placeholder);
    artWrap.appendChild(img);

    // meta
    const meta = document.createElement('div');
    meta.style.cssText = 'padding:8px 10px 10px; flex:1; min-width:0;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px; font-weight:600; color:#e5e7eb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
    title.textContent = song.title || song.filename;

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px; color:#6b7280; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;';
    sub.textContent = [song.artist, song.album].filter(Boolean).join(' — ') || '';

    // move button
    const moveBtn = document.createElement('button');
    moveBtn.style.cssText = 'position:absolute; top:6px; right:6px; padding:4px; border-radius:4px; background:rgba(0,0,0,0.6); color:#9ca3af; border:none; cursor:pointer; display:none;';
    moveBtn.title = 'Move to folder…';
    moveBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
        <path fill-rule="evenodd" d="M10 11a1 1 0 011 1v2h2a1 1 0 110 2h-2v2a1 1 0 11-2 0v-2H7a1 1 0 110-2h2v-2a1 1 0 011-1z" clip-rule="evenodd"/>
    </svg>`;
    card.addEventListener('mouseenter', function () { moveBtn.style.display = 'block'; });
    card.addEventListener('mouseleave', function () { moveBtn.style.display = 'none'; });
    moveBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _moveSong(song, folderName);
    });

    artWrap.style.position = 'relative';
    artWrap.appendChild(moveBtn);

    meta.appendChild(title);
    meta.appendChild(sub);
    card.appendChild(artWrap);
    card.appendChild(meta);

    card.addEventListener('click', function () {
        if (typeof window.playSong === 'function') window.playSong(song.filename);
    });

    _makeDraggable(card, song, folderName);
    return card;
}

// ── Song row ──────────────────────────────────────────────────────────
function _songRow(song, folderName) {
    const row = document.createElement('div');
    row.className = [
        'flex items-center gap-3 px-3 py-2 rounded cursor-pointer',
        'hover:bg-dark-500 group transition-colors duration-100',
    ].join(' ');
    row.dataset.filename = song.filename;

    // small album art thumbnail
    const thumb = document.createElement('div');
    thumb.style.cssText = 'shrink:0; width:36px; height:36px; border-radius:4px; overflow:hidden; background:#111827; flex-shrink:0; position:relative;';
    const thumbImg = document.createElement('img');
    thumbImg.loading = 'lazy';
    thumbImg.src = '/api/song/' + song.filename.split('/').map(encodeURIComponent).join('/') + '/art';
    thumbImg.alt = '';
    thumbImg.style.cssText = 'width:100%; height:100%; object-fit:cover;';
    const thumbPlaceholder = document.createElement('div');
    thumbPlaceholder.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;';
    thumbPlaceholder.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="#374151" stroke-width="1.5" style="width:14px;height:14px">
        <path d="M9 19H5a2 2 0 01-2-2V7a2 2 0 012-2h2l2 2h6a2 2 0 012 2v2"/>
        <circle cx="13" cy="16" r="2"/><path d="M15 16v-4l3-1v4"/><circle cx="18" cy="15" r="2"/>
    </svg>`;
    thumbImg.addEventListener('error', function () {
        thumbImg.style.display = 'none';
        thumbPlaceholder.style.display = 'flex';
    });
    thumbImg.addEventListener('load', function () {
        thumbPlaceholder.style.display = 'none';
    });
    thumb.appendChild(thumbPlaceholder);
    thumb.appendChild(thumbImg);

    // meta
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

    // play icon (right side)
    const icon = document.createElement('span');
    icon.className = 'shrink-0 w-4 h-4 text-dark-400 group-hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100';
    icon.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
        <path fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
              clip-rule="evenodd"/></svg>`;

    // duration
    const dur = document.createElement('span');
    dur.className = 'shrink-0 text-xs text-gray-600 tabular-nums';
    if (song.duration != null) {
        const m = Math.floor(song.duration / 60);
        const s = String(Math.floor(song.duration % 60)).padStart(2, '0');
        dur.textContent = m + ':' + s;
    }

    // move button (hidden until hover)
    const moveBtn = document.createElement('button');
    moveBtn.className = 'shrink-0 p-1 rounded text-gray-600 hover:text-white hover:bg-dark-400 opacity-0 group-hover:opacity-100 transition-opacity';
    moveBtn.title = 'Move to folder…';
    moveBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
        <path fill-rule="evenodd" d="M10 11a1 1 0 011 1v2h2a1 1 0 110 2h-2v2a1 1 0 11-2 0v-2H7a1 1 0 110-2h2v-2a1 1 0 011-1z" clip-rule="evenodd"/></svg>`;

    moveBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _moveSong(song, folderName);
    });

    row.appendChild(thumb);
    row.appendChild(meta);
    row.appendChild(icon);
    row.appendChild(dur);
    row.appendChild(moveBtn);

    row.addEventListener('click', function () {
        if (typeof window.playSong === 'function') window.playSong(song.filename);
    });

    _makeDraggable(row, song, folderName);
    return row;
}

// ── Pointer-based drag (mousedown/mousemove/mouseup) ─────────────────
// HTML5 DnD blocks wheel events and gives unreliable edge positions in
// Electron — pointer events give full control over both.
let _dragState         = null;
let _dragCurrentTarget = null;

const _DRAG_THRESH = 5;
const _DRAG_ZONE   = 150;
const _DRAG_SPEED  = 50;

let _dragRafId = null;
let _scrollEl          = null;

function _getScrollEl() {
    if (_scrollEl) return _scrollEl;
    var el = document.getElementById('fb-tree');
    while (el && el !== document.documentElement) {
        var ov = window.getComputedStyle(el).overflowY;
        if ((ov === 'auto' || ov === 'scroll' || ov === 'overlay') && el.scrollHeight > el.clientHeight) {
            _scrollEl = el;
            return _scrollEl;
        }
        el = el.parentElement;
    }
    _scrollEl = document.scrollingElement || document.documentElement;
    return _scrollEl;
}

function _dragFindTarget(x, y) {
    const els = document.elementsFromPoint(x, y);
    for (var i = 0; i < els.length; i++) {
        if ('dropFolder' in (els[i].dataset || {})) return els[i];
    }
    return null;
}

function _dragHighlight(target) {
    if (_dragCurrentTarget === target) return;
    if (_dragCurrentTarget) _dragCurrentTarget.style.outline = '';
    _dragCurrentTarget = target;
    if (target) {
        target.style.outline = '2px solid #3b82f6';
        target.style.borderRadius = '6px';
    }
}

function _dragScrollTick() {
    if (!_dragState || !_dragState.live) { _dragRafId = null; return; }
    var h  = window.innerHeight;
    var y  = _dragState.y;
    var sc = _getScrollEl();
    sc.style.scrollBehavior = 'auto';
    if (y < _DRAG_ZONE)           sc.scrollTop -= _DRAG_SPEED;
    else if (y > h - _DRAG_ZONE)  sc.scrollTop += _DRAG_SPEED;
    _dragRafId = requestAnimationFrame(_dragScrollTick);
}

function _onDragMove(e) {
    if (!_dragState) return;
    _dragState.x = e.clientX;
    _dragState.y = e.clientY;

    if (!_dragState.live) {
        var dx = _dragState.x - _dragState.startX;
        var dy = _dragState.y - _dragState.startY;
        if (Math.sqrt(dx * dx + dy * dy) < _DRAG_THRESH) return;
        _dragState.live = true;
        var ghost = document.createElement('div');
        ghost.style.cssText = 'position:fixed; pointer-events:none; z-index:9999; ' +
            'padding:5px 12px; background:#1e2130; border:1px solid #3b82f6; ' +
            'border-radius:6px; color:#e5e7eb; font-size:12px; white-space:nowrap; ' +
            'box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        ghost.textContent = _dragState.data.label;
        document.body.appendChild(ghost);
        _dragState.ghost = ghost;
        if (!_dragRafId) _dragRafId = requestAnimationFrame(_dragScrollTick);
    }

    if (_dragState.ghost) {
        _dragState.ghost.style.left = (_dragState.x + 14) + 'px';
        _dragState.ghost.style.top  = (_dragState.y + 14) + 'px';
    }
    _dragHighlight(_dragFindTarget(_dragState.x, _dragState.y));
}

function _onDragUp(e) {
    if (!_dragState) return;
    var wasDrag = _dragState.live;
    var data    = _dragState.data;
    var x = e.clientX, y = e.clientY;
    _endPointerDrag();

    if (wasDrag) {
        // Suppress the click event that fires after mouseup so song doesn't play
        document.addEventListener('click', function (ce) {
            ce.stopPropagation();
            ce.preventDefault();
        }, { capture: true, once: true });
        var target = _dragFindTarget(x, y);
        if (target && data) {
            var targetFolder = target.dataset.dropFolder;
            if (targetFolder !== data.folder) _executeDrop(data, targetFolder);
        }
    }
}

function _onDragKeyDown(e) {
    if (e.key === 'Escape') _endPointerDrag();
}

function _endPointerDrag() {
    if (_dragRafId) { cancelAnimationFrame(_dragRafId); _dragRafId = null; }
    if (_dragState && _dragState.ghost) _dragState.ghost.remove();
    if (_dragCurrentTarget) { _dragCurrentTarget.style.outline = ''; _dragCurrentTarget = null; }
    document.body.style.userSelect = '';
    _dragState = null;
    document.removeEventListener('mousemove', _onDragMove);
    document.removeEventListener('mouseup', _onDragUp);
    document.removeEventListener('keydown', _onDragKeyDown);
}

async function _executeDrop(data, targetFolder) {
    let song = null;
    if (data.folder === '') {
        const idx = _tree.root_songs.findIndex(s => s.filename === data.filename);
        if (idx !== -1) song = _tree.root_songs.splice(idx, 1)[0];
    } else {
        const folder = _tree.folders.find(f => f.name === data.folder);
        if (folder) {
            const idx = folder.songs.findIndex(s => s.filename === data.filename);
            if (idx !== -1) song = folder.songs.splice(idx, 1)[0];
        }
    }
    if (!song) return;

    if (targetFolder === '') {
        _tree.root_songs.push(song);
        _unsortedOpen = true;
    } else {
        const dest = _tree.folders.find(f => f.name === targetFolder);
        if (dest) { dest.songs.push(song); _openFolders.add(targetFolder); }
    }
    _render();

    try {
        await _api('/song/move', { filename: data.filename, folder: targetFolder });
    } catch (err) {
        _status('Move failed: ' + err.message, true);
        await _load();
    }
}

function _makeDraggable(el, song, folderName) {
    el.style.cursor = 'grab';
    el.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        document.body.style.userSelect = 'none';
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        _dragState = {
            data: { filename: song.filename, folder: folderName || '', label: '↕  ' + (song.title || song.filename) },
            startX: e.clientX, startY: e.clientY,
            x: e.clientX, y: e.clientY,
            live: false, ghost: null,
        };
        document.addEventListener('mousemove', _onDragMove);
        document.addEventListener('mouseup', _onDragUp);
        document.addEventListener('keydown', _onDragKeyDown);
    });
    el.addEventListener('dragstart', function (e) { e.preventDefault(); });
}

function _makeDropTarget(el, targetFolder) {
    el.dataset.dropFolder = targetFolder == null ? '' : targetFolder;
}

// ── Move song dialog ──────────────────────────────────────────────────
async function _moveSong(song, currentFolder) {
    if (!_tree) return;
    const folderNames = _tree.folders.map(f => f.name).filter(n => n !== currentFolder);
    const options = ['(Unsorted)', ...folderNames];
    const choice = await _prompt(
        'Move "' + (song.title || song.filename) + '" to:\n' +
        options.map((n, i) => i + ': ' + n).join('\n') +
        '\n\nEnter number or folder name:',
        ''
    );
    if (!choice && choice !== 0) return;
    let dest = '';
    const idx = parseInt(choice, 10);
    if (!isNaN(idx) && idx >= 0 && idx < options.length) {
        dest = idx === 0 ? '' : options[idx];
    } else {
        dest = choice.trim() === '(Unsorted)' ? '' : choice.trim();
    }
    try {
        await _api('/song/move', { filename: song.filename, folder: dest });
        await _load();
    } catch (err) {
        await _prompt('Move failed: ' + err.message, '');
    }
}

// ── Folder header ─────────────────────────────────────────────────────
function _folderSection(folder) {
    const open = _query ? true : _openFolders.has(folder.name);
    const wrap = document.createElement('div');

    // header
    const hdr = document.createElement('div');
    hdr.className = [
        'flex items-center gap-2 px-3 py-2 rounded cursor-pointer',
        'hover:bg-dark-500 transition-colors duration-100 group',
    ].join(' ');

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
    cnt.className = 'shrink-0 text-xs text-gray-600 tabular-nums mr-1';
    cnt.textContent = String(folder.songs.length);

    // rename button
    const renameBtn = document.createElement('button');
    renameBtn.className = 'shrink-0 p-1 rounded text-gray-600 hover:text-white hover:bg-dark-400 opacity-0 group-hover:opacity-100 transition-opacity';
    renameBtn.title = 'Rename folder';
    renameBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>`;
    renameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _renameFolder(folder.name);
    });

    // delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'shrink-0 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-dark-400 opacity-0 group-hover:opacity-100 transition-opacity';
    delBtn.title = 'Delete folder';
    delBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
        <path fill-rule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clip-rule="evenodd"/></svg>`;
    delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _deleteFolder(folder.name, folder.songs.length);
    });

    hdr.appendChild(chev);
    hdr.appendChild(ico);
    hdr.appendChild(lbl);
    hdr.appendChild(cnt);
    hdr.appendChild(renameBtn);
    hdr.appendChild(delBtn);

    _makeDropTarget(hdr, folder.name);

    // song list/grid — only populated for open folders to keep initial render fast
    const list = document.createElement('div');
    if (_view === 'grid') {
        list.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; padding:8px 4px 8px 24px;';
    } else {
        list.className = 'ml-5 mt-0.5 space-y-0';
    }
    let _listPopulated = open;
    function _populateFolderList() {
        _sortSongs(folder.songs).forEach(function (s) {
            list.appendChild(_view === 'grid' ? _songCard(s, folder.name) : _songRow(s, folder.name));
        });
    }
    if (open) { _populateFolderList(); } else { list.style.display = 'none'; }
    _makeDropTarget(list, folder.name);

    hdr.addEventListener('click', function () {
        if (_query) return;
        const nowOpen = list.style.display === 'none';
        if (nowOpen && !_listPopulated) { _populateFolderList(); _listPopulated = true; }
        list.style.display = nowOpen ? (_view === 'grid' ? 'grid' : '') : 'none';
        chev.style.transform = nowOpen ? 'rotate(90deg)' : '';
        if (nowOpen) _openFolders.add(folder.name);
        else         _openFolders.delete(folder.name);
        _storeJSON('open', [..._openFolders]);
    });

    wrap.appendChild(hdr);
    wrap.appendChild(list);
    return wrap;
}

// ── Unsorted section ──────────────────────────────────────────────────
function _unsortedSection(songs) {
    if (!songs.length && _query) return null;
    const wrap = document.createElement('div');
    wrap.className = 'mb-1';

    const hdr = document.createElement('div');
    hdr.className = [
        'flex items-center gap-2 px-3 py-2 rounded cursor-pointer',
        'hover:bg-dark-500 transition-colors duration-100',
    ].join(' ');

    const chev = document.createElement('span');
    chev.className = 'shrink-0 w-4 h-4 text-gray-600 transition-transform duration-150';
    chev.style.transform = _unsortedOpen ? 'rotate(90deg)' : '';
    chev.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
        <path fill-rule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clip-rule="evenodd"/></svg>`;

    const ico = document.createElement('span');
    ico.className = 'shrink-0 w-4 h-4 text-gray-600';
    ico.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
        <path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`;

    const lbl = document.createElement('span');
    lbl.className = 'flex-1 text-xs font-semibold uppercase tracking-widest text-gray-600';
    lbl.textContent = 'Unsorted';

    const cnt = document.createElement('span');
    cnt.className = 'shrink-0 text-xs text-gray-700 tabular-nums';
    cnt.textContent = String(songs.length);

    hdr.appendChild(chev);
    hdr.appendChild(ico);
    hdr.appendChild(lbl);
    hdr.appendChild(cnt);

    _makeDropTarget(hdr, '');

    const list = document.createElement('div');
    if (_view === 'grid') {
        list.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; padding:8px 4px 8px 24px;';
    } else {
        list.className = 'ml-5 mt-0.5 space-y-0';
    }
    let _unsortedPopulated = _unsortedOpen;
    function _populateUnsortedList() {
        _sortSongs(songs).forEach(function (s) {
            list.appendChild(_view === 'grid' ? _songCard(s, '') : _songRow(s, ''));
        });
    }
    if (_unsortedOpen) { _populateUnsortedList(); } else { list.style.display = 'none'; }
    _makeDropTarget(list, '');

    hdr.addEventListener('click', function () {
        if (_query) return;
        _unsortedOpen = list.style.display === 'none';
        if (_unsortedOpen && !_unsortedPopulated) { _populateUnsortedList(); _unsortedPopulated = true; }
        list.style.display = _unsortedOpen ? (_view === 'grid' ? 'grid' : '') : 'none';
        chev.style.transform = _unsortedOpen ? 'rotate(90deg)' : '';
        _store('unsorted_open', String(_unsortedOpen));
    });

    wrap.appendChild(hdr);
    wrap.appendChild(list);
    return wrap;
}

// ── Folder management ─────────────────────────────────────────────────
async function _createFolder() {
    const name = await _prompt('New folder name:');
    if (!name || !name.trim()) return;
    try {
        await _api('/folder/create', { name: name.trim() });
        _openFolders.add(name.trim());
        await _load();
    } catch (err) {
        await _prompt('Create failed: ' + err.message);
    }
}

async function _renameFolder(oldName) {
    const newName = await _prompt('Rename "' + oldName + '" to:', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    try {
        await _api('/folder/rename', { old: oldName, new: newName.trim() });
        if (_openFolders.has(oldName)) {
            _openFolders.delete(oldName);
            _openFolders.add(newName.trim());
            _storeJSON('open', [..._openFolders]);
        }
        await _load();
    } catch (err) {
        await _prompt('Rename failed: ' + err.message);
    }
}

async function _deleteFolder(name, songCount) {
    const msg = songCount > 0
        ? 'Delete "' + name + '"? Its ' + songCount + ' song(s) will be moved to Unsorted.'
        : 'Delete empty folder "' + name + '"?';
    const ok = await _confirm(msg);
    if (!ok) return;
    try {
        await _api('/folder/delete', { name });
        _openFolders.delete(name);
        _storeJSON('open', [..._openFolders]);
        await _load();
    } catch (err) {
        await _prompt('Delete failed: ' + err.message);
    }
}

// ── Expand / collapse all ─────────────────────────────────────────────
function _expandAll() {
    if (!_tree) return;
    _tree.folders.forEach(f => _openFolders.add(f.name));
    _unsortedOpen = true;
    _storeJSON('open', [..._openFolders]);
    _store('unsorted_open', 'true');
    _render();
}
function _collapseAll() {
    _openFolders.clear();
    _unsortedOpen = false;
    _storeJSON('open', []);
    _store('unsorted_open', 'false');
    _render();
}

// ── Render ────────────────────────────────────────────────────────────
function _render() {
    const treeEl = _el('fb-tree');
    if (!treeEl) return;

    const data = _filtered();
    const frag = document.createDocumentFragment();

    // Unsorted
    const unsorted = _unsortedSection(data.root_songs);
    if (unsorted) frag.appendChild(unsorted);

    // Folders
    data.folders.forEach(f => frag.appendChild(_folderSection(f)));

    // Empty state
    if (!data.folders.length && !data.root_songs.length) {
        const emp = document.createElement('div');
        emp.className = 'flex flex-col items-center justify-center py-24 gap-3 text-gray-700';
        emp.innerHTML = `
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" class="w-12 h-12">
              <path d="M6 12a4 4 0 014-4h8l4 4h16a4 4 0 014 4v20a4 4 0 01-4 4H10a4 4 0 01-4-4V12z"/>
            </svg>
            <p class="text-sm">${_query ? 'No songs match your search.' : 'No songs found.'}</p>`;
        frag.appendChild(emp);
    }

    treeEl.innerHTML = '';
    treeEl.appendChild(frag);
}

// ── Init ──────────────────────────────────────────────────────────────
function _init() {
    _closeDropdown();
    _fixHeight();
    window.addEventListener('resize', _fixHeight);

    const search      = _el('fb-search');
    const reload      = _el('fb-reload');
    const expandAll   = _el('fb-expand-all');
    const collapseAll = _el('fb-collapse-all');
    const newFolder   = _el('fb-new-folder');
    const filterBtn   = _el('fb-filter');
    const filterBack  = _el('fb-filter-backdrop');
    const viewList    = _el('fb-view-list');
    const viewGrid    = _el('fb-view-grid');
    const treeEl      = _el('fb-tree');

    if (!search) return;

    // Force the search bar above any overlay
    search.style.position = 'relative';
    search.style.zIndex   = '100';

    function _updateViewButtons() {
        if (!viewList || !viewGrid) return;
        viewList.style.color = _view === 'list' ? '#ffffff' : '';
        viewList.style.background = _view === 'list' ? '#1f2937' : '';
        viewGrid.style.color = _view === 'grid' ? '#ffffff' : '';
        viewGrid.style.background = _view === 'grid' ? '#1f2937' : '';
    }
    _updateViewButtons();

    if (viewList) viewList.addEventListener('click', function () {
        if (_view === 'list') return;
        _view = 'list';
        _store('view', 'list');
        _updateViewButtons();
        _render();
    });
    if (viewGrid) viewGrid.addEventListener('click', function () {
        if (_view === 'grid') return;
        _view = 'grid';
        _store('view', 'grid');
        _updateViewButtons();
        _render();
    });

    const sortSel    = _el('fb-sort');
    const sortDirBtn = _el('fb-sort-dir');
    const sortDirIco = _el('fb-sort-dir-icon');

    function _updateSortDir() {
        if (!sortDirBtn) return;
        var isAsc = _sortDir === 'asc';
        var active = _sort !== 'default';
        sortDirBtn.title = isAsc ? 'Ascending' : 'Descending';
        sortDirBtn.style.opacity = active ? '' : '0.35';
        sortDirBtn.style.cursor  = active ? '' : 'default';
        if (sortDirIco) {
            // up chevron for asc, down chevron for desc
            sortDirIco.innerHTML = isAsc
                ? '<path d="M5 12l5-5 5 5"/>'
                : '<path d="M5 8l5 5 5-5"/>';
        }
    }
    _updateSortDir();

    if (sortSel) {
        sortSel.value = _sort;
        sortSel.addEventListener('change', function () {
            _sort = sortSel.value;
            _store('sort', _sort);
            _updateSortDir();
            _render();
        });
    }

    if (sortDirBtn) {
        sortDirBtn.addEventListener('click', function () {
            if (_sort === 'default') return;
            _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
            _store('sortDir', _sortDir);
            _updateSortDir();
            _render();
        });
    }

    search.addEventListener('input', function (e) {
        _query = e.target.value.trim();
        _render();
    });
    search.addEventListener('click', function (e) {
        e.stopPropagation();
        _closeDropdown();
    });

    reload.addEventListener('click', function () { _loaded = false; _load(); });
    expandAll.addEventListener('click', _expandAll);
    collapseAll.addEventListener('click', _collapseAll);
    newFolder.addEventListener('click', _createFolder);
    if (filterBtn)  filterBtn.addEventListener('click', _openFilterPanel);
    if (filterBack) filterBack.addEventListener('click', _closeFilterPanel);
    _updateFilterBadge();

    if (!_loaded) _load();
}

// ── Screen changed ────────────────────────────────────────────────────
function _onScreenChanged(ev) {
    const id = ev && ev.detail && ev.detail.id;
    if (id === SCREEN_ID) {
        _closeDropdown();
        if (!_loaded) _load();
    }
}

if (window.slopsmith && typeof window.slopsmith.on === 'function') {
    window.slopsmith.on('screen:changed', _onScreenChanged);
} else {
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

// ── Keyboard shortcut ─────────────────────────────────────────────────
if (typeof window.registerShortcut === 'function') {
    window.registerShortcut({
        key: '/',
        description: 'Focus folder search',
        scope: 'plugin-' + PLUGIN_ID,
        handler: function (e) {
            e.preventDefault();
            _closeDropdown();
            var s = _el('fb-search');
            if (s) { s.focus(); s.select(); }
        },
    });
}

// ── Boot ──────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init, { once: true });
} else {
    _init();
}

})();
