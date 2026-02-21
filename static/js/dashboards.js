// ============================================================================
// DASHBOARD MANAGER - Complete Middleman Architecture
// ============================================================================
(function() {
    'use strict';

    const CONFIG = {
        apiEndpoint: '/api/dashboard/stats',
        clockInterval: 1000,
        debounceDelay: 300,
        animationDuration: 500,
        timezone: 'Africa/Nairobi'
    };

    let currentStats = {};
    let clockTimer = null;
    let debounceTimer = null;
    let isUpdating = false;

    // ========================================
    // 1. LIVE CLOCK UPDATE
    // ========================================
    function updateLiveClock() {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const formattedDateTime = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
        const clockElement = document.getElementById('live-datetime');
        if (clockElement) clockElement.textContent = formattedDateTime;
        checkForNewDay(now);
    }

    // ========================================
    // 2. FETCH ALL DATA FROM API
    // ========================================
    async function fetchDashboardData() {
        if (isUpdating) return;
        isUpdating = true;

        try {
            const response = await fetch(CONFIG.apiEndpoint, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
            });

            // === HANDLE SESSION TERMINATION ===
            if (response.status === 401) {
                // Session was killed — check why via response body
                let reason = 'session_expired';
                try {
                    const data = await response.json();
                    reason = data.reason || 'session_expired';
                } catch (_) {}

                if (reason === 'account_blocked') {
                    showAdminNotification(
                        '🚫 Account Suspended',
                        'Your account has been suspended. Contact support.',
                        'red',
                        () => window.location.href = '/auth'
                    );
                } else if (reason === 'force_logout') {
                    showAdminNotification(
                        '⚠️ Logged Out by Admin',
                        'An administrator has ended your session.',
                        'orange',
                        () => window.location.href = '/auth'
                    );
                } else if (reason === 'global_logout') {
                    showAdminNotification(
                        '⚠️ System Logout',
                        'All sessions have been terminated by an administrator.',
                        'orange',
                        () => window.location.href = '/auth'
                    );
                } else {
                    // Generic 401 - session expired
                    window.location.href = '/auth';
                }
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.status === 'success') {
                currentStats = data.stats;
                updateAllCards(data.stats);
                updateSessionInfo(data.session_info);
                console.log('✅ Dashboard data updated successfully');
            } else {
                console.error('❌ API returned error:', data.error);
                showErrorNotification('Failed to fetch dashboard data');
            }

        } catch (error) {
            console.error('❌ Error fetching dashboard data:', error);
            showErrorNotification('Connection error - please refresh the page');
        } finally {
            isUpdating = false;
        }
    }

    // ========================================
    // 3. DEBOUNCED REFRESH
    // ========================================
    function debouncedRefresh() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchDashboardData(), CONFIG.debounceDelay);
    }

    // ========================================
    // 4. UPDATE SESSION INFO
    // ========================================
    function updateSessionInfo(sessionInfo) {
        if (!sessionInfo) return;
        const sessionStartElement = document.getElementById('session-start-time');
        if (sessionStartElement && sessionInfo.session_started) {
            const sessionDate = new Date(sessionInfo.session_started);
            sessionStartElement.textContent = formatDateTime(sessionDate);
        }
    }

    // ========================================
    // 5. UPDATE ALL CARDS
    // ========================================
    function updateAllCards(stats) {
        animateValue('total-sales-value', stats.total_sales_today);
        updateText('total-sales-orders',
            `Today's performance (${stats.open_orders_count} open, ${stats.closed_orders_count} closed) - Resets daily`);
        animateValue('retail-sales-value', stats.retail_sales_today);
        updateText('retail-orders-info', `${stats.retail_open_orders} open, ${stats.retail_closed_orders} closed`);
        animateValue('wholesale-sales-value', stats.wholesale_sales_today);
        updateText('wholesale-orders-info', `${stats.wholesale_open_orders} open, ${stats.wholesale_closed_orders} closed`);
        animateValue('debt-value', stats.total_debt);
        animateValue('expenses-value', stats.total_expenses);
    }

    // ========================================
    // 6. ANIMATE NUMBER CHANGES
    // ========================================
    function animateValue(elementId, newValue) {
        const element = document.getElementById(elementId);
        if (!element) return;
        const currentText = element.textContent.replace(/[^0-9.\-]/g, '');
        const currentValue = parseFloat(currentText) || 0;
        const targetValue = parseFloat(newValue) || 0;
        if (Math.abs(currentValue - targetValue) < 0.01) {
            element.textContent = `KSh ${targetValue.toFixed(2)}`;
            return;
        }
        element.classList.add('stats-update-flash');
        setTimeout(() => element.classList.remove('stats-update-flash'), CONFIG.animationDuration);
        const steps = 30;
        const increment = (targetValue - currentValue) / steps;
        const stepDuration = CONFIG.animationDuration / steps;
        let currentStep = 0;
        const timer = setInterval(() => {
            currentStep++;
            element.textContent = `KSh ${(currentValue + increment * currentStep).toFixed(2)}`;
            if (currentStep >= steps) {
                clearInterval(timer);
                element.textContent = `KSh ${targetValue.toFixed(2)}`;
            }
        }, stepDuration);
    }

    // ========================================
    // 7. UPDATE TEXT
    // ========================================
    function updateText(elementId, newText) {
        const element = document.getElementById(elementId);
        if (element && element.textContent !== newText) element.textContent = newText;
    }

    // ========================================
    // 8. FORMAT DATETIME
    // ========================================
    function formatDateTime(date) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    // ========================================
    // 9. CHECK FOR NEW DAY
    // ========================================
    let lastCheckedDate = new Date().toDateString();
    function checkForNewDay(currentDate) {
        const currentDateString = currentDate.toDateString();
        if (currentDateString !== lastCheckedDate) {
            lastCheckedDate = currentDateString;
            handleDailyReset();
        }
    }

    // ========================================
    // 10. DAILY RESET
    // ========================================
    function handleDailyReset() {
        showResetNotification();
        fetchDashboardData();
        if (typeof window.reloadActivityData === 'function') window.reloadActivityData();
    }

    // ========================================
    // 11. RESET NOTIFICATION
    // ========================================
    function showResetNotification() {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce';
        notification.innerHTML = `
            <div class="flex items-center space-x-2">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span class="font-semibold">New Day Started! Dashboard Reset 🌅</span>
            </div>
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    // ========================================
    // 12. ERROR NOTIFICATION (keep existing)
    // ========================================
    function showErrorNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        notification.innerHTML = `
            <div class="flex items-center space-x-2">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span class="font-semibold">${message}</span>
            </div>
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 4000);
    }

    // ========================================
    // 13. ADMIN ACTION NOTIFICATION (NEW)
    // Shows a prominent notification then redirects after delay
    // ========================================
    function showAdminNotification(title, message, color, onExpire) {
        // Remove any existing admin notifications
        document.querySelectorAll('.admin-notification').forEach(n => n.remove());

        const colorMap = {
            red: 'bg-red-600 border-red-800',
            orange: 'bg-orange-500 border-orange-700'
        };

        const notification = document.createElement('div');
        notification.className = `admin-notification fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-60`;
        notification.innerHTML = `
            <div class="rounded-xl shadow-2xl border-2 ${colorMap[color] || colorMap.red} text-white p-8 max-w-md w-full mx-4 text-center">
                <div class="text-4xl mb-3">${title.split(' ')[0]}</div>
                <h2 class="text-xl font-bold mb-2">${title.split(' ').slice(1).join(' ')}</h2>
                <p class="text-sm opacity-90 mb-6">${message}</p>
                <div class="text-xs opacity-75">Redirecting to login in <span id="redirect-countdown">5</span>s...</div>
            </div>
        `;
        document.body.appendChild(notification);

        // Countdown
        let count = 5;
        const countdownEl = notification.querySelector('#redirect-countdown');
        const countdownTimer = setInterval(() => {
            count--;
            if (countdownEl) countdownEl.textContent = count;
            if (count <= 0) {
                clearInterval(countdownTimer);
                if (onExpire) onExpire();
            }
        }, 1000);
    }

    // ========================================
    // 14. MANUAL REFRESH
    // ========================================
    function setupManualRefresh() {
        const refreshButton = document.getElementById('manual-refresh-btn');
        if (refreshButton) refreshButton.addEventListener('click', () => fetchDashboardData());
    }

    // ========================================
    // 15. CLEANUP
    // ========================================
    function cleanup() {
        if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }

    // ========================================
    // 16. INJECT CSS
    // ========================================
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .stats-update-flash { animation: flash 0.5s ease-in-out; }
            @keyframes flash {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; transform: scale(1.05); }
            }
            #total-sales-value, #retail-sales-value, #wholesale-sales-value,
            #debt-value, #expenses-value { transition: all 0.3s ease-in-out; }
        `;
        document.head.appendChild(style);
    }

    // ========================================
    // 17. INIT
    // ========================================
    function init() {
        injectStyles();
        updateLiveClock();
        clockTimer = setInterval(updateLiveClock, CONFIG.clockInterval);
        fetchDashboardData();
        setupManualRefresh();
        window.addEventListener('beforeunload', cleanup);
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) fetchDashboardData();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.DashboardManager = {
        refresh: fetchDashboardData,
        refreshDebounced: debouncedRefresh,
        getCurrentStats: () => currentStats,
        triggerReset: handleDailyReset,
        version: '2.1.0'
    };

})();
