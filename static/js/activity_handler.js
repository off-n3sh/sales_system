// ============================================================
// ACTIVITY HANDLER - Main Controller
// ============================================================
function toggleDetails(id) {
    const element = document.getElementById(id);
    if (element) {
        element.classList.toggle('hidden');
    }
    }
const ActivityHandler = (() => {
    // State Management
    const state = {
        currentFilter: 'all',
        selectedDate: null,
        currentPage: 1,
        itemsPerPage: 50,
        rawData: [],
        displayData: [],
        stats: {},
        counts: {}
    };

    // DOM Elements
    const DOM = {
        filterBtns: document.querySelectorAll('.filter-btn'),
        datePicker: document.getElementById('activity-date-picker'),
        clearDateBtn: document.getElementById('clear-date'),
        statsBanner: document.getElementById('stats-banner'),
        tbody: document.getElementById('activity-tbody'),
        loadingRow: document.getElementById('loading-row'),
        paginationControls: document.getElementById('pagination-controls'),
        prevPageBtn: document.getElementById('prev-page'),
        nextPageBtn: document.getElementById('next-page'),
        currentPageSpan: document.getElementById('current-page'),
        totalPagesSpan: document.getElementById('total-pages'),
        exportPdfBtn: document.getElementById('export-pdf'),
        exportDocxBtn: document.getElementById('export-docx'),
        // Stats elements
        statOrders: document.getElementById('stat-orders'),
        statTotal: document.getElementById('stat-total'),
        statDebt: document.getElementById('stat-debt'),
        statExpenses: document.getElementById('stat-expenses'),
        statModified: document.getElementById('stat-modified'),
        statNet: document.getElementById('stat-net'),
        // Count badges
        countAll: document.getElementById('count-all'),
        countPending: document.getElementById('count-pending'),
        countCompleted: document.getElementById('count-completed'),
        countExpenses: document.getElementById('count-expenses'),
        countGateway: document.getElementById('count-gateway'),
        countModified: document.getElementById('count-modified'),
        countPrevious: document.getElementById('count-previous')
    };

    // ============================================================
    // INITIALIZATION
    // ============================================================
    function init() {
        console.log('ActivityHandler initializing...');
        attachEventListeners();
        loadActivities();
    }

    function attachEventListeners() {
        // Filter buttons
        DOM.filterBtns.forEach(btn => {
            btn.addEventListener('click', handleFilterChange);
        });

        // Date picker
        if (DOM.datePicker) {
            DOM.datePicker.addEventListener('change', handleDateChange);
        }
        
        if (DOM.clearDateBtn) {
            DOM.clearDateBtn.addEventListener('click', clearDate);
        }

        // Pagination
        if (DOM.prevPageBtn) {
            DOM.prevPageBtn.addEventListener('click', () => changePage(-1));
        }
        
        if (DOM.nextPageBtn) {
            DOM.nextPageBtn.addEventListener('click', () => changePage(1));
        }

        // Export buttons
        if (DOM.exportPdfBtn) {
            DOM.exportPdfBtn.addEventListener('click', () => exportData('pdf'));
        }
        
        if (DOM.exportDocxBtn) {
            DOM.exportDocxBtn.addEventListener('click', () => exportData('docx'));
        }
        
        

    }
    

    // ============================================================
    // EVENT HANDLERS
    // ============================================================
    function handleFilterChange(e) {
        const filter = e.currentTarget.dataset.filter;
        
        // Update active state
        DOM.filterBtns.forEach(btn => {
            // Remove all ring classes
            btn.classList.remove('ring-2', 'ring-blue-300', 'ring-red-300', 'ring-green-300', 
                                'ring-purple-300', 'ring-orange-300', 'ring-yellow-300');
            
            if (btn.dataset.filter === filter) {
                btn.classList.add('ring-2');
                // Add ring color based on filter
                if (filter === 'all') btn.classList.add('ring-blue-300');
                else if (filter === 'pending') btn.classList.add('ring-red-300');
                else if (filter === 'completed') btn.classList.add('ring-green-300');
                else if (filter === 'expenses') btn.classList.add('ring-purple-300');
                else if (filter === 'gateway') btn.classList.add('ring-green-300');
                else if (filter === 'modified') btn.classList.add('ring-orange-300');
                else if (filter === 'previous') btn.classList.add('ring-yellow-300');
            }
        });

        state.currentFilter = filter;
        state.currentPage = 1;
        loadActivities();
    }

    function handleDateChange(e) {
        state.selectedDate = e.target.value;
        state.currentPage = 1;
        loadActivities();
    }

    function clearDate() {
        state.selectedDate = null;
        DOM.datePicker.value = '';
        state.currentPage = 1;
        loadActivities();
    }

    function changePage(direction) {
        state.currentPage += direction;
        loadActivities();
    }

    
    // ============================================================
    // DATA FETCHING
    // ============================================================
    async function loadActivities() {
        showLoading();

        const params = new URLSearchParams({
            filter: state.currentFilter,
            page: state.currentPage,
            per_page: state.itemsPerPage
        });

        if (state.selectedDate) {
            params.append('date', state.selectedDate);
        }

        try {
            const url = `/api/activities?${params.toString()}`;
            console.log('Fetching:', url);
            
            const response = await fetch(url);
            
            // Read response as text first to debug
            const text = await response.text();
            console.log('Response status:', response.status);
            console.log('Response text:', text.substring(0, 200)); // First 200 chars
            
            // Parse JSON
            let data;
            try {
                data = JSON.parse(text);
            } catch (parseError) {
                console.error('JSON Parse Error:', parseError);
                console.error('Response was:', text);
                throw new Error('Invalid JSON response from server');
            }

            console.log('Parsed data:', data);

            state.displayData = data.activities || [];
            state.stats = data.stats || {};
            state.counts = data.counts || {};

            updateCountBadges();
            
            if (data.mode === 'sorted' && state.selectedDate) {
                showStatsBanner();
                updateStats();
            } else {
                hideStatsBanner();
            }

            renderTable();
            updatePagination(data.pagination);

        } catch (error) {
            console.error('Failed to load activities:', error);
            showError(error.message);
        }
    }

// Helper: Render payment activity for TODAY
function renderPaymentActivityToday(payments) {
    if (!payments || payments.length === 0) {
        return '<div>No payments recorded today</div>';
    }

    let html = '<div><strong>Payment Activity (Today):</strong></div>';
    
    payments.forEach(payment => {
        if (payment.is_dual) {
            // Dual payment
            html += `<div class="ml-2">• ${payment.time} - Dual Payment:</div>`;
            html += `<div class="ml-4">- Cash: KSh ${formatNumber(payment.cash_amount)}</div>`;
            html += `<div class="ml-4">- M-Pesa: KSh ${formatNumber(payment.mpesa_amount)}</div>`;
        } else {
            // Single payment
            html += `<div class="ml-2">• ${payment.time} - Paid KSh ${formatNumber(payment.amount)} (${payment.payment_type.toUpperCase()})</div>`;
        }
    });

    return html;
}

// Helper: Render payment activity BEFORE today (for previous orders)
function renderPaymentActivityBefore(payments, balanceBefore) {
    if (!payments || payments.length === 0) {
        return '<div>No previous payments</div>';
    }

    let html = '<div><strong>Previous Payment Activity:</strong></div>';
    
    payments.forEach(payment => {
        if (payment.is_dual) {
            // Dual payment
            html += `<div class="ml-2">• ${payment.date} ${payment.time} - Dual Payment:</div>`;
            html += `<div class="ml-4">- Cash: KSh ${formatNumber(payment.cash_amount)}</div>`;
            html += `<div class="ml-4">- M-Pesa: KSh ${formatNumber(payment.mpesa_amount)}</div>`;
        } else {
            // Single payment
            html += `<div class="ml-2">• ${payment.date} ${payment.time} - Paid KSh ${formatNumber(payment.amount)} (${payment.payment_type.toUpperCase()})</div>`;
        }
    });

    html += `<div class="ml-2 mt-1"><strong>Previous balance:</strong> KSh ${formatNumber(balanceBefore)}</div>`;

    return html;
}

// ============================================================
// UI RENDERING - NOW BELOW HELPERS
// ============================================================

    function renderTable() {
        DOM.tbody.innerHTML = '';

        if (!state.displayData || state.displayData.length === 0) {
            DOM.tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        No activities found for the selected filter.
                    </td>
                </tr>
            `;
            return;
        }

        state.displayData.forEach(activity => {
            const row = createActivityRow(activity);
            DOM.tbody.appendChild(row);
        });
    }

    function createActivityRow(activity) {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';

        // Add special styling for modified/previous orders
        if (activity.is_modified) {
            tr.classList.add('bg-orange-50', 'dark:bg-orange-900', 'border-l-4', 'border-orange-500');
        } else if (activity.is_previous) {
            tr.classList.add('bg-yellow-50', 'dark:bg-yellow-900', 'border-l-4', 'border-yellow-500');
        }

        tr.innerHTML = `
            ${renderAvatar(activity)}
            ${renderUserActivity(activity)}
            ${renderOpenDate(activity)}
            ${renderCloseDate(activity)}
            ${renderType(activity)}
            ${renderAmount(activity)}
            ${renderStatus(activity)}
            ${renderActions(activity)}
        `;

        return tr;
    }

    function renderAvatar(activity) {
        const initial = activity.user ? activity.user[0].toUpperCase() : 'N';
        return `
            <td class="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                    <div class="text-gray-700 dark:text-white font-bold text-base sm:text-lg">
                        ${initial}
                    </div>
                </div>
            </td>
        `;
    }

    function renderUserActivity(activity) {
    let html = `
        <td class="px-3 sm:px-6 py-3 sm:py-4">
            <div class="font-medium text-gray-900 dark:text-white text-sm">
                ${escapeHtml(activity.user || 'N/A')}
    `;

    // Add tags and toggle based on activity type
    
    // MODIFIED ORDER
    if (activity.is_modified) {
        html += `
            <span class="inline-block bg-orange-200 text-orange-900 text-xs px-2 py-0.5 rounded-full ml-1">✏️ Modified</span>
            <button onclick="toggleDetails('edit-${activity.receipt_id}')" 
                    class="text-orange-600 hover:text-orange-800 text-xs ml-1 font-bold">ⓘ</button>
            <div id="edit-${activity.receipt_id}" class="hidden mt-2 p-2 bg-orange-50 dark:bg-orange-900 rounded text-xs space-y-1 border-l-2 border-orange-400">
                <div><strong>Opened:</strong> ${formatDateTime(activity.open_date)}</div>
                <div class="border-t border-orange-300 my-1"></div>
                <div><strong>Original Order:</strong></div>
                <div class="ml-2">${activity.edit_tag.old_items_count || 0} items @ KSh ${formatNumber(activity.edit_tag.old_price || 0)}</div>
                <div class="ml-2">Paid: KSh ${formatNumber(activity.edit_tag.amount_paid || 0)}</div>
                <div class="ml-2">Balance: KSh ${formatNumber(activity.edit_tag.old_balance || 0)}</div>
                <div class="border-t border-orange-300 my-1"></div>
                <div><strong>Modified at:</strong> ${activity.edit_tag.modification_date ? formatDateTime(activity.edit_tag.modification_date) : 'N/A'}</div>
                <div class="ml-2">Changed to: ${activity.edit_tag.new_items_count || 0} items @ KSh ${formatNumber(activity.edit_tag.new_price || 0)}</div>
                <div class="ml-2">Items changed: ${escapeHtml(activity.edit_tag.items_added_list || 'None')}</div>
                <div class="ml-2">New balance: KSh ${formatNumber(activity.edit_tag.new_balance || 0)}</div>
                <div class="border-t border-orange-300 my-1"></div>
                ${renderPaymentActivityToday(activity.payment_activity_today)}
            </div>
        `;
    }
    // PREVIOUS ORDER
    else if (activity.is_previous) {
        html += `
            <span class="inline-block bg-yellow-200 text-yellow-900 text-xs px-2 py-0.5 rounded-full ml-1">📅 Previous</span>
            <button onclick="toggleDetails('prev-${activity.receipt_id}')" 
                    class="text-yellow-600 hover:text-yellow-800 text-xs ml-1 font-bold">ⓘ</button>
            <div id="prev-${activity.receipt_id}" class="hidden mt-2 p-2 bg-yellow-50 dark:bg-yellow-900 rounded text-xs space-y-1 border-l-2 border-yellow-400">
                <div><strong>Originally opened:</strong> ${formatDateTime(activity.open_date)}</div>
                <div class="border-t border-yellow-300 my-1"></div>
                ${renderPaymentActivityBefore(activity.payment_activity_before, activity.balance_before_today)}
                <div class="border-t border-yellow-300 my-1"></div>
                ${renderPaymentActivityToday(activity.payment_activity_today)}
                <div class="border-t border-yellow-300 my-1"></div>
                <div><strong>Total Paid:</strong> KSh ${formatNumber(activity.payment || 0)} / KSh ${formatNumber(activity.total || 0)}</div>
                <div><strong>New Balance:</strong> KSh ${formatNumber(activity.balance || 0)}</div>
            </div>
        `;
    }
    // REGULAR ORDER WITH TOGGLE (multi-payment or dual)
    else if (activity.needs_toggle && activity.type === 'order') {
        html += `
            <button onclick="toggleDetails('activity-${activity.receipt_id}')" 
                    class="text-blue-600 hover:text-blue-800 text-xs ml-1 font-bold">ⓘ</button>
            <div id="activity-${activity.receipt_id}" class="hidden mt-2 p-2 bg-blue-50 dark:bg-blue-900 rounded text-xs space-y-1 border-l-2 border-blue-400">
                <div><strong>Opened:</strong> ${formatDateTime(activity.open_date)}</div>
                <div class="border-t border-blue-300 my-1"></div>
                ${renderPaymentActivityToday(activity.payment_activity_today)}
                <div class="border-t border-blue-300 my-1"></div>
                <div><strong>Total Paid:</strong> KSh ${formatNumber(activity.payment || 0)} / KSh ${formatNumber(activity.total || 0)}</div>
                <div><strong>Balance:</strong> KSh ${formatNumber(activity.balance || 0)}</div>
            </div>
        `;
    }

    // For expenses, show description
    if (activity.type === 'expense' && activity.activity_text) {
        html += `<div class="text-xs text-gray-600 dark:text-gray-400 mt-1">${escapeHtml(activity.activity_text)}</div>`;
    }

    // Show location for orders
    if (activity.shop) {
        html += `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Client: ${escapeHtml(activity.shop)}</div>`;
    }

    html += `</div></td>`;
    return html;
}


// Helper function to render payment activity list
function renderPaymentActivity(activity) {
    if (!activity.payment_activity || activity.payment_activity.length === 0) {
        return '<div>No payments recorded today</div>';
    }

    let html = '<div><strong>Payment Activity (Today):</strong></div>';
    
    activity.payment_activity.forEach(payment => {
        html += `<div class="ml-2">• ${payment.time} - Paid KSh ${formatNumber(payment.amount)} (${payment.type.toUpperCase()})</div>`;
    });

    return html;
}

    function renderOpenDate(activity) {
        const date = activity.open_date || activity.date;
        const formatted = date ? formatDateTime(date) : 'N/A';
        return `
            <td class="px-3 sm:px-6 py-3 sm:py-4 text-xs text-gray-600 dark:text-gray-200">
                ${formatted}
            </td>
        `;
    }

    function renderCloseDate(activity) {
        const date = activity.close_date;
        const formatted = date ? formatDateTime(date) : '-';
        return `
            <td class="px-3 sm:px-6 py-3 sm:py-4 text-xs text-gray-600 dark:text-gray-200">
                ${formatted}
            </td>
        `;
    }

    function renderType(activity) {
        if (activity.type === 'expense') {
            return `
                <td class="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                    <span class="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        Expense
                    </span>
                </td>
            `;
        }

        const orderType = activity.order_type || 'N/A';
        const bgColor = orderType === 'retail' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
        
        return `
            <td class="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                <span class="px-2 py-1 rounded-full text-xs font-medium ${bgColor}">
                    ${escapeHtml(orderType.charAt(0).toUpperCase() + orderType.slice(1))}
                </span>
            </td>
        `;
    }

    function renderAmount(activity) {
        if (activity.type === 'expense') {
            return `
                <td class="px-3 sm:px-6 py-3 sm:py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                    KSh ${formatNumber(activity.amount || 0)}
                </td>
            `;
        }

        if (activity.type === 'payment') {
            return `
                <td class="px-3 sm:px-6 py-3 sm:py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                    KSh ${formatNumber(activity.amount_paid || 0)}/${formatNumber(activity.total || 0)}
                </td>
            `;
        }

        // Regular order
        return `
            <td class="px-3 sm:px-6 py-3 sm:py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                KSh ${formatNumber(activity.payment || 0)}/${formatNumber(activity.total || 0)}
            </td>
        `;
    }

    function renderStatus(activity) {
        const status = activity.status || 'pending';
        const bgColor = status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
        const text = status === 'completed' ? 'Paid' : 'Pending';

        return `
            <td class="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                <span class="px-2 py-1 rounded-full text-xs font-medium ${bgColor}">
                    ${text}
                </span>
            </td>
        `;
    }

    function renderActions(activity) {
        if (activity.type === 'expense') {
            return `<td class="px-3 sm:px-6 py-3 sm:py-4"></td>`;
        }

        return `
            <td class="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right text-sm">
                <a href="/receipt/${activity.receipt_id}" class="text-blue-600 hover:text-blue-900">View</a>
            </td>
        `;
    }

    // ============================================================
    // STATS & COUNTS
    // ============================================================
    function updateStats() {
    if (DOM.statOrders) DOM.statOrders.textContent = state.stats.total_orders || 0;
    if (DOM.statTotal) DOM.statTotal.textContent = formatNumber(state.stats.gross_total || 0);
    if (DOM.statDebt) DOM.statDebt.textContent = formatNumber(state.stats.debt || 0);
    if (DOM.statExpenses) DOM.statExpenses.textContent = formatNumber(state.stats.expenses || 0);
    if (DOM.statModified) DOM.statModified.textContent = state.stats.modified_orders || 0;
    if (DOM.statNet) DOM.statNet.textContent = formatNumber(state.stats.net || 0);
     }

    function updateCountBadges() {
        if (DOM.countAll) DOM.countAll.textContent = state.counts.all || 0;
        if (DOM.countPending) DOM.countPending.textContent = state.counts.pending || 0;
        if (DOM.countCompleted) DOM.countCompleted.textContent = state.counts.completed || 0;
        if (DOM.countExpenses) DOM.countExpenses.textContent = state.counts.expenses || 0;
        if (DOM.countGateway) DOM.countGateway.textContent = state.counts.gateway || 0;
        if (DOM.countModified) DOM.countModified.textContent = state.counts.modified || 0;
        if (DOM.countPrevious) DOM.countPrevious.textContent = state.counts.previous || 0;
    }

    function showStatsBanner() {
        if (DOM.statsBanner) {
            DOM.statsBanner.classList.remove('hidden');
        }
    }

    function hideStatsBanner() {
        if (DOM.statsBanner) {
            DOM.statsBanner.classList.add('hidden');
        }
    }

    // ============================================================
    // PAGINATION
    // ============================================================
    function updatePagination(pagination) {
        if (!pagination || pagination.total_pages <= 1) {
            if (DOM.paginationControls) {
                DOM.paginationControls.classList.add('hidden');
            }
            return;
        }

        if (DOM.paginationControls) {
            DOM.paginationControls.classList.remove('hidden');
        }
        
        if (DOM.currentPageSpan) {
            DOM.currentPageSpan.textContent = pagination.current_page;
        }
        
        if (DOM.totalPagesSpan) {
            DOM.totalPagesSpan.textContent = pagination.total_pages;
        }

        // Enable/disable buttons
        if (DOM.prevPageBtn) {
            DOM.prevPageBtn.disabled = !pagination.has_prev;
        }
        
        if (DOM.nextPageBtn) {
            DOM.nextPageBtn.disabled = !pagination.has_next;
        }
    }

    // ============================================================
    // EXPORT
    // ============================================================
    function exportData(format) {
        const params = new URLSearchParams({
            filter: state.currentFilter,
            format: format
        });

        if (state.selectedDate) {
            params.append('date', state.selectedDate);
        }

        window.location.href = `/api/activities/export?${params.toString()}`;
    }

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================
    function formatDateTime(dateStr) {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';
        
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    function formatNumber(num) {
        if (typeof num !== 'number') {
            num = parseFloat(num) || 0;
        }
        return num.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showLoading() {
        DOM.tbody.innerHTML = `
            <tr id="loading-row">
                <td colspan="8" class="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    <div class="flex justify-center items-center">
                        <svg class="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span class="ml-3 text-sm">Loading activities...</span>
                    </div>
                </td>
            </tr>
        `;
    }

    function showError(message = 'Failed to load activities. Please try again.') {
        DOM.tbody.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-8 text-center text-red-500">
                    ${escapeHtml(message)}
                </td>
            </tr>
        `;
    }

    // Public API
    return {
        init
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    ActivityHandler.init();
});
