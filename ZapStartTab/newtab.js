const KEYS = ['1','2','3','4','5','6','7','8','9','0','Q','W','E','R','T','Y','U','I','O','P','A','S','D','F','G','H','J','K','L','Z','X','C','V','B','N','M'];
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

const keyboardLayout = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M']
];

let shortcuts = {};
let shiftDown = false;
let shiftLong = false;
let shiftTimer = null;
let holdKey = null;
let holdTimer = null;
let holdActive = false;
let downKey = null;
let mouseX = null;
let mouseY = null;
let mouseMoved = false;
let panelAnchorY = null;

const keyboardEl = document.getElementById('keyboard');
const timeEl = document.getElementById('time');
const settingsBtn = document.getElementById('settings-btn');
const panel = document.getElementById('link-panel');
const editModal = document.getElementById('edit-modal');
const modalOverlay = document.getElementById('modal-overlay');

function def() { return { primary: null, secondary: [] }; }
function sc(key) {
    if (!shortcuts[key]) shortcuts[key] = def();
    return shortcuts[key];
}
function time() {
    const n = new Date();
    timeEl.textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function favicon(url) {
    try {
        const full = chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(url) + '&size=32';
        return full.replace(/chrome-extension:\/\/[^/]+/, '');
    }
    catch { return ''; }
}
function hasLinks(key) {
    const s = sc(key);
    return (s.primary && s.primary.url) || (s.secondary && s.secondary.length > 0);
}
// ponytail: bare domains get https:// so saved links actually navigate
function normUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = 'https://' + u;
    return u;
}
function ctrlOff(e) { return !!(e.ctrlKey || e.metaKey); }
function anchorFor(key) {
    const t = keyboardEl.querySelector('.kb-key[data-key="' + key + '"]');
    if (t) { const r = t.getBoundingClientRect(); if (r.width) return [r.left + r.width / 2, r.top + r.height / 2]; }
    return [innerWidth / 2, innerHeight / 2];
}
function updateHover(mx, my) {
    panel.querySelectorAll('.lp-primary,.lp-secondary').forEach(el => {
        const r = el.getBoundingClientRect();
        el.classList.toggle('hover', mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom);
    });
}

function render() {
    keyboardEl.innerHTML = '';
    for (const row of keyboardLayout) {
        const r = document.createElement('div');
        r.className = 'kb-row';
        for (const key of row) {
            const s = sc(key);
            const t = document.createElement('div');
            t.className = 'kb-key';
            t.dataset.key = key;
            const l = document.createElement('span');
            l.className = 'kb-key-label';
            l.textContent = key;
            t.appendChild(l);
            if (s.primary) {
                const i = document.createElement('img');
                i.className = 'kb-key-icon';
                i.src = s.primary.icon || favicon(s.primary.url);
                i.alt = ''; i.draggable = false;
                i.onerror = () => { i.style.display = 'none'; };
                t.appendChild(i);
            }
            if (s.secondary && s.secondary.length > 0) {
                const b = document.createElement('span');
                b.className = 'kb-key-badge';
                b.textContent = s.secondary.length;
                t.appendChild(b);
            }
            r.appendChild(t);
        }
        keyboardEl.appendChild(r);
    }
}

function showKb() { keyboardEl.classList.add('visible'); }
function hideKb() { keyboardEl.classList.remove('visible'); hidePanel(); }
function go(url) { if (url) window.location.href = url; }
function goPri(key) { const s = sc(key); if (s.primary && s.primary.url) { go(s.primary.url); return true; } return false; }
function goSec(key, i) { const s = sc(key); if (s.secondary && s.secondary[i] && s.secondary[i].url) { go(s.secondary[i].url); return true; } return false; }

function openPanel(key, ax, ay, source) {
    if (typeof ax !== 'number' || typeof ay !== 'number') { const c = anchorFor(key); ax = c[0]; ay = c[1]; }
    // Remember the anchor: wheel and arrow navigation pan the panel relative to
    // a fixed focus point, and with no mouse in play that point is here.
    panelAnchorY = ay;
    hidePanel();
    const s = sc(key);

    if (!s.primary && (!s.secondary || s.secondary.length === 0)) return;

    panel.dataset.key = key;
    stepIndex = s.primary ? 0 : -1;

    if (s.primary) {
        const e = document.createElement('div');
        e.className = 'lp-primary';
        e.dataset.action = 'primary';
        const ic = document.createElement('img');
        ic.className = 'lp-icon'; ic.draggable = false;
        ic.src = s.primary.icon || favicon(s.primary.url);
        ic.alt = ''; ic.onerror = () => { ic.style.display = 'none'; };
        e.appendChild(ic);
        const tx = document.createElement('div');
        tx.className = 'lp-text';
        const ti = document.createElement('div');
        ti.className = 'lp-title'; ti.textContent = s.primary.title || 'Primary';
        tx.appendChild(ti);
        const u = document.createElement('div');
        u.className = 'lp-url';
        try { u.textContent = new URL(s.primary.url).hostname; } catch { u.textContent = s.primary.url; }
        tx.appendChild(u);
        e.appendChild(tx);
        e.addEventListener('mouseenter', () => {
            panel.querySelectorAll('.lp-primary,.lp-secondary').forEach(el => el.classList.remove('hover'));
            e.classList.add('hover');
        });
        panel.appendChild(e);
    }

    if (s.secondary) {
        for (let i = 0; i < s.secondary.length; i++) {
            const link = s.secondary[i];
            const e = document.createElement('div');
            e.className = 'lp-secondary';
            e.dataset.action = 'secondary';
            e.dataset.index = i;
            const ic = document.createElement('img');
            ic.className = 'lp-icon'; ic.draggable = false;
            ic.src = link.icon || favicon(link.url);
            ic.alt = ''; ic.onerror = () => { ic.style.display = 'none'; };
            e.appendChild(ic);
            const tx = document.createElement('div');
            tx.className = 'lp-text';
            const ti = document.createElement('div');
            ti.className = 'lp-title'; ti.textContent = link.title || 'Link ' + (i + 1);
            tx.appendChild(ti);
            const u = document.createElement('div');
            u.className = 'lp-url';
            try { u.textContent = new URL(link.url).hostname; } catch { u.textContent = link.url; }
            tx.appendChild(u);
            e.appendChild(tx);
            e.addEventListener('mouseenter', () => {
                panel.querySelectorAll('.lp-primary,.lp-secondary').forEach(el => el.classList.remove('hover'));
                e.classList.add('hover');
            });
            panel.appendChild(e);
        }
    }

    panel.style.display = 'block';
    panel.classList.remove('show');
    document.body.appendChild(panel);

    requestAnimationFrame(() => {
        const pw = panel.offsetWidth;
        const ph = panel.offsetHeight;
        const pri = panel.querySelector('.lp-primary');
        let offY = ph / 2;
        if (pri) offY = pri.offsetTop + pri.offsetHeight / 2;
        let x = ax - pw / 2;
        let y = ay - offY;
        if (x < 8) x = 8;
        if (y < 8) y = 8;
        if (x + pw > innerWidth - 8) x = innerWidth - 8 - pw;
        // ponytail: no bottom clamp — tall panels overflow instead of jumping, wheel pans them
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.classList.add('show');
    });
}

function hidePanel() {
    // A pan still in flight when the panel closes would otherwise keep the step
    // latch set, and the next panel's first step would be swallowed as a queued
    // follow-up instead of animating.
    panGen++;
    stepRunning = false;
    stepNext = null;
    stepIndex = -1;
    panel.classList.remove('show');
    panel.style.display = 'none';
    panel.innerHTML = '';
    delete panel.dataset.key;
}

// ---- Keyboard events ----

function isInputFocused() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    // Arrows are exempt: holding one should walk the list the way a fast wheel
    // spin does. Everything else keeps ignoring auto-repeat as before.
    if (e.repeat && !ARROWS.includes(e.key)) return;

    if (e.key === 'Escape') {
        if (editModal.classList.contains('visible')) {
            closeModal();
            return;
        }
        if (panel.dataset.key || shiftDown) {
            hidePanel();
            hideKb();
            shiftDown = false;
            shiftLong = false;
            clearTimeout(shiftTimer);
            clearKbState();
        }
        return;
    }

    if (isInputFocused()) return;
    if (ctrlOff(e)) return;

    // Arrows walk the open panel's link list, same one-per-press jump the wheel
    // does. Left/Right mirror Up/Down so the whole arrow cluster works.
    if (ARROWS.includes(e.key)) {
        if (!panel.dataset.key) return;
        e.preventDefault();
        stepItem(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
        return;
    }

    if (e.key === 'Shift') {
        shiftDown = true;
        showKb();
        shiftTimer = setTimeout(() => { shiftLong = true; }, 600);
        return;
    }

    const key = e.key.toUpperCase();
    if (!KEYS.includes(key)) return;

    e.preventDefault();
    clearTimeout(holdTimer);
    holdKey = key;
    let ax = mouseX, ay = mouseY;
    if (!mouseMoved) { const c = anchorFor(key); ax = c[0]; ay = c[1]; }
    openPanel(key, ax, ay, 'keyboard');
    const pri = panel.querySelector('.lp-primary');
    if (pri) pri.classList.add('hover');
});

document.addEventListener('keyup', (e) => {
    if (e.isComposing) return;
    if (isInputFocused()) return;

    if (e.key === 'Shift') {
        if (panel.dataset.key && !ctrlOff(e)) {
            const h = panel.querySelector('.hover');
            if (h) {
                if (h.dataset.action === 'primary') goPri(panel.dataset.key);
                else if (h.dataset.action === 'secondary') goSec(panel.dataset.key, parseInt(h.dataset.index));
            }
        }
        shiftDown = false;
        shiftLong = false;
        clearTimeout(shiftTimer);
        hidePanel();
        hideKb();
        clearKbState();
        return;
    }

    const key = e.key.toUpperCase();
    if (holdKey && key === holdKey) {
        holdKey = null;
        if (!shiftDown) {
            if (!ctrlOff(e)) {
                const h = panel.querySelector('.hover');
                if (h) {
                    if (h.dataset.action === 'primary') goPri(key);
                    else if (h.dataset.action === 'secondary') goSec(key, parseInt(h.dataset.index));
                }
            }
            hidePanel();
        }
    }
});

// ---- Mouse events ----

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    mouseMoved = true;

    if (!downKey && !panel.dataset.key) return;
    updateHover(e.clientX, e.clientY);
    let over = !!panel.querySelector('.hover');

    if (downKey && panel.dataset.key && !over) {
        const r = panel.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
            downKey = null;
            hidePanel();
        }
    }
});

// ponytail: one step — a wheel notch or an arrow key — snaps exactly one link
// onto the stationary focus point (80ms ease, hover recomputed along the way).
// The panel pans by however far the target sits from the focus point; the focus
// point itself never moves, so the list slides under a cursor that stays put.
let stepRunning = false;
let stepNext = null;
let stepRaf = 0;
// Bumped whenever the panel goes away, so a pan still in flight is abandoned
// instead of landing on the next panel that opens.
let panGen = 0;
let stepIndex = -1;

// Where the "cursor" is: the live mouse when one has been used, otherwise the
// point the panel was anchored to when it opened.
function focusY() {
    return mouseMoved && typeof mouseY === 'number' ? mouseY : panelAnchorY;
}

function setHover(el) {
    panel.querySelectorAll('.lp-primary,.lp-secondary').forEach(x => x.classList.remove('hover'));
    if (el) el.classList.add('hover');
}

function clampTop(top, fy) {
    const ph = panel.offsetHeight;
    const lo = fy - ph + 8, hi = fy - 8;
    // lo > hi means the panel is taller than the space around the focus point,
    // in which case there is no position that both covers it and stays on
    // screen — leave `top` alone rather than letting the clamp yank the panel.
    return lo <= hi ? Math.min(hi, Math.max(lo, top)) : top;
}

function panStep(target, fy) {
    const from = parseFloat(panel.style.top) || 0;
    const tr = target.getBoundingClientRect();
    return { from, dest: clampTop(from + (fy - (tr.top + tr.height / 2)), fy), target, fy };
}

function panTo(target, fy) {
    // Rapid steps (fast wheel, held arrow key) queue up one at a time so the
    // pan stays a smooth slide instead of restarting from a half-finished spot.
    if (stepRunning) { stepNext = { target, fy }; return; }
    stepRunning = true;
    const gen = panGen;
    const run = (n) => {
        const start = (now) => {
            const slide = (t) => {
                if (gen !== panGen) return;
                const k = Math.min(1, (t - now) / 80);
                panel.style.top = (n.from + (n.dest - n.from) * Math.min(1, k * (2 - k))) + 'px';
                if (k < 1) { stepRaf = requestAnimationFrame(slide); return; }
                if (mouseMoved) updateHover(mouseX, mouseY); else setHover(n.target);
                if (stepNext) {
                    const nx = stepNext;
                    stepNext = null;
                    // Re-measure now that the previous pan has settled; the
                    // queued delta was computed from a mid-slide position.
                    run(panStep(nx.target, nx.fy));
                    return;
                }
                stepRunning = false;
            };
            stepRaf = requestAnimationFrame(slide);
        };
        stepRaf = requestAnimationFrame(start);
    };
    run(panStep(target, fy));
}

// dir < 0 steps up the list (towards the primary), dir > 0 steps down.
function stepItem(dir) {
    if (!panel.dataset.key) return;
    const fy = focusY();
    if (typeof fy !== 'number') return;
    const items = [...panel.querySelectorAll('.lp-primary,.lp-secondary')];
    if (!items.length) return;

    // Step from the current selection rather than from live geometry: while a
    // pan is still sliding the panel has not moved yet, so re-measuring would
    // make a burst of presses (or a held arrow key) collapse into one step.
    // The hover wins when it disagrees — that only happens if the mouse was
    // moved onto another link while the panel was sliding.
    let i = stepIndex;
    const hov = panel.querySelector('.hover');
    const hovIdx = hov ? items.indexOf(hov) : -1;
    if (hovIdx > -1 && hov !== items[i]) i = hovIdx;
    if (i < 0) {
        const under = (el) => { const r = el.getBoundingClientRect(); return fy >= r.top && fy <= r.bottom; };
        i = items.findIndex(under);
    }

    let target;
    if (i > -1) {
        target = items[i + dir];
    } else {
        // Focus point sits outside the panel entirely: jump straight to the
        // nearest link on the side being scrolled toward.
        target = dir > 0 ? items.find(el => el.getBoundingClientRect().top > fy)
                         : [...items].reverse().find(el => el.getBoundingClientRect().bottom < fy);
    }
    if (!target) return;
    stepIndex = items.indexOf(target);
    setHover(target);   // highlight moves at once; the panel slides to catch up
    panTo(target, fy);
}

panel.addEventListener('wheel', (e) => {
    if (!panel.dataset.key) return;
    e.preventDefault();
    mouseX = e.clientX; mouseY = e.clientY; mouseMoved = true;
    const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (!raw) return;
    stepItem(raw > 0 ? 1 : -1);
}, { passive: false });

keyboardEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (ctrlOff(e)) return;
    const tile = e.target.closest('.kb-key');
    if (!tile) return;
    e.preventDefault();

    const key = tile.dataset.key;
    if (holdKey) return;
    if (!hasLinks(key)) return;

    downKey = key;
    openPanel(key, e.clientX, e.clientY, 'mouse');
});

document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;

    if (downKey) {
        const key = downKey;
        const h = ctrlOff(e) ? null : panel.querySelector('.hover');
        if (h) {
            if (h.dataset.action === 'primary') goPri(key);
            else if (h.dataset.action === 'secondary') goSec(key, parseInt(h.dataset.index));
        }
        downKey = null;
        hidePanel();
        hideKb();
        return;
    }

    if (panel.dataset.key && !shiftLong && !holdKey) {
        const t = e.target.closest('.kb-key');
        if (!t && !e.target.closest('#link-panel')) hidePanel();
    }
});

// Editing is triggered on mousedown (right button) rather than the
// `contextmenu` event. Chrome (like Firefox) has a hard-coded rule: if
// Shift is held down during a right-click, the browser always shows its
// own native context menu and ignores contextmenu.preventDefault(). Since
// our "hold Shift + right-click" gesture is exactly that combination, the
// old code (which only opened the edit modal from the `contextmenu`
// handler) would randomly lose the race against the native menu — which
// showed up as "some keys just won't open the editor." Reacting on
// `mousedown` instead sidesteps that entirely: it isn't subject to the
// same override, so the modal now opens reliably every time.
keyboardEl.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    if (ctrlOff(e)) return;
    if (!e.shiftKey && !shiftDown) return;
    const t = e.target.closest('.kb-key');
    if (!t) return;
    e.preventDefault();
    openEditModal(t.dataset.key);
});

// Kept only to suppress the browser's native context menu in the normal
// (non-Shift) case; the actual edit logic lives in the mousedown handler
// above so it isn't dependent on this call succeeding.
keyboardEl.addEventListener('contextmenu', (e) => {
    if (!shiftDown && !shiftLong && !e.shiftKey) return;
    if (!e.target.closest('.kb-key')) return;
    e.preventDefault();
});

function openEditModal(editKey) {
    clearKbState();
    hidePanel();
    hideKb();
    shiftDown = false;
    shiftLong = false;
    clearTimeout(shiftTimer);
    const s = sc(editKey);
    closeModal();
    modalOverlay.classList.add('visible');
    editModal.classList.add('visible');

    const h2 = document.createElement('h2');
    h2.textContent = 'Edit Key: ' + editKey;
    editModal.appendChild(h2);

    const ps = document.createElement('div');
    ps.className = 'edit-section';
    const hp = document.createElement('h3');
    hp.textContent = 'Primary Link';
    ps.appendChild(hp);
    const pu = document.createElement('input');
    pu.id = 'epu'; pu.placeholder = 'URL'; pu.value = s.primary ? s.primary.url : '';
    ps.appendChild(pu);
    const pt = document.createElement('input');
    pt.id = 'ept'; pt.placeholder = 'Title (optional)'; pt.value = s.primary ? (s.primary.title || '') : '';
    ps.appendChild(pt);
    editModal.appendChild(ps);

    const ss = document.createElement('div');
    ss.className = 'edit-section';
    const hs = document.createElement('h3');
    hs.textContent = 'Secondary Links';
    ss.appendChild(hs);
    const sl = document.createElement('div');
    sl.id = 'esl';
    ss.appendChild(sl);
    const ab = document.createElement('button');
    ab.id = 'add-secondary-btn'; ab.textContent = '+ Add Link';
    ab.addEventListener('click', () => addRow(sl, { title: '', url: '' }));
    ss.appendChild(ab);
    editModal.appendChild(ss);

    const err = document.createElement('div');
    err.id = 'edit-error';
    editModal.appendChild(err);

    const ac = document.createElement('div');
    ac.className = 'edit-actions';
    const sb = document.createElement('button');
    sb.textContent = 'Save';
    sb.addEventListener('click', async () => {
        const k = editKey;
        const pu2 = normUrl(document.getElementById('epu').value);
        const pt2 = document.getElementById('ept').value.trim();
        // Only url/title are persisted. The icon is intentionally NOT
        // stored: render()/openPanel() already fall back to favicon(url)
        // when icon is absent, so saving it too just duplicates data
        // (roughly doubling storage size for nothing) and, being tied to
        // this exact extension instance's ID, could go stale on reinstall.
        const pri = pu2 ? { url: pu2, title: pt2 || pu2 } : null;
        const rows = document.querySelectorAll('#esl .edit-secondary-row');
        const sec = [];
        rows.forEach(row => {
            const u = normUrl(row.querySelector('.sec-url').value);
            const t = row.querySelector('.sec-title').value.trim();
            if (u) sec.push({ url: u, title: t || u });
        });
        const prevValue = shortcuts[k];
        shortcuts[k] = { primary: pri, secondary: sec };
        try {
            await chrome.storage.local.set({ shortcuts });
        } catch (err2) {
            // Save actually failed (quota, extension context, etc.) — roll
            // back the in-memory copy and tell the user, instead of
            // silently pretending it worked while a fresh new tab would
            // still show the old data.
            shortcuts[k] = prevValue;
            const errEl = document.getElementById('edit-error');
            if (errEl) {
                errEl.textContent = 'Could not save: ' + (err2 && err2.message ? err2.message : 'storage error') + '. Try shortening the URL/title or removing a link.';
                errEl.classList.add('show');
            }
            return;
        }
        closeModal();
        render();
    });
    ac.appendChild(sb);
    const cb = document.createElement('button');
    cb.textContent = 'Cancel';
    cb.addEventListener('click', closeModal);
    ac.appendChild(cb);
    editModal.appendChild(ac);

    if (s.secondary) s.secondary.forEach(link => addRow(sl, link));
}

function addRow(list, link) {
    const row = document.createElement('div');
    row.className = 'edit-secondary-row';
    const u = document.createElement('input');
    u.className = 'sec-url'; u.placeholder = 'URL'; u.value = link.url || '';
    row.appendChild(u);
    const t = document.createElement('input');
    t.className = 'sec-title'; t.placeholder = 'Title'; t.value = link.title || '';
    row.appendChild(t);
    const r = document.createElement('button');
    r.className = 'remove-sec-btn'; r.textContent = '\u00D7';
    r.addEventListener('click', () => row.remove());
    row.appendChild(r);
    list.appendChild(row);
}

function clearKbState() {
    holdKey = null;
    clearTimeout(holdTimer);
    holdTimer = null;
    holdActive = false;
    downKey = null;
}

function closeModal() {
    editModal.classList.remove('visible');
    editModal.innerHTML = '';
    modalOverlay.classList.remove('visible');
    clearKbState();
}

document.addEventListener('dragstart', (e) => {
    if (e.target.closest('.kb-key') || e.target.closest('#link-panel')) e.preventDefault();
});

modalOverlay.addEventListener('click', closeModal);

// ---- Init ----

(async () => {
    const r = await chrome.storage.local.get('shortcuts');
    shortcuts = r.shortcuts || {};

    // One-time migration: earlier versions stored data in chrome.storage.sync,
    // which has an 8KB-per-item limit that silently failed once you had
    // more than a handful of shortcuts. If local storage is empty but sync
    // still has data (from back when it fit under the limit), bring it over.
    if (Object.keys(shortcuts).length === 0) {
        try {
            const old = await chrome.storage.sync.get('shortcuts');
            if (old.shortcuts && Object.keys(old.shortcuts).length > 0) {
                shortcuts = old.shortcuts;
                await chrome.storage.local.set({ shortcuts });
            }
        } catch { /* ignore, nothing to migrate */ }
    }
    for (const k of KEYS) { if (!shortcuts[k]) shortcuts[k] = def(); }
    time();
    setInterval(time, 1000);
    const dm = window.matchMedia('(prefers-color-scheme: dark)');
    document.body.classList.toggle('dark', dm.matches);
    dm.addEventListener('change', (e) => document.body.classList.toggle('dark', e.matches));
    settingsBtn.addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
        else window.open(chrome.runtime.getURL('options.html'));
    });
    render();
})();
