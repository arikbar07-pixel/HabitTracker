/* ============================================================
   HabitStore — localStorage data layer
   ============================================================ */
class HabitStore {
    constructor() {
        this.KEY = 'habitmatrix_v2';
        this.data = this._load();
        this.data.exceptions = this.data.exceptions || {};
        this._migrateUtcDates();
    }

    _load() {
        try {
            return JSON.parse(localStorage.getItem(this.KEY)) || this._empty();
        } catch { return this._empty(); }
    }

    _empty() {
        return { habits: [], tasks: [], user: { name: 'User' } };
    }

    _save() {
        this.data._ts = Date.now();
        localStorage.setItem(this.KEY, JSON.stringify(this.data));
        if (window.FB) window.FB.save(this.data);
    }

    // One-time migration: old code stored completion keys using UTC midnight dates,
    // which for UTC+ timezones (e.g. Israel UTC+3) were 1 day behind the local date.
    // Shift all pre-today completion keys forward by 1 day to align with local dates.
    _migrateUtcDates() {
        if (this.data._datesMigrated || new Date().getTimezoneOffset() >= 0) {
            this.data._datesMigrated = true;
            return;
        }
        const today = dateStr(new Date());
        let changed = false;
        this.data.habits.forEach(h => {
            const oldKeys = Object.keys(h.completions).filter(k => k < today);
            if (!oldKeys.length) return;
            const next = {};
            // keep today-and-future keys unchanged
            Object.keys(h.completions).forEach(k => { if (k >= today) next[k] = true; });
            // shift past keys +1 day
            oldKeys.forEach(k => {
                const d = new Date(k + 'T12:00:00');
                d.setDate(d.getDate() + 1);
                next[dateStr(d)] = true;
            });
            h.completions = next;
            changed = true;
        });
        this.data._datesMigrated = true;
        if (changed) this._save();
    }

    /* ---- Habits CRUD ---- */
    addHabit(name, icon, days) {
        days = (Array.isArray(days) && days.length) ? days : [0,1,2,3,4,5,6];
        const h = { id: uid(), name, icon, days, createdAt: dateStr(new Date()), archived: false, completions: {} };
        this.data.habits.push(h);
        this._save();
        return h;
    }

    updateHabit(id, updates) {
        const h = this.data.habits.find(h => h.id === id);
        if (h) { Object.assign(h, updates); this._save(); }
    }

    archiveHabit(id) { this.updateHabit(id, { archived: true }); }

    restoreHabit(id) { this.updateHabit(id, { archived: false, completions: {} }); }

    deleteHabit(id) {
        this.data.habits = this.data.habits.filter(h => h.id !== id);
        this._save();
    }

    toggleCompletion(habitId, date) {
        const h = this.data.habits.find(h => h.id === habitId);
        if (!h) return;
        if (h.completions[date]) { delete h.completions[date]; }
        else { h.completions[date] = true; }
        this._save();
    }

    isCompleted(habitId, date) {
        const h = this.data.habits.find(h => h.id === habitId);
        return !!(h && h.completions[date]);
    }

    activeHabits() { return this.data.habits.filter(h => !h.archived); }
    archivedHabits() { return this.data.habits.filter(h => h.archived); }

    /* ---- Streak calculations ---- */
    getStreak(habitId) {
        const h = this.data.habits.find(h => h.id === habitId);
        if (!h) return 0;
        const sched = h.days ?? [0,1,2,3,4,5,6];
        if (!sched.length) return 0;
        const d = new Date();
        // Grace: if today is scheduled, not done, and not an exception, start from yesterday
        if (sched.includes(dayOfWeek(d)) && !h.completions[dateStr(d)] && !this.isException(dateStr(d))) {
            d.setDate(d.getDate() - 1);
        }
        let streak = 0, guard = 0;
        while (guard++ < 365) {
            const ds = dateStr(d);
            if (this.isException(ds)) { d.setDate(d.getDate() - 1); continue; } // skip, don't break
            const dow = dayOfWeek(d);
            if (!sched.includes(dow)) { d.setDate(d.getDate() - 1); continue; }
            if (h.completions[ds]) { streak++; d.setDate(d.getDate() - 1); }
            else break;
        }
        return streak;
    }

    getLongestStreak(habitId) {
        const h = this.data.habits.find(h => h.id === habitId);
        if (!h) return 0;
        const sched = h.days ?? [0,1,2,3,4,5,6];
        const dates = Object.keys(h.completions).filter(ds => {
            const d = new Date(ds + 'T00:00:00');
            return sched.includes(dayOfWeek(d));
        }).sort();
        if (!dates.length) return 0;
        let max = 1, cur = 1;
        for (let i = 1; i < dates.length; i++) {
            const check = new Date(dates[i - 1] + 'T00:00:00');
            check.setDate(check.getDate() + 1);
            let missed = false;
            while (dateStr(check) < dates[i]) {
                const cds = dateStr(check);
                if (!this.isException(cds) && sched.includes(dayOfWeek(check))) { missed = true; break; }
                check.setDate(check.getDate() + 1);
            }
            if (!missed) { cur++; max = Math.max(max, cur); }
            else { cur = 1; }
        }
        return max;
    }

    getOverallStreak() {
        return Math.max(0, ...this.activeHabits().map(h => this.getStreak(h.id)));
    }

    getBestStreak() {
        return Math.max(0, ...this.data.habits.map(h => this.getLongestStreak(h.id)));
    }

    /* ---- Week helpers ---- */
    getWeekCompletions(habitId, weekStart) {
        const result = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            result.push(this.isCompleted(habitId, dateStr(d)));
        }
        return result;
    }

    getWeeklyCompletionRate(weekStart) {
        const active = this.activeHabits();
        if (!active.length) return 0;
        let total = 0, done = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            const ds = dateStr(d);
            if (ds > dateStr(new Date())) break;
            if (this.isException(ds)) continue;
            const dow = dayOfWeek(d);
            active.forEach(h => {
                if (h.createdAt > ds) return;
                const sched = h.days ?? [0,1,2,3,4,5,6];
                if (!sched.includes(dow)) return;
                total++;
                if (h.completions[ds]) done++;
            });
        }
        return total ? Math.round((done / total) * 100) : 0;
    }

    getDailyCompletionRates(days = 7) {
        const rates = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const ds = dateStr(d);
            if (this.isException(ds)) { rates.push(null); continue; }
            const dow = dayOfWeek(d);
            const active = this.activeHabits().filter(h => h.createdAt <= ds);
            if (!active.length) { rates.push(null); continue; }
            const sched = active.filter(h => (h.days ?? [0,1,2,3,4,5,6]).includes(dow));
            if (!sched.length) { rates.push(null); continue; }
            const done = sched.filter(h => h.completions[ds]).length;
            rates.push(Math.round((done / sched.length) * 100));
        }
        return rates;
    }

    getFirstHabitDate() {
        const all = this.data.habits;
        if (!all.length) return dateStr(new Date());
        return all.map(h => h.createdAt).sort()[0];
    }

    getTotalCompletionsThisWeek() {
        const ws = getWeekStart(new Date());
        let count = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(ws);
            d.setDate(d.getDate() + i);
            const ds = dateStr(d);
            if (this.isException(ds)) continue;
            this.activeHabits().forEach(h => { if (h.completions[ds]) count++; });
        }
        return count;
    }

    /* ---- Exception Days ---- */
    isException(ds) {
        return ds in (this.data.exceptions || {});
    }

    addException(ds, note) {
        this.data.exceptions[ds] = note || '';
        this._save();
    }

    removeException(ds) {
        delete this.data.exceptions[ds];
        this._save();
    }

    getExceptions() {
        return Object.entries(this.data.exceptions || {})
            .map(([date, note]) => ({ date, note }))
            .sort((a, b) => b.date.localeCompare(a.date));
    }

    /* ---- Tasks CRUD ---- */
    addTask(name, date, time, notes) {
        const t = { id: uid(), name, date: date || dateStr(new Date()), time: time || '', notes: notes || '', done: false, createdAt: new Date().toISOString() };
        if (!this.data.tasks) this.data.tasks = [];
        this.data.tasks.push(t);
        this._save();
        return t;
    }

    updateTask(id, updates) {
        const t = this.data.tasks?.find(t => t.id === id);
        if (t) { Object.assign(t, updates); this._save(); }
    }

    toggleTask(id) {
        const t = this.data.tasks?.find(t => t.id === id);
        if (t) { t.done = !t.done; this._save(); }
    }

    deleteTask(id) {
        this.data.tasks = (this.data.tasks || []).filter(t => t.id !== id);
        this._save();
    }

}

/* ============================================================
   Utility helpers
   ============================================================ */
function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function dateStr(d) {
    // Use local date (not UTC) to avoid off-by-one for UTC+ timezones
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getWeekStart(d) {
    const day = d.getDay(); // 0=Sun
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - day);
    sunday.setHours(0, 0, 0, 0);
    return sunday;
}

function dayOfWeek(d) {
    return d.getDay(); // Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
}

function formatDate(ds) {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ============================================================
   Shared UI components (injected into mount points)
   ============================================================ */
const PAGES = [
    { id: 'dashboard',   label: 'Dashboard',   icon: 'dashboard',   href: 'index.html' },
    { id: 'habits',      label: 'Habits',       icon: 'grid_view',   href: 'habits.html' },
    { id: 'tasks',       label: 'Tasks',        icon: 'checklist',   href: 'tasks.html' },
];

function injectHeader(activePage) {
    const el = document.getElementById('header-mount');
    if (!el) return;
    el.innerHTML = `
    <header class="bg-surface/80 backdrop-blur-xl sticky top-0 z-50 border-b border-outline-variant/30 shadow-[0_0_20px_rgba(74,225,118,0.08)] flex justify-between items-center px-6 md:px-16 py-4 w-full" style="background:rgba(11,19,38,0.9)">
        <div class="flex items-center gap-4">
            <span class="font-black text-2xl tracking-tighter uppercase text-primary" style="font-family:Montserrat">My Habits</span>
        </div>
        <div class="hidden md:flex items-center gap-8">
            <nav class="flex gap-6">
                ${PAGES.map(p => `<a href="${p.href}" class="font-semibold text-sm tracking-widest uppercase transition-colors ${p.id === activePage ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}">${p.label}</a>`).join('')}
            </nav>
        </div>
        <div class="flex items-center gap-3">
            <div class="relative">
                <button type="button" onclick="toggleAccountMenu()" class="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary font-bold text-sm border-2 border-primary/30 hover:brightness-110 transition-all" id="avatar-btn">U</button>
                <div id="account-menu" class="hidden absolute right-0 w-56 rounded-xl border shadow-2xl overflow-hidden" style="background:#171f33;border-color:#2d3449;top:calc(100% + 8px);z-index:9999">
                    <div class="px-4 py-3 border-b" style="border-color:#2d3449">
                        <div class="text-xs font-bold uppercase tracking-widest mb-1" style="color:#4a5568">Account</div>
                        <div class="text-sm truncate text-on-surface" id="account-email">—</div>
                    </div>
                    <button type="button" onclick="openSettings();document.getElementById('account-menu').classList.add('hidden')" class="w-full text-left px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-primary hover:bg-white/5 transition-colors flex items-center gap-2">
                        <span class="material-symbols-outlined text-base">settings</span>Settings
                    </button>
                    <button type="button" onclick="signOutUser()" class="w-full text-left px-4 py-2.5 text-sm font-semibold hover:bg-white/5 transition-colors flex items-center gap-2" style="color:#f87171">
                        <span class="material-symbols-outlined text-base">logout</span>Sign out
                    </button>
                </div>
            </div>
            <button class="md:hidden" onclick="toggleMobileMenu()">
                <span class="material-symbols-outlined text-primary">menu</span>
            </button>
        </div>
    </header>`;
}

function injectSidebar(activePage) {
    const el = document.getElementById('sidebar-mount');
    if (!el) return;
    el.innerHTML = `
    <aside id="main-sidebar" class="hidden md:flex flex-col h-screen w-64 fixed left-0 top-0 pt-20 pb-4 border-r z-40 overflow-y-auto custom-scrollbar" style="background:#0d1528;border-color:#1e293b">
        <nav class="flex flex-col gap-1 px-3 flex-1 mt-4">
            ${PAGES.map(p => `
            <a href="${p.href}" class="flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${p.id === activePage ? 'sidebar-active' : 'text-on-surface-variant hover:text-primary hover:bg-white/5'}">
                <span class="material-symbols-outlined text-xl group-hover:translate-x-0.5 transition-transform">${p.icon}</span>
                <span class="font-semibold text-sm tracking-wide">${p.label}</span>
            </a>`).join('')}
        </nav>
        <div class="px-4 pb-4 border-t mt-4 pt-4" style="border-color:#1e293b">
            <button onclick="openSettings()" class="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg text-on-surface-variant hover:text-primary hover:bg-white/5 transition-all text-sm font-semibold">
                <span class="material-symbols-outlined text-xl">settings</span>Settings
            </button>
            <button onclick="signOutUser()" class="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg hover:bg-white/5 transition-all text-sm font-semibold" style="color:#f87171">
                <span class="material-symbols-outlined text-xl">logout</span>Sign out
            </button>
        </div>
    </aside>`;
}

function injectMobileNav(activePage) {
    const el = document.getElementById('mobile-nav-mount');
    if (!el) return;
    el.innerHTML = `
    <nav class="md:hidden fixed bottom-0 left-0 right-0 backdrop-blur-xl border-t z-50 flex justify-around items-center py-3" style="background:rgba(23,31,51,0.95);border-color:#1e293b">
        ${PAGES.map(p => `
        <a href="${p.href}" class="flex flex-col items-center gap-1 ${p.id === activePage ? 'text-primary' : 'text-on-surface-variant'}">
            <span class="material-symbols-outlined" ${p.id === activePage ? "style=\"font-variation-settings:'FILL' 1\"" : ''}>${p.icon}</span>
            <span class="text-[10px] font-bold uppercase tracking-tight">${p.label}</span>
        </a>`).join('')}
    </nav>`;
}

/* ============================================================
   Toast helper — disabled by user request
   ============================================================ */
function showToast(msg, icon) { /* no-op */ }

/* ============================================================
   Modal helpers
   ============================================================ */
function openModal(id) {
    document.getElementById(id)?.classList.add('open');
}
function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
}

/* ============================================================
   Mobile menu toggle
   ============================================================ */
function toggleMobileMenu() {
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('sidebar-mobile-open');
    if (isOpen) {
        sidebar.classList.remove('sidebar-mobile-open');
        document.getElementById('mobile-overlay')?.remove();
    } else {
        sidebar.classList.add('sidebar-mobile-open');
        const overlay = document.createElement('div');
        overlay.id = 'mobile-overlay';
        overlay.className = 'mobile-overlay';
        overlay.onclick = toggleMobileMenu;
        document.body.appendChild(overlay);
    }
}

/* ============================================================
   App mode (mobile / desktop)
   ============================================================ */
function getAppMode() {
    return localStorage.getItem('appMode');
}

function chooseModeAndStart(mode) {
    localStorage.setItem('appMode', mode);
    document.getElementById('mode-welcome')?.remove();
    if (mode === 'mobile') document.body.classList.add('mobile-mode');
}

function switchMode(mode) {
    localStorage.setItem('appMode', mode);
    closeModal('settings-modal');
    showToast('Mode changed', 'check_circle');
    setTimeout(() => location.reload(), 800);
}

function showModeSelectScreen() {
    const el = document.createElement('div');
    el.id = 'mode-welcome';
    el.style.cssText = 'position:fixed;inset:0;background:#0b1326;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.5rem;padding:2rem;font-family:Inter,sans-serif';
    el.innerHTML = `
        <div style="text-align:center">
            <div style="font-family:Montserrat,sans-serif;font-size:2rem;font-weight:900;color:#4be277;letter-spacing:-0.02em">MY HABITS</div>
            <div style="color:#bccbb9;margin-top:0.75rem;font-size:0.9rem">How will you use this app?</div>
        </div>
        <div style="display:flex;gap:1.25rem;flex-wrap:wrap;justify-content:center">
            <button onclick="chooseModeAndStart('desktop')" style="background:#171f33;border:1.5px solid rgba(75,226,119,0.25);border-radius:1rem;padding:1.75rem 2.25rem;display:flex;flex-direction:column;align-items:center;gap:0.85rem;cursor:pointer;color:#dae2fd;min-width:140px;transition:border-color 0.2s" onmouseover="this.style.borderColor='#4be277'" onmouseout="this.style.borderColor='rgba(75,226,119,0.25)'">
                <span class="material-symbols-outlined" style="font-size:2.5rem;color:#4be277;font-variation-settings:'FILL' 0,'wght' 300">laptop_mac</span>
                <span style="font-weight:700;font-size:0.95rem">Computer</span>
            </button>
            <button onclick="chooseModeAndStart('mobile')" style="background:#171f33;border:1.5px solid rgba(75,226,119,0.25);border-radius:1rem;padding:1.75rem 2.25rem;display:flex;flex-direction:column;align-items:center;gap:0.85rem;cursor:pointer;color:#dae2fd;min-width:140px;transition:border-color 0.2s" onmouseover="this.style.borderColor='#4be277'" onmouseout="this.style.borderColor='rgba(75,226,119,0.25)'">
                <span class="material-symbols-outlined" style="font-size:2.5rem;color:#4be277;font-variation-settings:'FILL' 0,'wght' 300">smartphone</span>
                <span style="font-weight:700;font-size:0.95rem">Phone</span>
            </button>
        </div>
        <div style="color:#4a5568;font-size:0.72rem">You can change this in Settings</div>
    `;
    document.body.appendChild(el);
}

/* ============================================================
   Settings modal
   ============================================================ */
function openSettings() {
    const store = window._store;
    const nameEl = document.getElementById('settings-name');
    if (nameEl) nameEl.value = store?.data?.user?.name || '';
    const mode = getAppMode() || 'desktop';
    ['desktop','mobile'].forEach(m => {
        const btn = document.getElementById('mode-btn-' + m);
        if (btn) {
            btn.style.borderColor = mode === m ? '#4be277' : '#2d3449';
            btn.style.color = mode === m ? '#4be277' : '#bccbb9';
        }
    });
    const section = document.getElementById('settings-account-section');
    const emailEl = document.getElementById('settings-email');
    if (section && window.FB) {
        const user = window.FB.getUser();
        if (user) {
            section.classList.remove('hidden');
            if (emailEl) emailEl.textContent = user.email || user.displayName || 'Signed in';
        }
    }
    openModal('settings-modal');
}

function saveSettings() {
    const store = window._store;
    const name = document.getElementById('settings-name').value.trim();
    if (name && store) {
        store.data.user.name = name;
        store._save();
        const btn = document.getElementById('avatar-btn');
        if (btn) btn.textContent = name.charAt(0).toUpperCase();
    }
    closeModal('settings-modal');
    showToast('Settings saved', 'check_circle');
}

function clearAllData() {
    if (confirm('This will permanently delete ALL your habits, goals and data. This cannot be undone.\n\nAre you sure?')) {
        localStorage.removeItem('habitmatrix_v2');
        localStorage.removeItem('fb_remember');
        localStorage.removeItem('fb_authed');
        if (window.FB) window.FB.signOut();
        window.location.reload();
    }
}

function injectSharedModals() {
    const el = document.createElement('div');
    el.innerHTML = `
    <div class="modal-overlay" id="settings-modal" onclick="if(event.target===this)closeModal('settings-modal')">
        <div class="modal-box" style="max-width:420px">
            <div class="flex justify-between items-center mb-6">
                <h3 class="font-bold text-lg text-on-surface" style="font-family:Montserrat">Settings</h3>
                <button onclick="closeModal('settings-modal')" class="text-on-surface-variant hover:text-primary transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="mb-5">
                <label class="text-xs font-bold uppercase tracking-widest mb-2 block" style="color:#7a8a9a">Display Name</label>
                <input class="habit-input" type="text" id="settings-name" placeholder="Your name" style="color:#dae2fd"/>
            </div>
            <div class="mb-5 pt-4" style="border-top:1px solid #2d3449">
                <label class="text-xs font-bold uppercase tracking-widest mb-3 block" style="color:#7a8a9a">Display Mode</label>
                <div style="display:flex;gap:0.75rem">
                    <button id="mode-btn-desktop" onclick="switchMode('desktop')" style="flex:1;padding:0.6rem;border-radius:0.5rem;border:1px solid #2d3449;font-size:0.82rem;font-weight:700;cursor:pointer;background:transparent;color:#bccbb9;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:0.4rem"><span class="material-symbols-outlined" style="font-size:1rem">laptop_mac</span>Computer</button>
                    <button id="mode-btn-mobile" onclick="switchMode('mobile')" style="flex:1;padding:0.6rem;border-radius:0.5rem;border:1px solid #2d3449;font-size:0.82rem;font-weight:700;cursor:pointer;background:transparent;color:#bccbb9;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:0.4rem"><span class="material-symbols-outlined" style="font-size:1rem">smartphone</span>Phone</button>
                </div>
            </div>
            <button onclick="saveSettings()" class="w-full py-2.5 rounded-lg bg-primary text-on-primary text-sm font-bold hover:brightness-110 transition-all">Save</button>
            <div id="settings-account-section" class="mt-5 pt-4 hidden" style="border-top:1px solid #2d3449">
                <div class="text-xs font-bold uppercase tracking-widest mb-2" style="color:#4a5568">Account</div>
                <div class="text-sm text-on-surface mb-3 truncate" id="settings-email">—</div>
                <button onclick="closeModal('settings-modal');signOutUser()" class="w-full py-2.5 rounded-lg border text-sm font-bold transition-all flex items-center justify-center gap-2" style="border-color:#f87171;color:#f87171;background:transparent">
                    <span class="material-symbols-outlined text-base">logout</span>Sign out
                </button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(el.firstElementChild);
}

/* ============================================================
   Day-picker helpers (shared across pages)
   ============================================================ */
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function buildDayPicker(pickerId, inputId, selectedDays) {
    const el = document.getElementById(pickerId);
    if (!el) return;
    const sel = (Array.isArray(selectedDays) && selectedDays.length) ? selectedDays : [0,1,2,3,4,5,6];
    el.innerHTML = DAY_ABBR.map((lbl, i) =>
        `<button type="button" class="day-btn${sel.includes(i) ? ' selected' : ''}" data-day="${i}" onclick="toggleDay('${pickerId}','${inputId}',${i})">${lbl}</button>`
    ).join('');
    document.getElementById(inputId).value = sel.join(',');
}

function toggleDay(pickerId, inputId, day) {
    const picker = document.getElementById(pickerId);
    const btn = picker.querySelector(`[data-day="${day}"]`);
    btn.classList.toggle('selected');
    const sel = [...picker.querySelectorAll('.day-btn.selected')].map(b => +b.dataset.day);
    if (!sel.length) { btn.classList.add('selected'); return; }
    document.getElementById(inputId).value = sel.join(',');
}

function getDayPickerValue(inputId) {
    const val = document.getElementById(inputId)?.value || '';
    return val ? val.split(',').map(Number) : [0,1,2,3,4,5,6];
}

/* ============================================================
   Service Worker registration
   ============================================================ */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            if (localStorage.getItem('fb_redirect_pending')) return; // auth in progress
            refreshing = true;
            window.location.reload();
        });
        navigator.serviceWorker.register('./sw.js').then(reg => reg.update());
    });
}

/* ============================================================
   Init — called by each page
   ============================================================ */
function _bootApp(activePage) {
    const mode = getAppMode();
    if (mode === 'mobile') document.body.classList.add('mobile-mode');
    injectHeader(activePage);
    injectSidebar(activePage);
    injectMobileNav(activePage);
    injectSharedModals();
    if (!mode) showModeSelectScreen();
    const name = window._store?.data?.user?.name || '';
    const btn = document.getElementById('avatar-btn');
    if (btn && name) btn.textContent = name.charAt(0).toUpperCase();
}

function _rerender() {
    if (typeof renderMatrix    === 'function') renderMatrix();
    if (typeof renderTasks     === 'function') renderTasks();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderGoals     === 'function') renderGoals();
}

function toggleAccountMenu() {
    const menu = document.getElementById('account-menu');
    if (!menu) return;
    const opening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    if (opening && window.FB) {
        const user = window.FB.getUser();
        const el = document.getElementById('account-email');
        if (el) el.textContent = user ? (user.email || user.displayName || 'Signed in') : 'Not signed in';
    }
}

function signOutUser() {
    localStorage.removeItem('fb_remember');
    localStorage.removeItem('fb_authed');
    document.getElementById('account-menu')?.classList.add('hidden');
    document.getElementById('fb-auth-overlay')?.remove();
    _showSignInOverlay();
    if (window.FB) window.FB.signOut();
}

document.addEventListener('click', e => {
    const menu = document.getElementById('account-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    const btn = document.getElementById('avatar-btn');
    if (!menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

function _showSignInOverlay() {
    if (document.getElementById('fb-auth-overlay')) return;
    const el = document.createElement('div');
    el.id = 'fb-auth-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0b1326;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:2rem';
    el.innerHTML = `
        <div style="font-family:Montserrat,sans-serif;font-size:2.2rem;font-weight:900;color:#4be277;letter-spacing:-0.04em">MY HABITS</div>
        <p style="color:#64748b;font-size:0.875rem;text-align:center;max-width:260px;line-height:1.5">Sign in to sync your data across all your devices</p>
        <button type="button" onclick="_doSignIn()" style="display:flex;align-items:center;gap:12px;padding:14px 28px;border-radius:12px;border:1px solid #2d3449;background:#171f33;color:#dae2fd;font-size:15px;font-weight:600;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor='#4be277'" onmouseout="this.style.borderColor='#2d3449'">
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.8 2.5 30.3 0 24 0 14.8 0 7 5.4 3.2 13.2l7.8 6C12.8 13 18 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6C43.5 37 46.5 31.2 46.5 24.5z"/><path fill="#FBBC05" d="M11 28.8c-.6-1.7-.9-3.5-.9-5.3l-7.8-6C1.2 15.3 0 19.5 0 24s1.2 8.7 3.2 12.3l7.8-5.5z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5 2.4-8.7 2.4-6 0-11.1-4-12.9-9.5l-7.8 5.5C7 43.2 14.9 48 24 48z"/></svg>
            Sign in with Google
        </button>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#94a3b8;font-size:0.8rem;user-select:none">
            <input type="checkbox" id="fb-remember-check" checked style="width:15px;height:15px;cursor:pointer;accent-color:#4be277"/>
            Remember me on this device
        </label>`;
    document.body.appendChild(el);
}

function _doSignIn() {
    const cb = document.getElementById('fb-remember-check');
    if (cb?.checked) localStorage.setItem('fb_remember', '1');
    else localStorage.removeItem('fb_remember');
    localStorage.setItem('fb_redirect_pending', '1');
    window.FB?.signIn();
}

function initApp(activePage) {
    window._store = new HabitStore();
    _bootApp(activePage);

    if (!window.FB) return;

    let _splashDone = !!sessionStorage.getItem('splashShown');
    let _authState  = null; // null=pending, true=in, false=out

    function _tryShowSignIn() {
        if (_splashDone && _authState === false && !localStorage.getItem('fb_remember')) {
            _showSignInOverlay();
        }
    }

    if (!_splashDone) {
        window.addEventListener('splashDone', () => { _splashDone = true; _tryShowSignIn(); }, { once: true });
    }

    window.FB.onAuth(
        async (user) => {
            _authState = true;
            localStorage.removeItem('fb_redirect_pending');
            localStorage.setItem('fb_authed', '1');
            document.getElementById('fb-auth-overlay')?.remove();

            const fbData = await window.FB.load();
            if (fbData) {
                if ((fbData._ts || 0) > (window._store.data._ts || 0)) {
                    window._store.data = fbData;
                    window._store.data.exceptions = window._store.data.exceptions || {};
                    localStorage.setItem(window._store.KEY, JSON.stringify(window._store.data));
                    _rerender();
                }
            } else if (window._store.data.habits.length) {
                window.FB.save(window._store.data);
            }

            window.FB.listen(data => {
                if ((data._ts || 0) <= (window._store.data._ts || 0)) return;
                window._store.data = data;
                window._store.data.exceptions = window._store.data.exceptions || {};
                localStorage.setItem(window._store.KEY, JSON.stringify(data));
                _rerender();
            });
        },
        () => {
            _authState = false;
            localStorage.removeItem('fb_authed');
            // If fb_remember is set, we might be mid-redirect — give Firebase 3s to finish
            if (localStorage.getItem('fb_remember')) {
                setTimeout(() => {
                    if (_authState === false) {
                        localStorage.removeItem('fb_remember');
                        _tryShowSignIn();
                    }
                }, 3000);
            } else {
                _tryShowSignIn();
            }
        }
    );
}
