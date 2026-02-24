document.addEventListener('DOMContentLoaded', () => {
    const data = window.stockData || [];
    const role = window.userRole || 'user';
    const grid = document.getElementById('stock-grid');

    if (!grid) {
        console.error("Error: #stock-grid not found in DOM");
        return;
    }

    console.log("stock.js: Loaded with", data.length, "items");

    function renderCard(item) {
        const low = item.stock_quantity <= item.reorder_quantity;
        const mid = item.stock_quantity <= item.reorder_quantity * 2;

        const bg = low ? 'bg-orange-50 border-l-4 border-orange-500' :
                   mid ? 'bg-yellow-50 border-l-4 border-yellow-500' :
                         'bg-green-50 border-l-4 border-green-500';

        const qtyClass = low ? 'text-red-600' : mid ? 'text-yellow-600' : 'text-green-600';
        const badge = low ? 'bg-orange-100 text-orange-800' :
                      mid ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800';

        // === CLEAN EXPIRY DISPLAY ===
        let expiryHtml = '';
        if (item.expire_date) {
            const days = item.days_left;
            const dateColor = days <= 7 ? 'text-red-600' :
                              days <= 30 ? 'text-yellow-600' :
                                           'text-green-600';
            const badgeBg = days <= 7 ? 'bg-red-100 text-red-800' :
                            days <= 30 ? 'bg-yellow-100 text-yellow-800' :
                                         'bg-green-100 text-green-800';

            expiryHtml = `
                <span class="block text-lg font-medium ${dateColor}">${item.expire_date}</span>
                ${days !== null && days >= 0 ? `
                    <span class="inline-flex items-center mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeBg}">
                        ${days} day${days !== 1 ? 's' : ''} left
                    </span>` : ''}
            `;
        } else {
            expiryHtml = '<span class="block text-lg font-medium text-gray-500">N/A</span>';
        }

        const editBtn = role === 'manager' ? `
            <button class="edit-stock-name-btn text-gray-500 hover:text-blue-700 transition-colors" data-stock-id="${item.stock_id}" data-stock-name="${item.stock_name}" type="button">
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.379-8.379-2.828-2.828z"/>
                </svg>
            </button>` : '';

        const managerControls = role === 'manager' ? `
            <div class="mt-3 border-t pt-3">
                <button type="button" class="toggle-manager-dropdown w-full flex items-center justify-between text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors" data-stock-id="${item.stock_id}">
                    <span>Manager Actions</span>
                    <svg class="h-4 w-4 transform transition-transform dropdown-arrow" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
                    </svg>
                </button>

                <div class="manager-dropdown-content hidden mt-3 space-y-4" data-stock-id="${item.stock_id}">
                    <div>
                        <h4 class="text-xs font-semibold text-orange-700 mb-2">Restock Item</h4>
                        <form method="POST" action="/stock" class="space-y-2">
                            <input type="hidden" name="action" value="restock">
                            <input type="hidden" name="stock_id" value="${item.stock_id}">
                            <div class="flex items-center gap-2">
                                <input type="number" name="restock_quantity" min="1" placeholder="Qty" class="flex-grow p-2 border rounded text-sm focus:ring focus:ring-orange-200">
                                <button type="submit" class="bg-orange-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-orange-600 transition-colors whitespace-nowrap">
                                    Restock
                                </button>
                            </div>
                        </form>
                    </div>

                    <div class="border-t pt-3">
                        <h4 class="text-xs font-semibold text-blue-700 mb-2">Adjust Prices</h4>
                        <form method="POST" action="/stock" class="space-y-2">
                            <input type="hidden" name="action" value="update_price_and_category">
                            <input type="hidden" name="stock_id" value="${item.stock_id}">
                            <div>
                                <label class="block text-xs text-gray-600 mb-1">Retail Price</label>
                                <input type="number" name="new_selling_price" step="0.01" min="0" placeholder="${item.selling_price}" class="w-full p-2 border rounded text-sm focus:ring focus:ring-blue-200">
                            </div>
                            <div>
                                <label class="block text-xs text-gray-600 mb-1">Wholesale Price</label>
                                <input type="number" name="new_wholesale_price" step="0.01" min="0" placeholder="${item.wholesale}" class="w-full p-2 border rounded text-sm focus:ring focus:ring-blue-200">
                            </div>
                            <div>
                                <label class="block text-xs text-gray-600 mb-1">Company Price</label>
                                <input type="number" name="new_company_price" step="0.01" min="0" placeholder="${item.company_price}" class="w-full p-2 border rounded text-sm focus:ring focus:ring-blue-200">
                            </div>
                            <button type="submit" class="w-full bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-600 transition-colors">
                                Update Prices
                            </button>
                        </form>
                    </div>
                </div>
            </div>` : '';

        return `
            <div class="stock-card p-5 rounded-lg shadow-md hover:shadow-lg ${bg} transition-shadow" data-stock-id="${item.stock_id}">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center gap-2">
                        <h3 class="text-lg font-semibold">${item.stock_name}</h3>
                        ${editBtn}
                    </div>
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge}">
                        ${item.category}
                    </span>
                </div>
                <div class="grid grid-cols-2 gap-2 mb-4">
                    <div>
                        <span class="text-sm font-medium">Quantity:</span>
                        <span class="block text-lg font-bold ${qtyClass}">${item.stock_quantity}</span>
                        <span class="text-xs text-gray-500">(Reorder at ${item.reorder_quantity})</span>
                    </div>
                    <div>
                        <span class="text-sm font-medium">Expires:</span>
                        ${expiryHtml}
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center mb-4 bg-white rounded p-2">
                    <div><div class="text-gray-500 text-xs">Retail</div><div class="font-bold">${item.selling_price}</div></div>
                    <div class="border-l border-r border-gray-200"><div class="text-gray-500 text-xs">Wholesale</div><div class="font-bold">${item.wholesale}</div></div>
                    <div><div class="text-gray-500 text-xs">Cost</div><div class="font-bold">${item.company_price}</div></div>
                </div>
                ${managerControls}
            </div>`;
    }

    function render() {
        if (data.length === 0) {
            grid.innerHTML = '<p class="col-span-full text-center text-gray-500">No stock items found.</p>';
            return;
        }
        grid.innerHTML = data.map(renderCard).join('');
        attachEventListeners();
    }

    function attachEventListeners() {
        document.querySelectorAll('.toggle-manager-dropdown').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const stockId = e.currentTarget.dataset.stockId;
                const content = document.querySelector(`.manager-dropdown-content[data-stock-id="${stockId}"]`);
                const arrow = e.currentTarget.querySelector('.dropdown-arrow');
                if (content) {
                    content.classList.toggle('hidden');
                    arrow.classList.toggle('rotate-180');
                }
            });
        });

        document.querySelectorAll('.edit-stock-name-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const stockId = e.currentTarget.dataset.stockId;
                const stockName = e.currentTarget.dataset.stockName;
                const modal = document.getElementById('edit-stock-name-modal');
                const stockIdInput = document.getElementById('edit-stock-id');
                const stockNameInput = document.getElementById('new_stock_name');
                if (modal && stockIdInput && stockNameInput) {
                    stockIdInput.value = stockId;
                    stockNameInput.value = stockName;
                    modal.classList.remove('hidden');
                }
            });
        });
    }

    const modal = document.getElementById('edit-stock-name-modal');
    const cancelBtn = document.getElementById('cancel-edit-stock-name');
    const closeNotification = document.getElementById('close-notification');
    const toggleBtn = document.getElementById('toggle-add-stock-form');
    const addStockForm = document.getElementById('add-stock-form');
    const categorySelect = document.getElementById('category');
    const newCategoryInput = document.getElementById('new_category');

    if (cancelBtn && modal) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    if (closeNotification) closeNotification.addEventListener('click', () => {
        const toast = document.getElementById('notification-toast');
        if (toast) toast.classList.add('hidden');
    });
    if (toggleBtn && addStockForm) toggleBtn.addEventListener('click', () => addStockForm.classList.toggle('hidden'));
    if (categorySelect && newCategoryInput) {
        categorySelect.addEventListener('change', (e) => {
            if (e.target.value === 'new') {
                newCategoryInput.classList.remove('hidden');
                newCategoryInput.required = true;
            } else {
                newCategoryInput.classList.add('hidden');
                newCategoryInput.required = false;
            }
        });
    }

    // ── Toast ─────────────────────────────────────────────────────────────────
    function showToast(msg, isError = false) {
        const toast  = document.getElementById('notification-toast');
        const title  = document.getElementById('notification-title');
        const msgEl  = document.getElementById('notification-message');
        const icon   = toast.querySelector('svg');
        title.textContent = isError ? 'Error' : 'Success';
        msgEl.textContent = msg;
        icon.classList.toggle('text-red-500',   isError);
        icon.classList.toggle('text-green-500', !isError);
        toast.classList.remove('hidden', 'translate-y-10', 'opacity-0');
        setTimeout(() => toast.classList.add('translate-y-10', 'opacity-0'), 3000);
        setTimeout(() => toast.classList.add('hidden'), 3400);
    }

    // ── Delegated form intercept (catches dynamically rendered forms) ─────────
    document.addEventListener('submit', async (e) => {
        const form = e.target;
        if (form.method !== 'post' || !form.action.includes('/stock')) return;
        e.preventDefault();
        try {
            const res  = await fetch('/stock', { method: 'POST', body: new FormData(form) });
            const data = await res.json();
            if (data.status === 'success') {
                showToast(data.message || 'Done');
                setTimeout(() => location.reload(), 1200);
            } else {
                showToast(data.error || 'Something went wrong', true);
            }
        } catch (err) {
            showToast('Request failed', true);
        }
    });

    render();
});
