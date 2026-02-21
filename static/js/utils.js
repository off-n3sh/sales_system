let stockDataCache = null;
let currentStockVersion = null;

async function fetchStockData(forceRefresh = false) {
    if (forceRefresh) {
        console.log('Force refresh requested - bypassing cache');
        stockDataCache = null;
        currentStockVersion = null;
    }
    
    if (stockDataCache && currentStockVersion !== null && !forceRefresh) {
        try {
            const versionResponse = await fetch('/stock_data?version_only=true', { credentials: 'include' });
            if (!versionResponse.ok) throw new Error(`HTTP error: ${versionResponse.status}`);
            const { version } = await versionResponse.json();
            if (version === currentStockVersion) {
                console.log('Using cached stock data (version: ' + currentStockVersion + ')');
                return stockDataCache;
            }
            console.log('Version mismatch (cache: ' + currentStockVersion + ', server: ' + version + '). Fetching new data.');
        } catch (error) {
            console.error('Error checking stock version:', error);
        }
    }
    
    try {
        const response = await fetch('/stock_data', { credentials: 'include', cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const { version, data } = await response.json();
        if (!Array.isArray(data)) throw new Error('Invalid response format: Expected an array');
        
        stockDataCache = data.map(item => ({
            id: item.id,
            stock_name: item.stock_name,
            selling_price: parseFloat(item.selling_price) || 0,
            wholesale: parseFloat(item.wholesale) || 0,
            stock_quantity: parseFloat(item.stock_quantity) || 0,
            uom: item.uom || 'Unit'
        }));
        currentStockVersion = version;
        console.log('Fetched new stock data (version: ' + version + ')');
        return stockDataCache;
    } catch (error) {
        console.error('Error fetching stock data from /stock_data:', error);
        return [];
    }
}

function invalidateStockCache() {
    console.log('Invalidating stock cache');
    stockDataCache = null;
    currentStockVersion = null;
}

async function refreshStockData() {
    return await fetchStockData(true);
}

function updateSubtotal(container) {
    let subtotal = 0;
    const rows = container.querySelectorAll('.item-row');
    rows.forEach(row => {
        const totalDisplay = row.querySelector('.total-display');
        if (totalDisplay && totalDisplay.value) subtotal += parseFloat(totalDisplay.value) || 0;
    });
    const totalSpan = container.parentElement.querySelector('[id$="-order-total"]');
    if (totalSpan) totalSpan.textContent = subtotal.toFixed(2);
    updateChange(container);
}

function updateChange(container) {
    const modalId = container.id.split('-')[0];
    const amountPaidInput = document.getElementById(`${modalId}-amount-paid`);
    const changeSpan = document.getElementById(`${modalId}-order-change`);
    const totalSpan = container.parentElement.querySelector('[id$="-order-total"]');
    const paymentTypeInput = document.getElementById(`${modalId}-payment-type`);
    const subtotal = parseFloat(totalSpan.textContent) || 0;
    const amountPaid = parseFloat(amountPaidInput.value) || 0;

    // Calculate change
    const change = amountPaid - subtotal;

    // Update change display
    changeSpan.textContent = change >= 0 ? change.toFixed(2) : '0.00';
    changeSpan.parentElement.classList.toggle('text-green-600', change >= 0);
    changeSpan.parentElement.classList.toggle('text-red-600', change < 0);

    // Only set amountPaidInput to subtotal for credit payments
    if (paymentTypeInput.value === 'credit') {
        amountPaidInput.value = '0.00';
    }
}

function showModalError(modalId, message) {
    const errorDiv = document.getElementById(`${modalId}-error`);
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        setTimeout(() => errorDiv.classList.add('hidden'), 5000);
    } else {
        console.warn(`Error div for ${modalId} not found. Message: ${message}`);
        alert(message);
    }
}

async function populateClients(inputElement, debtElement) {
    try {
        const response = await fetch('/clients_data');
        const clients = await response.json();
        const choices = new Choices(inputElement, {
            searchEnabled: true,
            allowHTML: false,
            placeholderValue: 'Search or type a client name',
            noResultsText: 'No clients found - type to add a new client',
            addItems: true,
            removeItemButton: true,
            maxItemCount: 1,
            duplicateItemsAllowed: false,
            choices: clients.map(client => ({
                value: client.shop_name,
                label: `${client.shop_name} (Debt: KSh ${client.debt.toFixed(2)})`
            })),
            searchFloor: 1,
            searchResultLimit: 10,
            shouldSort: false,
        });

        inputElement.closest('.modal').addEventListener('modal:open', () => {
            choices.clearInput();
            choices.removeActiveItems();
            debtElement.textContent = '';
            debtElement.classList.add('hidden');
        });

        inputElement.addEventListener('change', () => {
            const value = choices.getValue(true);
            const selectedClient = clients.find(c => c.shop_name === value);
            if (selectedClient) {
                debtElement.textContent = `Debt: KSh ${selectedClient.debt.toFixed(2)}`;
                debtElement.classList.remove('hidden');
            } else if (value) {
                debtElement.textContent = 'Debt: KSh 0.00 (New Client)';
                debtElement.classList.remove('hidden');
                if (!choices.getChoiceByValue(value)) {
                    choices.setChoices([{ value: value, label: value }], 'value', 'label', false);
                    choices.setChoiceByValue(value);
                }
            } else {
                debtElement.textContent = '';
                debtElement.classList.add('hidden');
            }
        });

        inputElement.addEventListener('search', (event) => {
            const searchTerm = event.detail.value.toLowerCase();
            const filteredClients = clients.filter(client => 
                client.shop_name.toLowerCase().includes(searchTerm)
            );
            choices.setChoices(
                filteredClients.map(client => ({
                    value: client.shop_name,
                    label: `${client.shop_name} (Debt: KSh ${client.debt.toFixed(2)})`
                })),
                'value',
                'label',
                true
            );
            if (searchTerm && !filteredClients.some(c => c.shop_name.toLowerCase() === searchTerm)) {
                choices.setChoices([{ value: searchTerm, label: `${searchTerm} (New)` }], 'value', 'label', false);
            }
        });
    } catch (error) {
        console.error('Error loading clients:', error);
        showModalError(inputElement.closest('form').id.replace('-form', ''), 'Failed to load clients.');
    }
}

function addManualItem(container, modal) {
    if (!container || !modal || modal.classList.contains('hidden')) {
        console.warn('Skipping addManualItem: container or modal not found or modal is hidden');
        return;
    }
    console.log('Adding manual item to container:', container.id);

    const div = document.createElement('div');
    div.className = 'grid grid-cols-6 gap-2 item-row';
    div.dataset.manual = 'true';
    div.innerHTML = `
        <input name="items[]" type="text" placeholder="Manual Item Name" class="col-span-1 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 product-input w-full" required>
        <input name="quantities[]" type="number" placeholder="Qty" class="p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 qty-input text-center w-full" min="0" step="0.01">
        <input name="unit_prices[]" type="number" placeholder="Price" class="price-display p-2 border rounded-lg text-center w-full" step="0.01" min="0">
        <input type="number" value="" class="stock-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly disabled>
        <input type="number" value="0" class="total-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly>
        <button type="button" class="remove-item bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">X</button>
    `;
    const addBtn = container.querySelector('.add-item-btn');
    if (!addBtn) {
        console.error('Add item button not found in container');
        return;
    }
    container.insertBefore(div, addBtn);
    console.log('Manual item row added');

    const removeHandler = () => {
        console.log('Removing manual item row');
        div.remove();
        updateSubtotal(container);
    };
    div.querySelector('.remove-item').addEventListener('click', removeHandler);

    attachPriceListener(div, modal);
    updateSubtotal(container);
}

function attachPriceListener(row, modal) {
    if (!row || !modal || modal.classList.contains('hidden')) {
        console.warn('Skipping attachPriceListener: row or modal not found or modal is hidden');
        return;
    }
    const select = row.querySelector('.product-select');
    const productInput = row.querySelector('.product-input');
    const priceDisplay = row.querySelector('.price-display');
    const stockDisplay = row.querySelector('.stock-display');
    const totalDisplay = row.querySelector('.total-display');
    const qtyInput = row.querySelector('.qty-input');
    let basePrice = 0;
    let maxStock = 0;

    const selectHandler = () => {
        if (!modal || modal.classList.contains('hidden')) {
            console.warn('Skipping selectHandler: modal is hidden');
            return;
        }
        const selectedOption = select.options[select.selectedIndex];
        if (selectedOption.value) {
            const values = selectedOption.value.split('|');
            basePrice = parseFloat(values[5]) || 0;
            maxStock = parseFloat(values[7]) || 0;
            priceDisplay.value = basePrice.toFixed(2);
            stockDisplay.value = maxStock.toFixed(2);
            qtyInput.max = maxStock;
            qtyInput.disabled = false;
            const qty = parseFloat(qtyInput.value) || 0;
            if (maxStock !== undefined && qty > maxStock) {
                qtyInput.value = maxStock;
                showModalError(row.closest('.modal').id.split('-')[0], `Cannot order more than ${maxStock} units of ${values[1]}.`);
            }
            totalDisplay.value = (basePrice * qty).toFixed(2);
            updateSubtotal(row.closest('.space-y-4'));
        } else {
            basePrice = 0;
            maxStock = 0;
            priceDisplay.value = '';
            stockDisplay.value = '';
            totalDisplay.value = '';
            qtyInput.max = '';
            qtyInput.disabled = true;
            qtyInput.value = '';
            updateSubtotal(row.closest('.space-y-4'));
        }
    };
    if (select) {
        select.addEventListener('change', selectHandler);
    }

    const qtyHandler = () => {
        if (!modal || modal.classList.contains('hidden')) {
            console.warn('Skipping qtyHandler: modal is hidden');
            return;
        }
        const qty = parseFloat(qtyInput.value) || 0;
        if (maxStock !== undefined && qty > maxStock && !row.dataset.manual) {
            qtyInput.value = maxStock;
            showModalError(row.closest('.modal').id.split('-')[0], `Cannot order more than ${maxStock} units.`);
        }
        const currentPrice = parseFloat(priceDisplay.value) || basePrice;
        totalDisplay.value = (currentPrice * qty).toFixed(2);
        updateSubtotal(row.closest('.space-y-4'));
    };
    qtyInput.addEventListener('input', qtyHandler);

    const priceHandler = () => {
        if (!modal || modal.classList.contains('hidden')) {
            console.warn('Skipping priceHandler: modal is hidden');
            return;
        }
        const qty = parseFloat(qtyInput.value) || 0;
        const newPrice = parseFloat(priceDisplay.value) || 0;
        totalDisplay.value = (newPrice * qty).toFixed(2);
        updateSubtotal(row.closest('.space-y-4'));
    };
    priceDisplay.addEventListener('input', priceHandler);
}

export { fetchStockData, updateSubtotal, updateChange, showModalError, populateClients, addManualItem, attachPriceListener };
