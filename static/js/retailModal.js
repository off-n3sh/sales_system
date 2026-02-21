import { fetchStockData, updateSubtotal, updateChange, showModalError, addManualItem, attachPriceListener } from './utils.js';

const retailModal = document.getElementById('retail-modal');
const closeRetail = document.getElementById('close-retail-modal');
const retailContainer = document.getElementById('retail-items-container');
const retailAmountPaid = document.getElementById('retail-amount-paid');
const retailPaymentType = document.getElementById('retail-payment-type');
const paymentToggle = document.getElementById('payment-toggle');
const retailCashAmount = document.getElementById('retail-cash-amount');
const retailMpesaAmount = document.getElementById('retail-mpesa-amount');
const singlePaymentMode = document.getElementById('single-payment-mode');
const dualPaymentMode = document.getElementById('dual-payment-mode');
let currentContainer = retailContainer;
let eventListeners = [];

// Pre-loaded stock data persists across modal opens
let preloadedStockData = null;

async function openRetailModal() {
    if (!retailModal) {
        console.error('Retail modal not found in DOM');
        return;
    }
    console.log('Opening retail modal, userRole:', window.userRole);
    document.querySelectorAll('.modal').forEach(modal => {
        console.log(`Hiding modal: ${modal.id}`);
        modal.classList.add('hidden');
    });
    resetModal(retailContainer);
    retailModal.classList.remove('hidden');
    console.log('Retail modal opened, classes:', retailModal.classList.toString());
    currentContainer = retailContainer;

    console.log('Loading stock data with version check...');
    try {
        if (!preloadedStockData) {
            preloadedStockData = await fetchStockData(false);
            console.log('Stock data loaded:', preloadedStockData.length, 'items');
        } else {
            console.log('Using pre-loaded stock data:', preloadedStockData.length, 'items');
        }
    } catch (error) {
        console.error('Failed to fetch stock data:', error);
        showModalError('retail', 'Failed to load stock data.');
    }

    attachAddItemListeners(retailContainer);
    retailModal.dispatchEvent(new Event('modal:open'));
    console.log('Dispatched modal:open event');
}

function resetModal(container) {
    if (!container) {
        console.error('Container not found for reset');
        return;
    }
    console.log('Resetting modal container:', container.id);
    const header = container.querySelector('.item-row-header');
    const initialAddBtn = container.querySelector('.add-item-btn');
    if (!header || !initialAddBtn) {
        console.error('Header or add button not found in container');
        return;
    }
    container.innerHTML = '';
    container.appendChild(header);
    container.appendChild(initialAddBtn);
    updateSubtotal(container);
    const modalId = container.id.split('-')[0];
    const changeSpan = document.getElementById(`${modalId}-order-change`);
    const debtElement = document.getElementById(`${modalId}-client-debt`);
    if (changeSpan) {
        changeSpan.textContent = '0.00';
        console.log(`Reset change span for ${modalId}`);
    }
    if (debtElement) {
        debtElement.textContent = '';
        debtElement.classList.add('hidden');
        console.log(`Reset debt element for ${modalId}`);
    }
    
    // Reset payment toggle and modes
    if (paymentToggle) {
        paymentToggle.checked = false;
        singlePaymentMode.classList.remove('hidden');
        dualPaymentMode.classList.add('hidden');
    }
    
    // Reset payment types and inputs
    if (retailPaymentType) {
        retailPaymentType.value = 'cash';
        retailAmountPaid.value = '';
        retailAmountPaid.removeAttribute('readonly');
        if (retailCashAmount) retailCashAmount.value = '';
        if (retailMpesaAmount) retailMpesaAmount.value = '';
    }
}

// Function to update dual payment totals and change
function updateDualPaymentTotals() {
    const cashAmount = parseFloat(retailCashAmount.value) || 0;
    const mpesaAmount = parseFloat(retailMpesaAmount.value) || 0;
    const totalPaid = cashAmount + mpesaAmount;
    const orderTotalSpan = document.getElementById('retail-order-total');
    const orderTotal = parseFloat(orderTotalSpan.textContent) || 0;
    const change = Math.max(0, totalPaid - orderTotal);

    const dualTotalSpan = document.getElementById('retail-dual-total');
    const dualChangeSpan = document.getElementById('retail-dual-change');
    
    if (dualTotalSpan) dualTotalSpan.textContent = totalPaid.toFixed(2);
    if (dualChangeSpan) dualChangeSpan.textContent = change.toFixed(2);
}

// Function to validate dual payment inputs
function validateDualPayment() {
    if (!paymentToggle.checked) return true; // Single payment mode, no validation needed
    
    const cashAmount = parseFloat(retailCashAmount.value) || 0;
    const mpesaAmount = parseFloat(retailMpesaAmount.value) || 0;
    
    if (cashAmount <= 0 && mpesaAmount <= 0) {
        showModalError('retail', 'Both payment amounts cannot be zero in dual payment mode.');
        return false;
    }
    
    if (cashAmount < 0 || mpesaAmount < 0) {
        showModalError('retail', 'Payment amounts cannot be negative.');
        return false;
    }
    
    return true;
}

function attachAddItemListeners(container) {
    if (!container) {
        console.error('Container not found for add item listeners');
        return;
    }
    console.log('Attaching add item listeners to container:', container.id);
    container.removeEventListener('click', handleAddItemClick);
    container.addEventListener('click', handleAddItemClick);
    eventListeners.push({ element: container, type: 'click', handler: handleAddItemClick });
}

function handleAddItemClick(event) {
    if (event.target.classList.contains('add-item-btn')) {
        console.log('Add item button clicked');
        addItem(event.target.closest('.space-y-4'));
    }
}

async function addItem(container) {
    if (!container || !retailModal || retailModal.classList.contains('hidden')) {
        console.warn('Skipping addItem: modal is hidden or not found');
        return;
    }
    const isManager = window.userRole === 'manager';
    console.log('Adding item, isManager:', isManager);

    const div = document.createElement('div');
    div.className = 'grid grid-cols-6 gap-2 item-row';
    div.innerHTML = `
        <select name="items[]" class="col-span-1 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 product-select w-full">
            <option value="">Search or select a product</option>
        </select>
        <input name="quantities[]" type="number" placeholder="Qty" class="p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 qty-input text-center w-full" min="0" step="0.01" disabled>
        <input name="unit_prices[]" type="number" class="price-display p-2 border rounded-lg text-center w-full" ${isManager ? '' : 'readonly'} step="0.01" min="0">
        <input type="number" class="stock-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly>
        <input type="number" class="total-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly>
        <button type="button" class="remove-item bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">X</button>
    `;
    const addBtn = container.querySelector('.add-item-btn');
    container.insertBefore(div, addBtn);

    const select = div.querySelector('.product-select');
    const choices = new Choices(select, {
        searchEnabled: true,
        searchChoices: true,
        itemSelectText: '',
        placeholderValue: 'Search or select a product'
    });

    let stockItems = preloadedStockData;
    if (!stockItems) {
        console.log('No pre-loaded data, fetching...');
        try {
            stockItems = await fetchStockData(false);
            preloadedStockData = stockItems;
        } catch (error) {
            console.error('Failed to load stock items:', error);
            showModalError(container.id.split('-')[0], 'Failed to load stock items.');
            return;
        }
    } else {
        console.log('Using pre-loaded stock data');
    }

    if (!stockItems.length) {
        showModalError(container.id.split('-')[0], 'No stock items available.');
        return;
    }

    const choicesData = stockItems.map(item => ({
        value: `product|${item.stock_name}|quantity|0|price|${item.selling_price}|stock|${item.stock_quantity}|uom|${item.uom}`,
        label: `${item.stock_name} (${item.uom})`
    }));
    choices.setChoices(choicesData, 'value', 'label', true);

    const removeHandler = () => {
        console.log('Removing item row');
        div.remove();
        updateSubtotal(container);
    };
    div.querySelector('.remove-item').addEventListener('click', removeHandler);
    eventListeners.push({ element: div.querySelector('.remove-item'), type: 'click', handler: removeHandler });

    attachPriceListener(div, retailModal);
    updateSubtotal(container);
}

function cleanupEventListeners() {
    console.log('Cleaning up event listeners, count:', eventListeners.length);
    eventListeners.forEach(({ element, type, handler }) => {
        if (element) {
            element.removeEventListener(type, handler);
        }
    });
    eventListeners = [];
}

if (closeRetail) {
    const closeHandler = () => {
        console.log('Closing retail modal');
        resetModal(retailContainer);
        retailModal.classList.add('hidden');
        cleanupEventListeners();
    };
    closeRetail.addEventListener('click', closeHandler);
    eventListeners.push({ element: closeRetail, type: 'click', handler: closeHandler });
}

if (retailAmountPaid) {
    const amountPaidHandler = () => {
        if (!retailModal || retailModal.classList.contains('hidden')) {
            console.warn('Skipping amountPaidHandler: modal is hidden');
            return;
        }
        updateChange(retailContainer);
    };
    retailAmountPaid.addEventListener('input', amountPaidHandler);
    eventListeners.push({ element: retailAmountPaid, type: 'input', handler: amountPaidHandler });
}

// Payment toggle handler
if (paymentToggle) {
    const toggleHandler = () => {
        if (paymentToggle.checked) {
            console.log('Switching to dual payment mode');
            singlePaymentMode.classList.add('hidden');
            dualPaymentMode.classList.remove('hidden');
            updateDualPaymentTotals();
        } else {
            console.log('Switching to single payment mode');
            singlePaymentMode.classList.remove('hidden');
            dualPaymentMode.classList.add('hidden');
            // Clear dual payment inputs
            if (retailCashAmount) retailCashAmount.value = '';
            if (retailMpesaAmount) retailMpesaAmount.value = '';
        }
    };
    paymentToggle.addEventListener('change', toggleHandler);
    eventListeners.push({ element: paymentToggle, type: 'change', handler: toggleHandler });
}

// Payment type toggle for amount paid visibility (single mode)
if (retailPaymentType) {
    const paymentTypeHandler = () => {
        const amountPaidInput = document.getElementById('retail-amount-paid');
        if (retailPaymentType.value === 'credit') {
            amountPaidInput.value = '0.00';
            amountPaidInput.setAttribute('readonly', true);
            updateChange(retailContainer);
        } else {
            amountPaidInput.value = '';
            amountPaidInput.removeAttribute('readonly');
        }
    };
    retailPaymentType.addEventListener('change', paymentTypeHandler);
    eventListeners.push({ element: retailPaymentType, type: 'change', handler: paymentTypeHandler });
}

// Dual payment input listeners
if (retailCashAmount) {
    const cashAmountHandler = () => {
        if (!retailModal || retailModal.classList.contains('hidden')) {
            console.warn('Skipping cashAmountHandler: modal is hidden');
            return;
        }
        updateDualPaymentTotals();
    };
    retailCashAmount.addEventListener('input', cashAmountHandler);
    eventListeners.push({ element: retailCashAmount, type: 'input', handler: cashAmountHandler });
}

if (retailMpesaAmount) {
    const mpesaAmountHandler = () => {
        if (!retailModal || retailModal.classList.contains('hidden')) {
            console.warn('Skipping mpesaAmountHandler: modal is hidden');
            return;
        }
        updateDualPaymentTotals();
    };
    retailMpesaAmount.addEventListener('input', mpesaAmountHandler);
    eventListeners.push({ element: retailMpesaAmount, type: 'input', handler: mpesaAmountHandler });
}

const retailForm = document.getElementById('retail-form');
if (retailForm) {
    retailForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!retailModal || retailModal.classList.contains('hidden')) {
            console.warn('Skipping form submission: modal is hidden');
            return;
        }
        
        // Validate dual payment if in dual mode
        if (!validateDualPayment()) {
            return;
        }
        
        console.log('Submitting retail form');
        const submitBtn = this.querySelector('.submit-btn');
        submitBtn.classList.add('processing');
        submitBtn.disabled = true;

        // Call updateChange to ensure change is calculated
        updateChange(retailContainer);

        const formData = new FormData(this);
        const itemRows = retailContainer.querySelectorAll('.item-row');
        const items = [];

        // Handle payment type and amount paid for credit
        const paymentType = formData.get('payment_type');
        const shopName = formData.get('shop_name')?.toLowerCase();
        const restrictedClients = ['client', 'clients', 'walk in', 'walkin'];

        // Prevent submission for restricted clients with credit
        if (paymentType === 'credit' && shopName && restrictedClients.includes(shopName)) {
            showModalError('retail', 'Credit payment is not allowed for walk-in or unspecified clients.');
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
            return;
        }

        // Handle dual payment submission
        if (paymentToggle.checked) {
            const cashAmount = parseFloat(retailCashAmount.value) || 0;
            const mpesaAmount = parseFloat(retailMpesaAmount.value) || 0;
            
            // Remove single payment data
            formData.delete('payment_type');
            formData.delete('amount_paid');
            
            // Add dual payment data
            formData.set('payment_type_dual', 'true');
            formData.set('cash_amount', cashAmount.toFixed(2));
            formData.set('mpesa_amount', mpesaAmount.toFixed(2));
            formData.set('total_amount_paid', (cashAmount + mpesaAmount).toFixed(2));
            
            // Add change from dual payment
            const dualChangeSpan = document.getElementById('retail-dual-change');
            const dualChange = parseFloat(dualChangeSpan.textContent) || 0;
            formData.set('change', dualChange.toFixed(2));
            
            console.log('Dual payment data:', {
                cash: cashAmount,
                mpesa: mpesaAmount,
                total: cashAmount + mpesaAmount,
                change: dualChange
            });
        } else {
            // Single payment - add change from single payment
            const changeSpan = document.getElementById('retail-order-change');
            const change = parseFloat(changeSpan.textContent) || 0;
            formData.set('change', change.toFixed(2));
        }

        itemRows.forEach(row => {
            const select = row.querySelector('.product-select');
            const productInput = row.querySelector('.product-input');
            const qtyInput = row.querySelector('.qty-input');
            const priceInput = row.querySelector('.price-display');

            if (select && select.value && qtyInput.value && priceInput.value) {
                const values = select.value.split('|');
                const price = parseFloat(priceInput.value) || parseFloat(values[5]) || 0;
                if (price <= 0) {
                    console.error('Invalid price for stock item:', values[1]);
                    return;
                }
                values[5] = price.toFixed(2);
                items.push(values.join('|'));
                items.push(qtyInput.value);
            } else if (productInput && productInput.value && qtyInput.value && priceInput.value) {
                const price = parseFloat(priceInput.value) || 0;
                if (price <= 0) {
                    console.error('Invalid price for manual item:', productInput.value);
                    return;
                }
                items.push(`product|${productInput.value}|quantity|0|price|${price.toFixed(2)}|stock|0|uom|Unit`);
                items.push(qtyInput.value);
            } else {
                console.error('Invalid item row:', row);
            }
        });

        if (items.length === 0) {
            showModalError('retail', 'No valid items in order. Please add items with valid quantities and prices.');
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
            return;
        }

        formData.delete('items[]');
        formData.delete('quantities[]');
        formData.delete('unit_prices[]');
        items.forEach(item => formData.append('items[]', item));

        console.log('Form data entries:');
        for (let [key, value] of formData.entries()) {
            console.log(`${key}: ${value}`);
        }

        try {
            const response = await fetch(this.action, {
                method: 'POST',
                body: formData,
                headers: {
                    'X-CSRFToken': formData.get('csrf_token')
                },
                signal: AbortSignal.timeout(5000)
            });
            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (error) {
                console.error('JSON parse error:', text);
                showModalError('retail', 'Invalid server response.');
                submitBtn.classList.remove('processing');
                submitBtn.disabled = false;
                return;
            }
            if (response.ok) {
                console.log('Form submitted successfully, reloading page');
                retailModal.classList.add('hidden');
                cleanupEventListeners();
                preloadedStockData = null;
                window.location.reload();
            } else {
                console.error('Form submission failed:', result.error || text);
                showModalError('retail', `Error submitting retail order: ${result.error || text}`);
                submitBtn.classList.remove('processing');
                submitBtn.disabled = false;
            }
        } catch (error) {
            console.error('Form submission error:', error);
            showModalError('retail', 'An error occurred while submitting the retail order.');
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
        }
    });
}

const addManualBtn = document.getElementById('add-retail-manual');
if (addManualBtn) {
    const manualHandler = () => {
        console.log('Add manual item button clicked');
        addManualItem(retailContainer, retailModal);
    };
    addManualBtn.addEventListener('click', manualHandler);
    eventListeners.push({ element: addManualBtn, type: 'click', handler: manualHandler });
}

export { openRetailModal, addItem, resetModal };
