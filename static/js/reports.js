/**
 * Dreamland Financial Dashboard - AJAX Stability & Debugging
 */

// --- 1. STATE MANAGEMENT ---
const State = {
    currentTab: 'orders',
    currentPage: 1,
    timeFilter: 'day',
    searchQuery: '',
    isLoading: false,
    hasMore: false,
    comparisonMode: 'day' // day, week, month
};

// --- 2. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Dashboard JS: Initializing...");
    
    const timeDropdown = document.getElementById('time-filter');
    if (timeDropdown) {
        State.timeFilter = timeDropdown.value;
        console.log(`⏱️ Initial time filter: ${State.timeFilter}`);
    }
    
    initDashboard();
});

function initDashboard() {
    if (window.dashboardInitialized) {
        console.log("⚠️ Dashboard already initialized, skipping...");
        return;
    }
    
    if (window.Chart) {
        Chart.defaults.color = document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563';
        initCharts();
    }

    initTabs();          
    initSearch();        
    initPagination();    
    initExport();
    initComparison();    // NEW: Initialize comparison toggles
    
    // Initial fetch to populate the History tab
    fetchLogs(false);

    window.dashboardInitialized = true;
    console.log("✅ Dashboard initialization complete");
}

// --- 3. AJAX CORE LOGIC ---
async function fetchLogs(append = false) {
    if (State.isLoading) {
        console.warn("⏸️ Already loading, skipping fetch...");
        return;
    }
    
    console.log(`📡 Fetching: [${State.currentTab}] Page: ${State.currentPage} Filter: ${State.timeFilter}`);
    
    const feedContainer = document.getElementById('active-feed');
    const loadMoreContainer = document.getElementById('load-more-container');
    
    State.isLoading = true;
    
    if (!append) {
        feedContainer.innerHTML = `
            <div class="py-20 text-center flex flex-col items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
                <p class="text-gray-400 text-xs italic">Pulling records...</p>
            </div>`;
    }

    try {
        const params = new URLSearchParams({
            tab: State.currentTab,
            page: State.currentPage,
            time: State.timeFilter,
            search: State.searchQuery
        });

        const url = `/api/logs?${params.toString()}`;
        console.log(`🔗 Fetching URL: ${url}`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ Server returned ${response.status}`);
            throw new Error(`Server Error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`📦 Received data for ${State.currentTab}:`, data);

        if (!append) feedContainer.innerHTML = ''; 
        
        if (data.html && data.html.trim() !== "") {
            feedContainer.insertAdjacentHTML('beforeend', data.html);
            State.hasMore = data.has_more;
            console.log(`✅ Rendered ${State.currentTab} data. Has more: ${State.hasMore}`);
        } else if (!append) {
            feedContainer.innerHTML = `
                <div class="py-20 text-center">
                    <p class="text-gray-400 text-sm">No entries found for this period.</p>
                </div>`;
            State.hasMore = false;
            console.log("📭 No data returned from server");
        }

        // Load More Button Visibility
        if (loadMoreContainer) {
            if (State.hasMore) {
                console.log("➕ More data available. Showing 'Load More' button.");
                loadMoreContainer.classList.remove('hidden');
                loadMoreContainer.style.display = 'block';
            } else {
                console.log("🏁 No more data. Hiding 'Load More' button.");
                loadMoreContainer.classList.add('hidden');
                loadMoreContainer.style.display = 'none';
            }
        }

    } catch (err) {
        console.error("💥 [AJAX CRASH]", err);
        if (!append) {
            feedContainer.innerHTML = `
                <div class="py-20 text-center">
                    <p class="text-red-500 text-sm font-bold">Failed to load ${State.currentTab} data.</p>
                    <button onclick="fetchLogs(false)" class="mt-2 text-xs text-blue-500 underline uppercase tracking-widest font-bold">Retry Connection</button>
                </div>`;
        }
    } finally {
        State.isLoading = false;
        console.log("🔓 Loading state released");
    }
}

// --- 4. TAB & FILTER CONTROLS ---
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    console.log(`🗂️ Found ${tabs.length} tabs`);
    
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            if (State.isLoading || btn.classList.contains('active')) {
                console.log(`⏭️ Skipping tab click (loading: ${State.isLoading}, active: ${btn.classList.contains('active')})`);
                return;
            }

            console.log(`📑 Tab switched to: ${btn.dataset.tab}`);

            // UI Styling Switch
            tabs.forEach(b => {
                b.classList.remove('active', 'text-blue-600', 'bg-white', 'dark:bg-gray-800', 'shadow-sm');
                b.classList.add('text-gray-500');
            });
            btn.classList.add('active', 'text-blue-600', 'bg-white', 'dark:bg-gray-800', 'shadow-sm');

            // Reset State for the new tab
            State.currentTab = btn.dataset.tab;
            State.currentPage = 1;
            State.hasMore = false;
            
            fetchLogs(false);
        });
    });
}

// --- 5. TIME FILTER (Sales Report) ---
window.updateTimeFilter = function() {
    const timeFilter = document.getElementById('time-filter').value;
    console.log(`⏱️ Time filter changed: ${timeFilter}`);
    
    // Build new URL with time parameter
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('time', timeFilter);
    
    console.log(`🔄 Redirecting to: ${currentUrl.toString()}`);
    window.location.href = currentUrl.toString();
};

// --- 6. SEARCH & PAGINATION ---
function initSearch() {
    const searchInput = document.getElementById('log-search');
    let timeout = null;

    searchInput?.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            State.searchQuery = e.target.value;
            State.currentPage = 1;
            console.log(`🔍 Search query: "${State.searchQuery}"`);
            fetchLogs(false);
        }, 500); 
    });
    
    if (searchInput) {
        console.log("🔎 Search input initialized");
    }
}

function initPagination() {
    const loadMoreBtn = document.getElementById('load-more-btn');
    
    loadMoreBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!State.isLoading && State.hasMore) {
            State.currentPage++;
            console.log(`📄 Loading page ${State.currentPage}...`);
            fetchLogs(true); 
        } else {
            console.log(`⚠️ Cannot load more (loading: ${State.isLoading}, hasMore: ${State.hasMore})`);
        }
    });
    
    if (loadMoreBtn) {
        console.log("📑 Pagination initialized");
    }
}

// --- 7. EXPORT & PRINT CONTROLS ---
function initExport() {
    const btn = document.getElementById('export-dropdown-btn');
    const dropdown = document.getElementById('export-dropdown');
    
    if (!btn || !dropdown) {
        console.warn("⚠️ Export dropdown elements not found");
        return;
    }
    
    // Toggle dropdown on button click
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
        const isOpen = !dropdown.classList.contains('hidden');
        console.log(`📂 Export dropdown ${isOpen ? 'opened' : 'closed'}`);
    });
    
    // Close dropdown when clicking outside
    window.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
    
    console.log("💾 Export dropdown initialized");
}

// Print report function
window.printReport = function() {
    const timeFilter = document.getElementById('time-filter')?.value || 'day';
    const printUrl = `/sales_report?time=${timeFilter}`;
    
    console.log(`🖨️ Opening print view: ${printUrl}`);
    
    // Open print page in new window
    const printWindow = window.open(printUrl, '_blank', 'width=400,height=800');
    
    if (printWindow) {
        printWindow.onload = function() {
            console.log("📄 Print page loaded, triggering print dialog...");
            printWindow.print();
        };
    } else {
        console.error("❌ Failed to open print window (popup blocked?)");
        alert("Please allow popups to print reports.");
    }
    
    // Close dropdown
    document.getElementById('export-dropdown')?.classList.add('hidden');
};

// Export report function (future PDF/DOCX)
window.exportReport = function(format) {
    const timeFilter = document.getElementById('time-filter')?.value || 'day';
    const exportUrl = `/export_sales_report/${format}?time=${timeFilter}`;
    
    console.log(`📥 Export request: ${format.toUpperCase()} (${exportUrl})`);
    console.log("⚠️ Export feature not yet implemented");
    
    // TODO: Implement actual export
    alert(`${format.toUpperCase()} export coming soon!`);
    
    // Close dropdown
    document.getElementById('export-dropdown')?.classList.add('hidden');
};

// --- 8. COMPARISON TOGGLE ---
function initComparison() {
    const toggles = document.querySelectorAll('.comparison-toggle');
    
    if (toggles.length === 0) {
        console.warn("⚠️ Comparison toggles not found");
        return;
    }
    
    console.log(`📊 Found ${toggles.length} comparison toggles`);
    
    toggles.forEach(btn => {
        btn.addEventListener('click', () => {
            const compareMode = btn.dataset.compare;
            
            if (State.comparisonMode === compareMode) {
                console.log(`⏭️ Already in ${compareMode} comparison mode`);
                return;
            }
            
            console.log(`📊 Comparison mode changed to: ${compareMode}`);
            
            // Update UI
            toggles.forEach(b => {
                b.classList.remove('active', 'bg-indigo-600', 'text-white', 'shadow-sm');
                b.classList.add('text-gray-500');
            });
            btn.classList.add('active', 'bg-indigo-600', 'text-white', 'shadow-sm');
            
            // Update state
            State.comparisonMode = compareMode;
            
            // Fetch comparison data
            fetchComparisonData(compareMode);
        });
    });
    
    // Load initial comparison (yesterday vs today by default)
    fetchComparisonData(State.comparisonMode);
}

// Fetch comparison data
async function fetchComparisonData(mode) {
    console.log(`📡 Fetching comparison data: ${mode}`);
    
    const container = document.getElementById('comparison-cards');
    
    if (!container) {
        console.warn("⚠️ Comparison cards container not found");
        return;
    }
    
    // Show loading state
    container.innerHTML = `
        <div class="col-span-full text-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
            <p class="text-gray-400 text-xs mt-2">Loading comparison...</p>
        </div>`;
    
    try {
        const response = await fetch(`/api/comparison?mode=${mode}`);
        
        if (!response.ok) {
            throw new Error(`Server Error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`📊 Comparison data received:`, data);
        
        // Render comparison cards
        renderComparisonCards(data);
        
    } catch (err) {
        console.error("💥 Comparison fetch failed:", err);
        container.innerHTML = `
            <div class="col-span-full text-center py-8">
                <p class="text-red-500 text-sm">Failed to load comparison data</p>
            </div>`;
    }
}

// Render comparison cards
function renderComparisonCards(data) {
    const container = document.getElementById('comparison-cards');
    
    const growth = data.current_net - data.previous_net;
    const growthPercent = data.previous_net > 0 
        ? ((growth / data.previous_net) * 100).toFixed(1) 
        : 0;
    
    const isPositive = growth >= 0;
    const trend = isPositive ? '📈 Growing' : '📉 Declining';
    const trendColor = isPositive ? 'text-green-600' : 'text-red-600';
    
    container.innerHTML = `
        <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm">
            <p class="text-xs text-gray-500 dark:text-gray-400 font-semibold">Previous Period Net</p>
            <p class="text-2xl font-black text-gray-700 dark:text-gray-300 mt-2">KES ${data.previous_net.toLocaleString()}</p>
            <p class="text-xs text-gray-400 mt-1">${data.previous_label}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm">
            <p class="text-xs text-gray-500 dark:text-gray-400 font-semibold">Current Period Net</p>
            <p class="text-2xl font-black text-gray-900 dark:text-white mt-2">KES ${data.current_net.toLocaleString()}</p>
            <p class="text-xs text-gray-400 mt-1">${data.current_label}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm">
            <p class="text-xs text-gray-500 dark:text-gray-400 font-semibold">Growth</p>
            <p class="text-2xl font-black ${trendColor} mt-2">${isPositive ? '+' : ''}${growthPercent}%</p>
            <p class="text-xs text-gray-400 mt-1">${isPositive ? '+' : ''}KES ${growth.toLocaleString()}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm">
            <p class="text-xs text-gray-500 dark:text-gray-400 font-semibold">Trend</p>
            <p class="text-2xl font-black ${trendColor} mt-2">${trend}</p>
            <p class="text-xs text-gray-400 mt-1">${isPositive ? 'Keep it up!' : 'Needs attention'}</p>
        </div>`;
}

// --- 9. REPORT MANAGEMENT ---
window.deleteReport = function(reportId) {
    if (!confirm('Are you sure you want to delete this report? This action cannot be undone.')) {
        console.log("🚫 Report deletion cancelled");
        return;
    }
    
    console.log(`🗑️ Deleting report: ${reportId}`);
    
    fetch(`/api/delete_report/${reportId}`, { method: 'DELETE' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log("✅ Report deleted successfully");
                // Remove the card from UI
                const reportCard = document.querySelector(`[data-report-id="${reportId}"]`);
                if (reportCard) {
                    reportCard.remove();
                }
                // Or reload page
                location.reload();
            } else {
                console.error("❌ Failed to delete report");
                alert('Failed to delete report');
            }
        })
        .catch(err => {
            console.error("💥 Delete request failed:", err);
            alert('Error deleting report');
        });
};

// --- 10. CHART VISUALIZATION (PRESERVED) ---
function initCharts() {
    if (!window.chartData) {
        console.warn("⚠️ No chart data available");
        return;
    }
    
    console.log("📊 Initializing charts...");
    
    const formatCurrency = (val) => 'KES ' + val.toLocaleString();
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
        }
    };

    // Sales vs Debts Chart
    const salesCtx = document.getElementById('sales-vs-debts-chart');
    if (salesCtx) {
        console.log("📊 Rendering Sales vs Debts chart");
        new Chart(salesCtx, {
            type: 'bar',
            data: {
                labels: ['Retail', 'Wholesale'],
                datasets: [
                    { label: 'Revenue', data: [chartData.sales_vs_debts.data[0], chartData.sales_vs_debts.data[1]], backgroundColor: '#3b82f6', borderRadius: 4 },
                    { label: 'Debt', data: [chartData.sales_vs_debts.data[2], chartData.sales_vs_debts.data[3]], backgroundColor: '#ef4444', borderRadius: 4 }
                ]
            },
            options: commonOptions
        });
    }

    // Paid vs Debt Chart
    const paidCtx = document.getElementById('paid-vs-debt-chart');
    if (paidCtx) {
        console.log("📊 Rendering Paid vs Debt chart");
        new Chart(paidCtx, {
            type: 'doughnut',
            data: {
                labels: ['Paid', 'Debt'],
                datasets: [{
                    data: [
                        (chartData.paid_vs_debt.data[0] + chartData.paid_vs_debt.data[1]), 
                        (chartData.paid_vs_debt.data[2] + chartData.paid_vs_debt.data[3])
                    ],
                    backgroundColor: ['#10b981', '#f87171'],
                    borderWidth: 0
                }]
            },
            options: { ...commonOptions, cutout: '70%' }
        });
    }
    
    // Money in Bank Chart
    const bankCtx = document.getElementById('money-in-bank-chart');
    if (bankCtx) {
        console.log("📊 Rendering Money in Bank chart");
        new Chart(bankCtx, {
            type: 'line',
            data: {
                labels: ['Retail', 'Wholesale'],
                datasets: [{
                    label: 'Cash Flow',
                    data: [chartData.money_in_bank.data[0], chartData.money_in_bank.data[1]],
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderColor: '#22c55e',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: commonOptions
        });
    }
    
    console.log("✅ Charts initialized");
}