const KEYS = ['1','2','3','4','5','6','7','8','9','0','Q','W','E','R','T','Y','U','I','O','P','A','S','D','F','G','H','J','K','L','Z','X','C','V','B','N','M'];

const statusEl = document.querySelector('#status');
let statusTimer = null;

function showStatus(msg, isError) {
    clearTimeout(statusTimer);
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
    statusEl.classList.add('show');
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), 3500);
}

// Older versions stored a per-link favicon URL (chrome-extension://<id>/_favicon/...)
// alongside url/title. That's both redundant -- newtab.js already recomputes it
// on the fly from the url when it's missing -- and it roughly doubled the size
// of the saved data, which is what pushed chrome.storage.sync over its
// 8KB-per-item limit in the first place. Strip it on import so re-imported
// data doesn't drag the old bloat (or a stale extension-id-specific URL) back in.
// ponytail: tolerate hand-edited JSON (string shorthands, missing scheme,
// lowercase keys, BOM) instead of calling it invalid
function normUrl(u) {
    u = String(u == null ? '' : u).trim();
    if (!u) return '';
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = 'https://' + u;
    return u;
}
function normalizeLink(link) {
    if (typeof link === 'string') link = { url: link };
    if (!link || typeof link !== 'object') return null;
    const url = normUrl(link.url);
    if (!url) return null;
    const title = String(link.title || '').trim() || url;
    return { url, title };
}

function normalizeShortcut(raw) {
    if (typeof raw === 'string') raw = { primary: raw };
    if (!raw || typeof raw !== 'object') return { primary: null, secondary: [] };
    const primary = normalizeLink(raw.primary);
    let sec = raw.secondary;
    if (sec && !Array.isArray(sec)) sec = [sec];
    const secondary = Array.isArray(sec)
        ? sec.map(normalizeLink).filter(Boolean)
        : [];
    return { primary, secondary };
}

async function readShortcuts() {
    // Prefer the current storage area; fall back to the legacy sync area
    // in case this options page is opened before newtab.js has had a
    // chance to run its one-time migration.
    const local = await chrome.storage.local.get('shortcuts');
    if (local.shortcuts && Object.keys(local.shortcuts).length > 0) return local.shortcuts;
    const old = await chrome.storage.sync.get('shortcuts');
    return old.shortcuts || {};
}

document.querySelector('#export-btn').addEventListener('click', async () => {
    try {
        const shortcuts = await readShortcuts();
        const blob = new Blob([JSON.stringify(shortcuts, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'zst-backup.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showStatus('Exported');
    } catch (err) {
        showStatus('Export failed: ' + (err && err.message ? err.message : 'unknown error'), true);
    }
});

document.querySelector('#import-btn').addEventListener('click', () => {
    document.querySelector('#import-file').click();
});

document.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;

    // Step 1: parse the file. Only failures here are genuinely "invalid JSON".
    let data;
    try {
        const text = (await file.text()).replace(/^\uFEFF/, '');
        data = JSON.parse(text);
    } catch (err) {
        showStatus('Invalid JSON file', true);
        return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        showStatus('Invalid JSON file: expected an object of key to shortcut', true);
        return;
    }

    // Step 2: normalize and save. Failures here are storage problems, not
    // JSON problems, so they get their own distinct message instead of
    // being mislabeled as "Invalid JSON file".
    const upper = {};
    for (const k of Object.keys(data)) upper[String(k).toUpperCase()] = data[k];
    const shortcuts = {};
    for (const key of KEYS) shortcuts[key] = normalizeShortcut(upper[key]);
    try {
        await chrome.storage.local.set({ shortcuts });
        showStatus('Imported');
    } catch (err) {
        showStatus('Import failed to save: ' + (err && err.message ? err.message : 'storage error'), true);
    }
});

document.querySelector('#reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset all shortcuts to empty? This cannot be undone.')) return;
    const empty = {};
    for (const key of KEYS) empty[key] = { primary: null, secondary: [] };
    try {
        await chrome.storage.local.set({ shortcuts: empty });
        showStatus('Reset');
    } catch (err) {
        showStatus('Reset failed: ' + (err && err.message ? err.message : 'storage error'), true);
    }
});
