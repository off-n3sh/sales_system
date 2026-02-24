// ============================================================================
// ADMIN.JS — Dreamland Admin Dashboard
// App user management + MongoDB Database Monitor
// ============================================================================

const API    = '/api/admin';
const DB_API = '/api/db';

// ============================================================================
// SECTION NAVIGATION
// ============================================================================

const sections = {
    'overview':       document.getElementById('section-overview'),
    'users':          document.getElementById('section-users'),
    'user-detail':    document.getElementById('section-user-detail'),
    'reset-password': document.getElementById('section-reset-password'),
    'security':       document.getElementById('section-security'),
    'database':       document.getElementById('section-database'),
};

function showSection(name) {
    Object.values(sections).forEach(s => s && s.setAttribute('hidden', ''));
    if (sections[name]) sections[name].removeAttribute('hidden');
}

document.querySelectorAll('#admin-nav [data-section]').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        const target = link.dataset.section;
        showSection(target);
        if (target === 'overview') loadStats();
        if (target === 'users')    loadUsers();
        if (target === 'security') loadSecurity();
        if (target === 'database') initDatabaseSection();
    });
});

document.getElementById('nav-logout').addEventListener('click', e => {
    e.preventDefault();
    window.location.href = '/logout';
});

// ============================================================================
// TOAST
// ============================================================================

const toast        = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
let toastTimer     = null;

function showToast(message, isError = false) {
    toastMessage.textContent = message;
    toast.dataset.type = isError ? 'error' : 'success';
    toast.removeAttribute('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.setAttribute('hidden', ''), 3500);
}

// ============================================================================
// HELPERS
// ============================================================================

async function apiFetch(url, options = {}) {
    try {
        const res  = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        const data = await res.json();
        return { ok: res.ok, data };
    } catch {
        return { ok: false, data: { error: 'Network error' } };
    }
}

function setLoading(loadingEl, emptyEl, show) {
    if (show) {
        loadingEl.removeAttribute('hidden');
        emptyEl.setAttribute('hidden', '');
    } else {
        loadingEl.setAttribute('hidden', '');
    }
}

function formatTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ============================================================================
// SECTION 1: OVERVIEW — STATS
// ============================================================================

async function loadStats() {
    const { ok, data } = await apiFetch(`${API}/stats`);
    if (!ok) return showToast(data.error || 'Failed to load stats', true);
    const s = data.data;
    document.getElementById('stat-total-users').textContent     = s.total_users;
    document.getElementById('stat-active-sessions').textContent = s.active_sessions;
    document.getElementById('stat-pending-users').textContent   = s.pending_users;
    document.getElementById('stat-blocked-users').textContent   = s.blocked_users;
    document.getElementById('stat-failed-attempts').textContent = s.failed_attempts_24h;
}

// ============================================================================
// SECTION 2: USERS LIST
// ============================================================================

let currentStatusFilter = 'all';

function buildUsersUrl(q) {
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (currentStatusFilter && currentStatusFilter !== 'all') params.append('status', currentStatusFilter);
    return `${API}/users?${params.toString()}`;
}

function buildUserRow(user) {
    const displayStatus = user.display_status || user.status;
    return `
        <td>${user.first_name} ${user.last_name}</td>
        <td>${user.email}</td>
        <td>${user.phone}</td>
        <td>${user.role}</td>
        <td><span class="badge badge-${displayStatus}">${displayStatus}</span></td>
        <td>${user.created_at}</td>
        <td>
            <button class="btn-view-user" data-id="${user.id}">View</button>
            ${user.status === 'pending'
                ? `<button class="btn-approve-user" data-id="${user.id}">Approve</button>`
                : ''}
            ${user.status === 'blocked'
                ? `<button class="btn-unblock-user" data-id="${user.id}">Unblock</button>`
                : user.status === 'active'
                    ? `<button class="btn-block-user" data-id="${user.id}">Block</button>`
                    : ''}
            <button class="btn-reset-pw" data-id="${user.id}"
                data-name="${user.first_name} ${user.last_name}">Reset PW</button>
        </td>
    `;
}

async function loadUsers(q = '') {
    const loadingEl = document.getElementById('users-loading');
    const emptyEl   = document.getElementById('users-empty');
    const tbody     = document.getElementById('users-table-body');

    setLoading(loadingEl, emptyEl, true);
    tbody.innerHTML = '';

    const { ok, data } = await apiFetch(buildUsersUrl(q));
    loadingEl.setAttribute('hidden', '');

    if (!ok) return showToast(data.error || 'Failed to load users', true);
    if (!data.data.length) { emptyEl.removeAttribute('hidden'); return; }

    data.data.forEach(user => {
        const tr = document.createElement('tr');
        tr.dataset.userId = user.id;
        tr.innerHTML = buildUserRow(user);
        tbody.appendChild(tr);
    });

    attachUserTableListeners();
}

function attachUserTableListeners() {
    document.querySelectorAll('.btn-view-user').forEach(btn =>
        btn.addEventListener('click', () => loadUserDetail(btn.dataset.id)));
    document.querySelectorAll('.btn-approve-user').forEach(btn =>
        btn.addEventListener('click', () => approveUser(btn.dataset.id)));
    document.querySelectorAll('.btn-block-user').forEach(btn =>
        btn.addEventListener('click', () => blockUser(btn.dataset.id, true)));
    document.querySelectorAll('.btn-unblock-user').forEach(btn =>
        btn.addEventListener('click', () => blockUser(btn.dataset.id, false)));
    document.querySelectorAll('.btn-reset-pw').forEach(btn =>
        btn.addEventListener('click', () => openResetPassword(btn.dataset.id, btn.dataset.name)));
}

// Status filter tabs
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentStatusFilter = btn.dataset.status;
        loadUsers(document.getElementById('users-search-input').value.trim());
    });
});

document.getElementById('users-search-btn').addEventListener('click', () =>
    loadUsers(document.getElementById('users-search-input').value.trim()));

document.getElementById('users-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadUsers(e.target.value.trim());
});

// ============================================================================
// SECTION 3: USER DETAIL
// ============================================================================

let currentUserId     = null;
let currentUserData   = null;
let currentUserLogs   = [];
let currentLogsPage   = 1;
let currentDateFilter = '';

async function loadUserDetail(userId, dateFilter = '', page = 1) {
    showSection('user-detail');
    currentUserId     = userId;
    currentLogsPage   = page;
    currentDateFilter = dateFilter;

    const loadingEl = document.getElementById('detail-logs-loading');
    const emptyEl   = document.getElementById('detail-logs-empty');
    const tbody     = document.getElementById('detail-logs-body');

    setLoading(loadingEl, emptyEl, true);
    tbody.innerHTML = '';

    const url = `${API}/users/${userId}?page=${page}${dateFilter ? `&date=${dateFilter}` : ''}`;

    const { ok, data } = await apiFetch(url);
    loadingEl.setAttribute('hidden', '');

    if (!ok) return showToast(data.error || 'Failed to load user', true);

    const user      = data.data.user;
    currentUserData = user;
    currentUserLogs = data.data.session_logs;

    document.getElementById('detail-user-name').textContent  = `${user.first_name} ${user.last_name}`;
    document.getElementById('detail-email').textContent      = user.email;
    document.getElementById('detail-phone').textContent      = user.phone;
    document.getElementById('detail-role').textContent       = user.role;
    document.getElementById('detail-status').textContent     = user.display_status || user.status;
    document.getElementById('detail-joined').textContent     = user.created_at;
    document.getElementById('detail-last-login').textContent = user.last_login;

    document.getElementById('role-select').value = user.role;

    const blockBtn           = document.getElementById('btn-detail-block');
    blockBtn.textContent     = user.status === 'blocked' ? 'Unblock User' : 'Block User';
    blockBtn.dataset.blocked = user.status === 'blocked' ? 'true' : 'false';

    const approveBtn         = document.getElementById('btn-detail-approve');
    approveBtn.style.display = user.status === 'pending' ? 'inline-block' : 'none';

    const logs = currentUserLogs;
    if (!logs.length) { emptyEl.removeAttribute('hidden'); return; }

    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-action="${log.action}">${log.action}</td>
            <td>${log.reason}</td>
            <td>${log.timestamp}</td>
            <td>${log.ip_address}</td>
            <td>${log.user_agent}</td>
        `;
        tbody.appendChild(tr);
    });

    // Pagination controls
    const p = data.data.pagination;
    document.getElementById('logs-page-info').textContent = `Page ${p.current_page} of ${p.total_pages} (${p.total_logs} total)`;
    document.getElementById('btn-logs-prev').disabled = !p.has_prev;
    document.getElementById('btn-logs-next').disabled = !p.has_next;
}

// Date picker
document.getElementById('detail-logs-date-picker').addEventListener('change', function() {
    if (currentUserId) loadUserDetail(currentUserId, this.value, 1);
});

document.getElementById('btn-clear-logs-date').addEventListener('click', function() {
    document.getElementById('detail-logs-date-picker').value = '';
    if (currentUserId) loadUserDetail(currentUserId, '', 1);
});

// Pagination buttons
document.getElementById('btn-logs-prev').addEventListener('click', () => {
    loadUserDetail(currentUserId, currentDateFilter, currentLogsPage - 1);
});

document.getElementById('btn-logs-next').addEventListener('click', () => {
    loadUserDetail(currentUserId, currentDateFilter, currentLogsPage + 1);
});

// Download logs as CSV
document.getElementById('btn-download-logs').addEventListener('click', function() {
    if (!currentUserLogs.length) return showToast('No logs to download', true);

    const userName = `${currentUserData.first_name}_${currentUserData.last_name}`;
    const date     = document.getElementById('detail-logs-date-picker').value || 'all';

    const headers  = ['Action', 'Reason', 'Time (EAT)', 'IP Address', 'Device/Browser'];
    const rows     = currentUserLogs.map(log => [
        log.action,
        log.reason,
        log.timestamp,
        log.ip_address,
        log.user_agent
    ]);

    const csv = [headers, ...rows]
        .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${userName}_logs_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('btn-back-to-users').addEventListener('click', () => showSection('users'));

document.getElementById('btn-detail-approve').addEventListener('click', () => {
    if (currentUserId) approveUser(currentUserId, true);
});

document.getElementById('btn-detail-block').addEventListener('click', async () => {
    if (!currentUserId) return;
    const isBlocked = document.getElementById('btn-detail-block').dataset.blocked === 'true';
    await blockUser(currentUserId, !isBlocked, true);
});

document.getElementById('btn-detail-force-logout').addEventListener('click', async () => {
    if (!currentUserId) return;
    const { ok, data } = await apiFetch(`${API}/users/${currentUserId}/force-logout`, { method: 'POST' });
    if (ok) showToast(data.message);
    else    showToast(data.error || 'Failed to force logout', true);
});

document.getElementById('btn-detail-reset-pw').addEventListener('click', () => {
    if (!currentUserData) return;
    openResetPassword(currentUserId, `${currentUserData.first_name} ${currentUserData.last_name}`);
});

document.getElementById('btn-detail-change-role').addEventListener('click', async () => {
    if (!currentUserId) return;
    const role = document.getElementById('role-select').value;
    const { ok, data } = await apiFetch(`${API}/users/${currentUserId}/role`, {
        method: 'POST',
        body:   JSON.stringify({ role })
    });
    if (!ok) return showToast(data.error || 'Failed to change role', true);
    showToast(data.message);
    loadUserDetail(currentUserId);
});
// ============================================================================
// APPROVE / BLOCK
// ============================================================================

async function approveUser(userId, fromDetail = false) {
    const { ok, data } = await apiFetch(`${API}/users/${userId}/approve`, { method: 'POST' });
    if (!ok) return showToast(data.error || 'Failed to approve user', true);
    showToast(data.message);
    if (fromDetail) loadUserDetail(userId);
    else            loadUsers(document.getElementById('users-search-input').value.trim());
}

async function blockUser(userId, shouldBlock, fromDetail = false) {
    const action   = shouldBlock ? 'block' : 'unblock';
    const { ok, data } = await apiFetch(`${API}/users/${userId}/${action}`, { method: 'POST' });
    if (!ok) return showToast(data.error || `Failed to ${action} user`, true);
    showToast(data.message);
    if (fromDetail) loadUserDetail(userId);
    else            loadUsers(document.getElementById('users-search-input').value.trim());
}

// ============================================================================
// SECTION 4: RESET PASSWORD
// ============================================================================

let resetFromDetail = false;

function openResetPassword(userId, userName) {
    resetFromDetail = !sections['user-detail'].hasAttribute('hidden');
    document.getElementById('reset-user-id').value          = userId;
    document.getElementById('reset-user-label').textContent = userName;
    document.getElementById('reset-new-password').value     = '';
    document.getElementById('reset-confirm-password').value = '';
    showSection('reset-password');
}

document.getElementById('btn-back-from-reset').addEventListener('click', () =>
    showSection(resetFromDetail ? 'user-detail' : 'users'));

document.getElementById('reset-password-form').addEventListener('submit', async e => {
    e.preventDefault();
    const userId           = document.getElementById('reset-user-id').value;
    const new_password     = document.getElementById('reset-new-password').value;
    const confirm_password = document.getElementById('reset-confirm-password').value;

    const { ok, data } = await apiFetch(`${API}/users/${userId}/reset-password`, {
        method: 'POST',
        body:   JSON.stringify({ new_password, confirm_password })
    });

    if (!ok) return showToast(data.error || 'Reset failed', true);
    showToast(data.message);
    showSection(resetFromDetail ? 'user-detail' : 'users');
});

// ============================================================================
// SECTION 5: SECURITY LOGS
// ============================================================================

let activeQuick = '';

document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const selected = btn.dataset.quick;
        if (activeQuick === selected) {
            activeQuick = '';
            btn.classList.remove('active');
        } else {
            document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeQuick = selected;
        }
        loadSecurity();
    });
});

async function loadSecurity() {
    const loadingEl = document.getElementById('security-loading');
    const emptyEl   = document.getElementById('security-empty');
    const countEl   = document.getElementById('security-count');
    const tbody     = document.getElementById('security-table-body');

    setLoading(loadingEl, emptyEl, true);
    tbody.innerHTML     = '';
    countEl.textContent = '';

    const params = new URLSearchParams();
    if (activeQuick) {
        params.append('quick', activeQuick);
    } else {
        const dateFrom = document.getElementById('security-date-from').value;
        const dateTo   = document.getElementById('security-date-to').value;
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo)   params.append('date_to',   dateTo);
    }

    const ip     = document.getElementById('security-ip').value.trim();
    const reason = document.getElementById('security-reason').value;
    if (ip)     params.append('ip',     ip);
    if (reason) params.append('reason', reason);

    const { ok, data } = await apiFetch(`${API}/security?${params.toString()}`);
    loadingEl.setAttribute('hidden', '');

    if (!ok) return showToast(data.error || 'Failed to load security logs', true);
    if (!data.data.length) { emptyEl.removeAttribute('hidden'); return; }

    countEl.textContent = `${data.count} record${data.count !== 1 ? 's' : ''} found`;

    data.data.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${log.email}</td>
            <td data-action="${log.action}">${log.reason}</td>
            <td>${log.timestamp}</td>
            <td>${log.ip_address}</td>
            <td>${log.user_agent}</td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('security-filter-btn').addEventListener('click', () => {
    activeQuick = '';
    document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
    loadSecurity();
});

document.getElementById('security-clear-btn').addEventListener('click', () => {
    activeQuick = '';
    document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('security-date-from').value = '';
    document.getElementById('security-date-to').value   = '';
    document.getElementById('security-ip').value        = '';
    document.getElementById('security-reason').value    = '';
    loadSecurity();
});

// ============================================================================
// SECTION 7: LOGS
// ============================================================================

class LogsSection {
    constructor() {
        this.activeTab  = 'auth';
        this.pages      = { auth: 1, lifecycle: 1, app: 1 };
    }

    el(id) { return document.getElementById(id); }

    init() {
        this.bindTabs();
        this.bindFilters();
        // Load first tab on init
        this.fetchAuth();
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    bindTabs() {
        document.querySelectorAll('.logs-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.logs-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.logs-pane').forEach(p => p.hidden = true);
                const tab = btn.dataset.tab;
                this.el(`logs-pane-${tab}`).hidden = false;
                this.activeTab = tab;

                // Lazy-load: only fetch if the pane has no rows yet
                const bodies = { auth: 'laf-body', lifecycle: 'llf-body', app: 'lapp-body' };
                if (!this.el(bodies[tab]).hasChildNodes()) {
                    if (tab === 'auth')      this.fetchAuth();
                    if (tab === 'lifecycle') this.fetchLifecycle();
                    if (tab === 'app')       this.fetchApp();
                }
            });
        });
    }

    // ── Filter bindings ───────────────────────────────────────────────────────
    bindFilters() {
        // Auth
        this.el('laf-run').addEventListener('click', () => {
            this.pages.auth = 1;
            this.fetchAuth();
        });
        this.el('laf-clear').addEventListener('click', () => {
            ['laf-from','laf-to','laf-search'].forEach(id => this.el(id).value = '');
            this.el('laf-type').value = 'all';
            this.pages.auth = 1;
            this.fetchAuth();
        });

        // Lifecycle
        this.el('llf-run').addEventListener('click', () => {
            this.pages.lifecycle = 1;
            this.fetchLifecycle();
        });
        this.el('llf-clear').addEventListener('click', () => {
            ['llf-from','llf-to'].forEach(id => this.el(id).value = '');
            this.pages.lifecycle = 1;
            this.fetchLifecycle();
        });

        // App
        this.el('lapp-run').addEventListener('click', () => {
            this.pages.app = 1;
            this.fetchApp();
        });
        this.el('lapp-clear').addEventListener('click', () => {
            ['lapp-from','lapp-to','lapp-search'].forEach(id => this.el(id).value = '');
            this.el('lapp-action').value = 'all';
            this.pages.app = 1;
            this.fetchApp();
        });
    }

    // ── DB AUTH EVENTS ────────────────────────────────────────────────────────
    async fetchAuth() {
        const params = new URLSearchParams({
            from:  this.el('laf-from').value,
            to:    this.el('laf-to').value,
            type:  this.el('laf-type').value,
            q:     this.el('laf-search').value,
            page:  this.pages.auth
        });

        this.setLoading('laf', true);

        const { ok, data } = await apiFetch(`/api/db/auth-logs?${params}`);

        this.setLoading('laf', false);

        if (!ok) return showToast(data.error || 'Failed to load auth logs', true);

        this.el('laf-count').textContent = data.total ?? 0;
        this.renderPagination('laf', data.page, data.pages, () => this.fetchAuth());

        const tbody = this.el('laf-body');
        tbody.innerHTML = '';

        if (!data.data?.length) {
            this.el('laf-empty').hidden = false;
            return;
        }

        this.el('laf-empty').hidden = true;

        data.data.forEach(e => {
            const badgeClass = e.type === 'app'     ? 'auth-badge app'
                             : e.type === 'failed'  ? 'auth-badge failed'
                             : 'auth-badge ok';
            const badgeLabel = e.type === 'app'    ? 'APP'
                             : e.type === 'failed' ? 'FAILED'
                             : 'OK';

            const client    = this.clientFromAppName(e.app_name);
            const userLabel = e.type === 'app' ? (e.app_user || e.username) : e.username;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="${badgeClass}">${badgeLabel}</span></td>
                <td>${e.username || '—'}</td>
                <td style="color:${e.app_user ? 'var(--accent)' : 'var(--text-dim)'}">${userLabel || '—'}</td>
                <td>${e.ip || '—'}</td>
                <td><span class="auth-client ${client.cls}">${client.label}</span></td>
                <td>${e.timestamp || '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ── DB LIFECYCLE ──────────────────────────────────────────────────────────
    async fetchLifecycle() {
        const params = new URLSearchParams({
            from: this.el('llf-from').value,
            to:   this.el('llf-to').value,
            page: this.pages.lifecycle
        });

        this.setLoading('llf', true);

        const { ok, data } = await apiFetch(`/api/db/lifecycle-logs?${params}`);

        this.setLoading('llf', false);

        if (!ok) return showToast(data.error || 'Failed to load lifecycle logs', true);

        this.el('llf-count').textContent = data.total ?? 0;
        this.renderPagination('llf', data.page, data.pages, () => this.fetchLifecycle());

        const tbody = this.el('llf-body');
        tbody.innerHTML = '';

        if (!data.data?.length) {
            this.el('llf-empty').hidden = false;
            return;
        }

        this.el('llf-empty').hidden = true;

        const lcColors = {
            started:  'var(--success)',
            shutdown: 'var(--text-dim)',
            restart:  'var(--accent)',
            killed:   'var(--danger)',
        };

        data.data.forEach(e => {
            const color = lcColors[e.type] || 'var(--text-dim)';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="color:${color};font-weight:500;">${(e.type || '—').toUpperCase()}</td>
                <td>${e.pid  || '—'}</td>
                <td>${e.port || '—'}</td>
                <td>${e.host || '—'}</td>
                <td>${e.uid  || '—'}</td>
                <td>${e.timestamp || '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ── APP LOGS ──────────────────────────────────────────────────────────────
    async fetchApp() {
        // Reuses existing security/session_logs endpoint with extended params
        const action = this.el('lapp-action').value;
        const params = new URLSearchParams({
            date_from: this.el('lapp-from').value,
            date_to:   this.el('lapp-to').value,
            page:      this.pages.app
        });

        // The existing /api/admin/security endpoint filters on login_failed only.
        // For all actions we hit a new combined endpoint — fall back gracefully.
        if (action !== 'all') params.set('action', action);

        const search = this.el('lapp-search').value.trim();
        if (search) params.set('q', search);

        this.setLoading('lapp', true);

        const { ok, data } = await apiFetch(`/api/admin/logs?${params}`);

        this.setLoading('lapp', false);

        if (!ok) return showToast(data.error || 'Failed to load app logs', true);

        this.el('lapp-count').textContent = data.total ?? data.count ?? 0;
        this.renderPagination('lapp', data.page, data.pages, () => this.fetchApp());

        const tbody = this.el('lapp-body');
        tbody.innerHTML = '';

        const rows = data.data || [];

        if (!rows.length) {
            this.el('lapp-empty').hidden = false;
            return;
        }

        this.el('lapp-empty').hidden = true;

        rows.forEach(e => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-action="${e.action || ''}">${e.action || '—'}</td>
                <td>${e.email || '—'}</td>
                <td>${e.ip_address || '—'}</td>
                <td>${e.reason || '—'}</td>
                <td>${e.timestamp || '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    clientFromAppName(appName) {
        if (!appName) return { label: 'DIRECT', cls: 'client-direct' };
        const lower = appName.toLowerCase();
        if (appName.startsWith('dreamland|'))  return { label: 'PYMONGO', cls: 'client-app'    };
        if (lower.includes('mongosh'))         return { label: 'SHELL',   cls: 'client-shell'  };
        if (lower.includes('compass'))         return { label: 'COMPASS', cls: 'client-compass' };
        if (lower.includes('pymongo'))         return { label: 'PYMONGO', cls: 'client-app'    };
        if (lower.includes('studio'))          return { label: 'STUDIO',  cls: 'client-compass' };
        return { label: 'DIRECT', cls: 'client-direct' };
    }

    setLoading(prefix, state) {
        const loadEl  = this.el(`${prefix}-loading`);
        const emptyEl = this.el(`${prefix}-empty`);
        if (loadEl)  loadEl.hidden  = !state;
        if (emptyEl && state) emptyEl.hidden = true;
    }

    renderPagination(prefix, page, pages, fetchFn) {
        const el = this.el(`${prefix}-pagination`);
        if (!el || !pages || pages <= 1) {
            if (el) el.innerHTML = '';
            return;
        }

        el.innerHTML = '';

        // Prev
        if (page > 1) {
            const prev = document.createElement('button');
            prev.className   = 'logs-page-btn';
            prev.textContent = '← Prev';
            prev.addEventListener('click', () => {
                this.pages[this.activeTab]--;
                fetchFn();
            });
            el.appendChild(prev);
        }

        // Page indicator
        const indicator = document.createElement('span');
        indicator.className   = 'logs-page-indicator';
        indicator.textContent = `${page} / ${pages}`;
        el.appendChild(indicator);

        // Next
        if (page < pages) {
            const next = document.createElement('button');
            next.className   = 'logs-page-btn';
            next.textContent = 'Next →';
            next.addEventListener('click', () => {
                this.pages[this.activeTab]++;
                fetchFn();
            });
            el.appendChild(next);
        }
    }
}

// ============================================================================
// INIT LOGS SECTION
// ============================================================================

let logsSection = null;

function initLogsSection() {
    if (!logsSection) {
        logsSection = new LogsSection();
        logsSection.init();
    }
}

// ============================================================================
// SECTION 6: DATABASE MONITOR
// ============================================================================

class DBMonitor {
    constructor() {
        this.socket          = null;
        this.sessions        = new Map();
        this.authEvents      = [];
        this.lifecycleEvents = [];
        this.stats           = { total_logins: 0, failed_auths: 0, active_sessions: 0, server_restarts: 0 };
        this.wsConnected     = false;
        this.authFilter      = 'all';
        this.searchQuery     = '';
        this.currentHost     = null; // track connected host to detect server change
    }

    el(id) { return document.getElementById(id); }

    init() {
        this.bindControls();
        this.setWsStatus('disconnected');
    }

    bindControls() {
        this.el('db-connect-btn').addEventListener('click', () => this.connect());

        this.el('db-auth-filter').addEventListener('change', e => {
            this.authFilter = e.target.value;
            this.renderAuthLog();
        });

        this.el('db-session-search').addEventListener('input', e => {
            this.searchQuery = e.target.value.toLowerCase();
            this.renderSessions();
        });

        this.el('db-console-run').addEventListener('click',   () => this.runConsoleCommand());
        this.el('db-console-clear').addEventListener('click', () => this.clearConsole());
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────
    connect() {
        const host = this.el('db-hostname').value.trim() || 'localhost';
        const port = this.el('db-port').value.trim()     || '27017';

        // Only wipe state when connecting to a DIFFERENT server
        const newTarget = `${host}:${port}`;
        if (this.currentHost && this.currentHost !== newTarget) {
            this.resetUI();
        }

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.setWsStatus('connecting');

        const wsUrl = (host === 'localhost' || host === '127.0.0.1')
            ? window.location.origin
            : `http://${host}:${window.location.port || 5002}`;

        this.socket = io(wsUrl, {
            transports: ['polling', 'websocket'],
            reconnection: true,
            reconnectionDelay: 3000
        });

        this.socket.on('connect',        ()  => this.onConnect(host, port));
        this.socket.on('disconnect',     ()  => this.onDisconnect());
        this.socket.on('initial_state',  d   => this.onInitialState(d));
        this.socket.on('login',          d   => this.onLogin(d));
        this.socket.on('logout',         d   => this.onLogout(d));
        this.socket.on('auth_failed',    d   => this.onAuthFailed(d));
        this.socket.on('server_started', d   => this.onServerStarted(d));
        this.socket.on('server_shutdown',d   => this.onServerShutdown(d));
        this.socket.on('server_restart', d   => this.onServerRestart(d));
        this.socket.on('server_killed',  d   => this.onServerKilled(d));
    }

    // Reset everything — only called when switching to a different server
    resetUI() {
        this.sessions.clear();
        this.authEvents      = [];
        this.lifecycleEvents = [];
        this.stats           = { total_logins: 0, failed_auths: 0, active_sessions: 0, server_restarts: 0 };
        this.updateStatBar();
        this.renderSessions();
        this.renderAuthLog();
        this.renderLifecycle();
        // Clear server stat card
        this.setServerStatCard(null);
    }

    setWsStatus(state) {
        this.wsConnected = state === 'connected';
        const dot   = this.el('db-ws-dot');
        const label = this.el('db-ws-label');
        dot.className = `db-ws-dot ${state}`;
        const labels = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting...' };
        label.textContent = labels[state] || state;
        label.style.color = state === 'connected'
            ? 'var(--success)'
            : state === 'connecting'
                ? 'var(--accent)'
                : 'var(--text-muted)';
    }

    // ── Socket event handlers ─────────────────────────────────────────────────
    onConnect(host, port) {
        const target      = `${host}:${port}`;
        this.currentHost  = target;
        this.wsConnected  = true;

        const dot   = this.el('db-ws-dot');
        const label = this.el('db-ws-label');
        dot.className         = 'db-ws-dot connected';
        label.textContent     = `● ${target}`;
        label.style.color     = 'var(--success)';

        const offlineTag = this.el('db-offline-tag');
        if (offlineTag) offlineTag.hidden = true;
    }

    onDisconnect() {
        // Only update the connected-to label — do NOT wipe stat cards
        // Data stays visible showing last known state
        const dot   = this.el('db-ws-dot');
        const label = this.el('db-ws-label');
        dot.className     = 'db-ws-dot disconnected';
        label.textContent = '○ Disconnected';
        label.style.color = 'var(--text-muted)';

        const offlineTag = this.el('db-offline-tag');
        if (offlineTag) offlineTag.hidden = false;

        this.wsConnected = false;
    }

    onInitialState(data) {
        if (data.stats)           this.updateStats(data.stats);
        if (data.active_sessions) this.loadInitialSessions(data.active_sessions);
        if (data.server_info)     this.setServerStatCard(data.server_info);

        // Load today's lifecycle history from DB — oldest first so newest ends up at top
        // after unshift. We only load if we have history (avoids wiping live events
        // that arrived between reconnects on same session).
        if (data.lifecycle_history && data.lifecycle_history.length) {
            // Build a set of timestamps already in memory to avoid duplicates
            const existing = new Set(this.lifecycleEvents.map(e => e.data.timestamp));
            // DB returns oldest-first — reverse so we unshift in order
            const fresh = data.lifecycle_history.filter(e => !existing.has(e.timestamp));
            // Map DB format to the same shape renderLifecycle expects
            const mapped = fresh.map(e => ({
                type: e.type,
                data: {
                    timestamp: e.timestamp,
                    pid:       e.pid,
                    port:      e.port,
                    host:      e.host,
                    uid:       e.uid,
                }
            }));
            // Merge: live events already in memory stay at top (most recent),
            // historical events go below them
            this.lifecycleEvents = [...this.lifecycleEvents, ...mapped.reverse()];
            this.renderLifecycle();
            const countEl = this.el('db-lifecycle-count');
            if (countEl) countEl.textContent = this.lifecycleEvents.length;
        }

        // Load today's auth history from DB
        if (data.auth_history && data.auth_history.length) {
            const existing = new Set(this.authEvents.map(e => e.data.connect_time || e.data.timestamp));
            const fresh = data.auth_history.filter(e => !existing.has(e.timestamp));
            const mapped = fresh.map(e => ({
                type: e.type,
                ts:   new Date(e.timestamp).getTime(),
                data: {
                    username:     e.username,
                    ip:           e.ip,
                    app_name:     e.app_name,
                    connect_time: e.timestamp,
                    timestamp:    e.timestamp,
                }
            }));
            // Live events stay at top, historical go below
            this.authEvents = [...this.authEvents, ...mapped.reverse()];
            this.renderAuthLog();
            const countEl = this.el('db-auth-count');
            if (countEl) countEl.textContent = this.authEvents.length;
        }
    }

    onLogin(data) {
        // Use conn_id as key — each connection is its own row
        const key = data.connection_id != null
            ? `conn_${data.connection_id}`
            : `${data.username}@${data.ip}_${Date.now()}`;

        const tag = data.client_tag || this.parseClientType(data.app_name).label;
        const isApp = tag === 'PYMONGO';

        this.sessions.set(key, {
            conn_id:    data.connection_id,
            db_user:    data.username,
            app_user:   data.app_user || null,
            ip:         data.ip,
            connected:  data.connect_time,
            app_name:   data.app_name,
            raw_app:    data.app_name,
            client_tag: tag,
            type:       isApp ? 'app' : 'direct',
        });

        this.stats.total_logins++;
        this.stats.active_sessions = this.sessions.size;
        this.renderSessions();
        this.updateStatBar();
        this.addAuthEntry({
            type: isApp ? 'app' : 'success',
            data: { ...data, client_tag: tag }
        });
    }

    onLogout(data) {
        // Remove by conn_id first, fall back to username@ip
        const connKey = `conn_${data.connection_id}`;
        if (this.sessions.has(connKey)) {
            this.sessions.delete(connKey);
        } else {
            for (const [key, s] of this.sessions) {
                if (s.db_user === data.username && s.ip === data.ip) {
                    this.sessions.delete(key);
                    break;
                }
            }
        }
        this.stats.active_sessions = this.sessions.size;
        this.renderSessions();
        this.updateStatBar();
        // Log the logout in auth log
        this.addAuthEntry({
            type: 'logout',
            data: {
                username:    data.username,
                ip:          data.ip,
                client_tag:  data.client_tag,
                timestamp:   data.disconnect_time,
                connect_time: data.disconnect_time,
            }
        });
    }

    onAuthFailed(data) {
        this.stats.failed_auths++;
        this.updateStatBar();
        this.addAuthEntry({
            type: 'failed',
            data: { ...data, connect_time: data.timestamp }
        });
    }

    onServerStarted(data) {
        // Server came back up — re-request server info via a fresh REST call
        // The ws reconnect already triggers onInitialState with server_info,
        // but this handles the case where the log event fires before reconnect settles
        this.addLifecycleEntry('start', data);
    }

    onServerShutdown(data) {
        // Don't touch stat cards — just log it
        this.sessions.clear();
        this.stats.active_sessions = 0;
        this.renderSessions();
        this.updateStatBar();
        this.addLifecycleEntry('shutdown', data);
    }

    onServerRestart(data) {
        this.sessions.clear();
        this.stats.active_sessions  = 0;
        this.stats.server_restarts++;
        this.renderSessions();
        this.updateStatBar();
        this.addLifecycleEntry('restart', data);
    }

    onServerKilled(data) {
        // Don't wipe cards — same-server reconnect will update them
        this.sessions.clear();
        this.stats.active_sessions = 0;
        this.renderSessions();
        this.updateStatBar();
        this.addLifecycleEntry('killed', data);
    }

    // ── Server stat card ──────────────────────────────────────────────────────
    setServerStatCard(info) {
        const card = this.el('db-server-stat-card');
        if (!card) return;

        if (!info) {
            card.innerHTML = `<span class="db-stat-placeholder">—</span>`;
            return;
        }

        const mem     = info.mem     || {};
        const backup  = info.backup  || {};
        const bdir    = info.backup_dir || {};
        const log     = info.log     || {};

        // Format uptime
        const uptime  = info.uptime_sec != null ? this.formatUptime(info.uptime_sec) : '—';

        // Backup status styling
        const bStatus = backup.status || 'unknown';
        const bColor  = bStatus === 'success'
            ? 'var(--success)'
            : bStatus === 'failed'
                ? 'var(--danger)'
                : 'var(--text-muted)';
        const bIcon   = bStatus === 'success' ? '✓' : bStatus === 'failed' ? '✗' : '?';

        card.innerHTML = `
            <div class="srv-stat-row">
                <span class="srv-stat-label">Resident MEM</span>
                <span class="srv-stat-val">${mem.resident_mb != null ? mem.resident_mb + ' MB' : '—'}</span>
            </div>
            <div class="srv-stat-row">
                <span class="srv-stat-label">Virtual MEM</span>
                <span class="srv-stat-val">${mem.virtual_mb != null ? mem.virtual_mb + ' MB' : '—'}</span>
            </div>
            <div class="srv-stat-row">
                <span class="srv-stat-label">Uptime</span>
                <span class="srv-stat-val">${uptime}</span>
            </div>
            <div class="srv-stat-divider"></div>
            <div class="srv-stat-row">
                <span class="srv-stat-label">Log file</span>
                <span class="srv-stat-val">${log.size_mb != null ? log.size_mb + ' MB' : '—'}</span>
            </div>
            <div class="srv-stat-row srv-stat-row--path">
                <span class="srv-stat-path">${log.path || '—'}</span>
            </div>
            <div class="srv-stat-divider"></div>
            <div class="srv-stat-row">
                <span class="srv-stat-label">Last backup</span>
                <span class="srv-stat-val" style="color:${bColor}">${bIcon} ${backup.timestamp || '—'}</span>
            </div>
            <div class="srv-stat-row">
                <span class="srv-stat-label">Backup status</span>
                <span class="srv-stat-val" style="color:${bColor}">${bStatus.toUpperCase()}</span>
            </div>
            <div class="srv-stat-row">
                <span class="srv-stat-label">Dumps</span>
                <span class="srv-stat-val">${bdir.count || 0} files · ${bdir.total_size_mb != null ? bdir.total_size_mb + ' MB' : '—'}</span>
            </div>
            <div class="srv-stat-row">
                <span class="srv-stat-label">Next backup</span>
                <span class="srv-stat-val">${info.next_backup || '20:00'} daily</span>
            </div>
        `;
    }

    formatUptime(secs) {
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600)  / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    parseAppName(appName) {
        if (!appName) return { is_app: false, app_user: null, app_name: appName };
        const parts = appName.split('|');
        if (parts.length >= 3 && parts[0] === 'dreamland') {
            return { is_app: true, app_user: parts[1], app_name: 'Dreamland', action: parts[2] };
        }
        return { is_app: false, app_user: null, app_name: appName };
    }

    // Determine client type label + CSS class from raw app_name
    parseClientType(rawAppName) {
        if (!rawAppName) return { label: 'DIRECT', cls: 'client-direct' };
        const lower = rawAppName.toLowerCase();
        if (rawAppName.startsWith('dreamland|'))   return { label: 'PYMONGO', cls: 'client-app'    };
        if (lower.includes('mongosh'))             return { label: 'SHELL',   cls: 'client-shell'  };
        if (lower.includes('compass'))             return { label: 'COMPASS', cls: 'client-compass' };
        if (lower.includes('pymongo'))             return { label: 'PYMONGO', cls: 'client-app'    };
        if (lower.includes('studio'))              return { label: 'STUDIO',  cls: 'client-compass' };
        return { label: 'DIRECT', cls: 'client-direct' };
    }

    loadInitialSessions(sessions) {
        this.sessions.clear();
        sessions.forEach(s => {
            const parsed = this.parseAppName(s.app_name);
            const key    = s.connection_id || `${s.username}@${s.ip}`;
            this.sessions.set(key, {
                conn_id:   s.connection_id,
                db_user:   s.username,
                app_user:  parsed.app_user,
                ip:        s.ip,
                connected: s.connect_time,
                app_name:  parsed.app_name,
                raw_app:   s.app_name,
                type:      parsed.is_app ? 'app' : 'direct'
            });
        });
        this.stats.active_sessions = this.sessions.size;
        this.renderSessions();
        this.updateStatBar();
    }

    updateServerInfo(info) {
        if (info.pid)  this.el('db-stat-pid').textContent  = info.pid;
        if (info.port) this.el('db-stat-port').textContent = info.port;
    }

    updateStats(stats) {
        this.stats = { ...this.stats, ...stats };
        this.updateStatBar();
    }

    updateStatBar() {
        this.el('db-stat-active').textContent   = this.stats.active_sessions  || 0;
        this.el('db-stat-logins').textContent   = this.stats.total_logins     || 0;
        this.el('db-stat-failed').textContent   = this.stats.failed_auths     || 0;
        this.el('db-stat-restarts').textContent = this.stats.server_restarts  || 0;
    }

    // ── Render Sessions ───────────────────────────────────────────────────────
    renderSessions() {
        const tbody   = this.el('db-sessions-body');
        const emptyEl = this.el('db-sessions-empty');
        const countEl = this.el('db-session-count');
        tbody.innerHTML = '';

        let sessions = [...this.sessions.values()];

        if (this.searchQuery) {
            sessions = sessions.filter(s =>
                (s.db_user  || '').toLowerCase().includes(this.searchQuery) ||
                (s.app_user || '').toLowerCase().includes(this.searchQuery) ||
                (s.ip       || '').toLowerCase().includes(this.searchQuery)
            );
        }

        countEl.textContent = sessions.length;

        if (!sessions.length) {
            emptyEl.removeAttribute('hidden');
            return;
        }

        emptyEl.setAttribute('hidden', '');

        sessions.forEach(s => {
            const client  = this.parseClientType(s.raw_app);

            // Smart TYPE badge
            let typeBadge, typeClass;
            if (s.type === 'app') {
                typeBadge = 'APP';    typeClass = 'badge-app';
            } else if (client.label === 'SHELL') {
                typeBadge = 'SHELL';  typeClass = 'badge-shell';
            } else if (client.label === 'COMPASS' || client.label === 'STUDIO') {
                typeBadge = client.label; typeClass = 'badge-compass';
            } else {
                typeBadge = 'DIRECT'; typeClass = 'badge-direct';
            }

            // Clean APP column label
            let appLabel = '—';
            if (s.type === 'app')                   appLabel = 'Dreamland App';
            else if (s.app_name === 'MongoDB Shell') appLabel = 'MongoDB Shell';
            else if (s.app_name)                     appLabel = s.app_name;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.db_user || '—'}</td>
                <td style="color:${s.app_user ? 'var(--accent)' : 'var(--text-dim)'}">
                    ${s.app_user || '—'}
                </td>
                <td>${s.ip || '—'}</td>
                <td>${formatTime(s.connected)}</td>
                <td>${appLabel}</td>
                <td><span class="badge ${typeClass}">${typeBadge}</span></td>
                <td>
                    <button class="btn-kill-session"
                        data-connid="${s.conn_id || ''}"
                        data-user="${s.db_user}@${s.ip}">Kill</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-kill-session').forEach(btn => {
            btn.addEventListener('click', () =>
                this.killSession(btn.dataset.connid, btn.dataset.user));
        });
    }

    async killSession(connId, userLabel) {
        if (!connId) return showToast('No connection ID — cannot kill this session', true);
        const { ok, data } = await apiFetch(`${DB_API}/kill-session`, {
            method: 'POST',
            body:   JSON.stringify({ connection_id: connId })
        });
        if (!ok) return showToast(data.error || 'Kill failed', true);
        showToast(`Session killed: ${userLabel}`);
    }

    // ── Render Auth Log ───────────────────────────────────────────────────────
    addAuthEntry({ type, data }) {
    this.authEvents.unshift({ type, data, ts: Date.now() });
    this.renderAuthLog();
    const countEl = this.el('db-auth-count');
    if (countEl) countEl.textContent = this.authEvents.length;
     }

renderAuthLog() {
    const container = this.el('db-auth-log');
    const emptyEl   = this.el('db-auth-empty');
    container.innerHTML = '';

    let events = this.authEvents;
    if (this.authFilter !== 'all') {
        events = events.filter(e => {
            if (this.authFilter === 'success')  return e.type === 'success';
            if (this.authFilter === 'failed')   return e.type === 'failed';
            if (this.authFilter === 'app')      return e.type === 'app';
            if (this.authFilter === 'app_init') return e.type === 'app_init';
            if (this.authFilter === 'direct')   return e.type === 'success';
            return true;
        });
    }

    if (!events.length) {
        emptyEl.removeAttribute('hidden');
        return;
    }
    emptyEl.setAttribute('hidden', '');

    // Build a proper table so columns don't squeeze
    const table = document.createElement('table');
    table.className = 'db-auth-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th style="width:90px">Type</th>
                <th style="width:120px">DB User</th>
                <th>App User</th>
                <th style="width:120px">IP</th>
                <th style="width:110px">Client</th>
                <th style="width:160px">Timestamp</th>
                <th style="width:90px">Duration</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    const badgeMap = {
        success:  { label: 'OK',       cls: 'ok'       },
        failed:   { label: 'FAILED',   cls: 'failed'   },
        app:      { label: 'APP',      cls: 'app'      },
        app_init: { label: 'APP_INIT', cls: 'app-init' },
        out:      { label: 'OUT',      cls: 'out'      },
        logout:   { label: 'OUT',      cls: 'out'      },
    };

    events.forEach(({ type, data: d }) => {
        const badge     = badgeMap[type] || { label: type.toUpperCase(), cls: 'ok' };
        const timestamp = formatTime(d.connect_time || d.timestamp);
        const appUser   = d.app_user || '—';
        const duration  = d.duration || '—';

        // Client label — prefer backend client_tag
        let clientLabel = '—';
        if (d.client_tag) {
            const tagMap = {
                'APP':      'PyMongo',
                'APP_INIT': 'PyMongo',
                'SHELL':    'MongoDB Shell',
                'COMPASS':  'Compass',
                'PYMONGO':  'PyMongo',
            };
            clientLabel = tagMap[d.client_tag] || d.client_tag;
        } else if (d.app_name) {
            clientLabel = d.app_name;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="auth-badge ${badge.cls}">${badge.label}</span></td>
            <td>${d.username || '—'}</td>
            <td style="color:${appUser !== '—' ? 'var(--accent)' : 'var(--text-dim)'}">${appUser}</td>
            <td>${d.ip || '—'}</td>
            <td>${clientLabel}</td>
            <td>${timestamp}</td>
            <td style="color:var(--text-muted)">${duration}</td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
}
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    addLifecycleEntry(type, data) {
        this.lifecycleEvents.unshift({ type, data });
        this.renderLifecycle();
    }

    renderLifecycle() {
        const container = this.el('db-lifecycle-log');
        const emptyEl   = this.el('db-lifecycle-empty');
        container.innerHTML = '';

        if (!this.lifecycleEvents.length) {
            emptyEl.removeAttribute('hidden');
            return;
        }

        emptyEl.setAttribute('hidden', '');

        const icons  = { start: '▸', shutdown: '■', restart: '↺', killed: '✕' };
        const labels = {
            start:    'Server Started',
            shutdown: 'Server Shutdown',
            restart:  'Server Restarted',
            killed:   'Server Killed'
        };

        this.lifecycleEvents.forEach(({ type, data: d }) => {
            const div = document.createElement('div');
            div.className = `lc-entry ${type === 'start' ? 'started' : type}`;

            let meta = '';
            if (type === 'start')    meta = `PID: ${d.pid || '—'} · Port: ${d.port || '—'} · Host: ${d.host || '—'}`;
            if (type === 'shutdown') meta = 'Normal shutdown';
            if (type === 'restart')  meta = 'All sessions cleared';
            if (type === 'killed')   meta = `Killed · UID: ${d.uid ?? '—'} · PID: ${d.pid ?? '—'}`;

            div.innerHTML = `
                <span class="lc-icon">${icons[type] || '·'}</span>
                <div class="lc-info">
                    <strong>${labels[type] || type}</strong>
                    <div class="lc-meta">${meta}</div>
                </div>
                <span class="lc-time">${formatTime(d.timestamp)}</span>
            `;
            container.appendChild(div);
        });

        const countEl = this.el('db-lifecycle-count');
        if (countEl) countEl.textContent = this.lifecycleEvents.length;
    }

    // ── DB Console ────────────────────────────────────────────────────────────
    async runConsoleCommand() {
        const cmd    = this.el('db-console-cmd').value;
        const arg    = this.el('db-console-arg').value.trim();
        const output = this.el('db-console-output');

        if (!cmd) return showToast('Select a command first', true);

        output.innerHTML = `<div style="color:var(--text-muted);font-style:italic;">Running ${cmd}...</div>`;

        const { ok, data } = await apiFetch(`${DB_API}/console`, {
            method: 'POST',
            body:   JSON.stringify({ command: cmd, arg })
        });

        output.innerHTML = '';

        if (!ok) {
            output.innerHTML = `<div class="console-error">✗ ${data.error || 'Command failed'}</div>`;
            return;
        }

        this.renderConsoleOutput(data.result, output);
    }

    renderConsoleOutput(result, container) {
        if (!result || typeof result !== 'object') {
            container.innerHTML = `<div class="console-line"><span class="cl-val">${result}</span></div>`;
            return;
        }

        const render = (obj, depth = 0) => {
            Object.entries(obj).forEach(([key, val]) => {
                const div    = document.createElement('div');
                div.className = 'console-line';
                const indent  = '&nbsp;'.repeat(depth * 4);

                if (val === null || val === undefined) {
                    div.innerHTML = `${indent}<span class="cl-key">${key}</span><span class="cl-null">null</span>`;
                } else if (typeof val === 'boolean') {
                    div.innerHTML = `${indent}<span class="cl-key">${key}</span><span class="cl-bool">${val}</span>`;
                } else if (typeof val === 'number') {
                    div.innerHTML = `${indent}<span class="cl-key">${key}</span><span class="cl-num">${val}</span>`;
                } else if (typeof val === 'object' && !Array.isArray(val) && depth < 2) {
                    const header = document.createElement('div');
                    header.className   = 'console-section-header';
                    header.textContent = key;
                    container.appendChild(header);
                    render(val, depth + 1);
                    return;
                } else {
                    const display = Array.isArray(val) ? `[${val.length} items]` : String(val);
                    div.innerHTML = `${indent}<span class="cl-key">${key}</span><span class="cl-val">${display}</span>`;
                }

                container.appendChild(div);
            });
        };

        render(result);
    }

    clearConsole() {
        this.el('db-console-output').innerHTML =
            '<div id="db-console-placeholder">Select a command and press Run.</div>';
        this.el('db-console-cmd').value = '';
        this.el('db-console-arg').value = '';
    }
}

// ============================================================================
// SECTION: LOGS — Persistent DB Auth, Lifecycle, App Logs
// ============================================================================

const LAF_API  = `${DB_API}/auth-logs`;
const LLF_API  = `${DB_API}/lifecycle-logs`;
const LAPP_API = `${API}/logs`;

let lafPage  = 1;
let llfPage  = 1;
let lappPage = 1;

// ── DB AUTH EVENTS ────────────────────────────────────────────────────────────
async function loadAuthLogs(page = 1) {
    lafPage = page;
    const loading = document.getElementById('laf-loading');
    const empty   = document.getElementById('laf-empty');
    const tbody   = document.getElementById('laf-body');

    loading.removeAttribute('hidden');
    empty.setAttribute('hidden', '');
    tbody.innerHTML = '';

    const from   = document.getElementById('laf-from').value;
    const to     = document.getElementById('laf-to').value;
    const type   = document.getElementById('laf-type').value;
    const search = document.getElementById('laf-search').value.trim();

    const params = new URLSearchParams({ page });
    if (from)               params.append('from', from);
    if (to)                 params.append('to',   to);
    if (type && type !== 'all') params.append('type', type);
    if (search)             params.append('q',    search);

    const { ok, data } = await apiFetch(`${LAF_API}?${params}`);
    loading.setAttribute('hidden', '');

    if (!ok) return showToast(data.error || 'Failed to load auth logs', true);
    if (!data.data.length) { empty.removeAttribute('hidden'); return; }

    document.getElementById('laf-count').textContent = data.total;
    renderLafPagination(data.page, data.pages);

    const badgeMap = {
        app:      { label: 'APP',      cls: 'badge-app'     },
        app_init: { label: 'APP_INIT', cls: 'badge-init'    },
        success:  { label: 'OK',       cls: 'badge-active'  },
        failed:   { label: 'FAILED',   cls: 'badge-blocked' },
        out:      { label: 'OUT',      cls: 'badge-out'     },
    };

    const clientMap = {
        'APP':      'PyMongo',
        'APP_INIT': 'PyMongo',
        'SHELL':    'MongoDB Shell',
        'COMPASS':  'Compass',
        'PYMONGO':  'PyMongo',
    };

    data.data.forEach(e => {
        const badge  = badgeMap[e.type] || { label: e.type.toUpperCase(), cls: 'badge-pending' };
        const client = clientMap[e.client_tag] || e.client_tag || e.app_name || '—';
        const appUser = e.app_user || '—';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="badge ${badge.cls}">${badge.label}</span></td>
            <td>${e.username || '—'}</td>
            <td style="color:${appUser !== '—' ? 'var(--accent)' : 'var(--text-muted)'}">${appUser}</td>
            <td>${e.ip || '—'}</td>
            <td>${client}</td>
            <td>${e.timestamp || '—'}</td>
            <td style="color:var(--text-muted)">${e.duration || '—'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLafPagination(current, total) {
    const el = document.getElementById('laf-pagination');
    if (total <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <button onclick="loadAuthLogs(${current - 1})" ${current <= 1 ? 'disabled' : ''}>← Prev</button>
        <span>Page ${current} of ${total}</span>
        <button onclick="loadAuthLogs(${current + 1})" ${current >= total ? 'disabled' : ''}>Next →</button>
    `;
}

document.getElementById('laf-run').addEventListener('click',   () => loadAuthLogs(1));
document.getElementById('laf-clear').addEventListener('click', () => {
    document.getElementById('laf-from').value   = '';
    document.getElementById('laf-to').value     = '';
    document.getElementById('laf-type').value   = 'all';
    document.getElementById('laf-search').value = '';
    loadAuthLogs(1);
});

// ── DB LIFECYCLE ──────────────────────────────────────────────────────────────
async function loadLifecycleLogs(page = 1) {
    llfPage = page;
    const loading = document.getElementById('llf-loading');
    const empty   = document.getElementById('llf-empty');
    const tbody   = document.getElementById('llf-body');

    loading.removeAttribute('hidden');
    empty.setAttribute('hidden', '');
    tbody.innerHTML = '';

    const from = document.getElementById('llf-from').value;
    const to   = document.getElementById('llf-to').value;

    const params = new URLSearchParams({ page });
    if (from) params.append('from', from);
    if (to)   params.append('to',   to);

    const { ok, data } = await apiFetch(`${LLF_API}?${params}`);
    loading.setAttribute('hidden', '');

    if (!ok) return showToast(data.error || 'Failed to load lifecycle logs', true);
    if (!data.data.length) { empty.removeAttribute('hidden'); return; }

    document.getElementById('llf-count').textContent = data.total;
    renderLlfPagination(data.page, data.pages);

    const iconMap = {
        started:  { label: 'STARTED',  cls: 'badge-active'  },
        shutdown: { label: 'SHUTDOWN', cls: 'badge-pending' },
        restart:  { label: 'RESTART',  cls: 'badge-pending' },
        killed:   { label: 'KILLED',   cls: 'badge-blocked' },
    };

    data.data.forEach(e => {
        const badge = iconMap[e.type] || { label: e.type.toUpperCase(), cls: 'badge-pending' };
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="badge ${badge.cls}">${badge.label}</span></td>
            <td>${e.pid  || '—'}</td>
            <td>${e.port || '—'}</td>
            <td>${e.host || '—'}</td>
            <td>${e.uid  || '—'}</td>
            <td>${e.timestamp || '—'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLlfPagination(current, total) {
    const el = document.getElementById('llf-pagination');
    if (total <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <button onclick="loadLifecycleLogs(${current - 1})" ${current <= 1 ? 'disabled' : ''}>← Prev</button>
        <span>Page ${current} of ${total}</span>
        <button onclick="loadLifecycleLogs(${current + 1})" ${current >= total ? 'disabled' : ''}>Next →</button>
    `;
}

document.getElementById('llf-run').addEventListener('click',   () => loadLifecycleLogs(1));
document.getElementById('llf-clear').addEventListener('click', () => {
    document.getElementById('llf-from').value = '';
    document.getElementById('llf-to').value   = '';
    loadLifecycleLogs(1);
});

// ── APP LOGS ──────────────────────────────────────────────────────────────────
async function loadAppLogs(page = 1) {
    lappPage = page;
    const loading = document.getElementById('lapp-loading');
    const empty   = document.getElementById('lapp-empty');
    const tbody   = document.getElementById('lapp-body');

    loading.removeAttribute('hidden');
    empty.setAttribute('hidden', '');
    tbody.innerHTML = '';

    const from   = document.getElementById('lapp-from').value;
    const to     = document.getElementById('lapp-to').value;
    const action = document.getElementById('lapp-action').value;
    const search = document.getElementById('lapp-search').value.trim();

    const params = new URLSearchParams({ page });
    if (from)                   params.append('date_from', from);
    if (to)                     params.append('date_to',   to);
    if (action && action !== 'all') params.append('action', action);
    if (search)                 params.append('q',         search);

    const { ok, data } = await apiFetch(`${LAPP_API}?${params}`);
    loading.setAttribute('hidden', '');

    if (!ok) return showToast(data.error || 'Failed to load app logs', true);
    if (!data.data.length) { empty.removeAttribute('hidden'); return; }

    document.getElementById('lapp-count').textContent = data.total;
    renderLappPagination(data.page, data.pages);

    const actionMap = {
        login_success:           { cls: 'badge-active'  },
        login_failed:            { cls: 'badge-blocked' },
        logout:                  { cls: 'badge-out'     },
        signup:                  { cls: 'badge-pending' },
        account_approved:        { cls: 'badge-active'  },
        forced_logout:           { cls: 'badge-blocked' },
        password_reset_request:  { cls: 'badge-pending' },
        role_changed:            { cls: 'badge-approved'},
    };

    data.data.forEach(e => {
        const cls = (actionMap[e.action] || {}).cls || 'badge-pending';
        const tr  = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="badge ${cls}">${e.action || '—'}</span></td>
            <td>${e.email      || '—'}</td>
            <td>${e.ip_address || '—'}</td>
            <td style="color:var(--text-muted)">${e.reason || '—'}</td>
            <td>${e.timestamp  || '—'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLappPagination(current, total) {
    const el = document.getElementById('lapp-pagination');
    if (total <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <button onclick="loadAppLogs(${current - 1})" ${current <= 1 ? 'disabled' : ''}>← Prev</button>
        <span>Page ${current} of ${total}</span>
        <button onclick="loadAppLogs(${current + 1})" ${current >= total ? 'disabled' : ''}>Next →</button>
    `;
}

document.getElementById('lapp-run').addEventListener('click',   () => loadAppLogs(1));
document.getElementById('lapp-clear').addEventListener('click', () => {
    document.getElementById('lapp-from').value    = '';
    document.getElementById('lapp-to').value      = '';
    document.getElementById('lapp-action').value  = 'all';
    document.getElementById('lapp-search').value  = '';
    loadAppLogs(1);
});

// ── TAB SWITCHING — load data on first visit ──────────────────────────────────
const logsTabLoaded = { auth: false, lifecycle: false, app: false };

document.querySelectorAll('.logs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.logs-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.logs-pane').forEach(p => p.setAttribute('hidden', ''));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById(`logs-pane-${tab}`).removeAttribute('hidden');

        // Load on first open only — user can re-filter manually
        if (!logsTabLoaded[tab]) {
            logsTabLoaded[tab] = true;
            if (tab === 'auth')      loadAuthLogs(1);
            if (tab === 'lifecycle') loadLifecycleLogs(1);
            if (tab === 'app')       loadAppLogs(1);
        }
    });
});

// Load default tab on section open
loadAuthLogs(1);
logsTabLoaded.auth = true;
// ============================================================================
// INIT DATABASE SECTION
// ============================================================================

let dbMonitor = null;

function initDatabaseSection() {
    if (!dbMonitor) {
        dbMonitor = new DBMonitor();
        dbMonitor.init();
    }
}

// ============================================================================
// INIT
// ============================================================================

showSection('overview');
loadStats();

