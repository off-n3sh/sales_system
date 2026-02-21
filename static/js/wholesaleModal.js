import { fetchStockData, updateSubtotal, updateChange, showModalError, addManualItem, attachPriceListener } from './utils.js';

const wholesaleModal = document.getElementById('wholesale-modal');
const closeWholesale = document.getElementById('close-wholesale-modal');
const wholesaleContainer = document.getElementById('wholesale-items-container');
const wholesaleAmountPaid = document.getElementById('wholesale-amount-paid');
let currentContainer = wholesaleContainer;
let preloadedStockData = null;

// PAYMENT ELEMENTS
// PAYMENT ELEMENTS — UNIQUE TO WHOLESALE
const paymentToggle = document.getElementById('wholesale-payment-toggle');
const singlePaymentMode = document.getElementById('wholesale-single-payment-mode');
const dualPaymentMode = document.getElementById('wholesale-dual-payment-mode');
const cashAmountInput = document.getElementById('wholesale-cash-amount');
const mpesaAmountInput = document.getElementById('wholesale-mpesa-amount');
const dualTotalSpan = document.getElementById('wholesale-dual-total');
const dualChangeSpan = document.getElementById('wholesale-dual-change');

console.log('[WHOLESALE] Payment elements:', { paymentToggle, singlePaymentMode, dualPaymentMode });

async function openWholesaleModal() {
    if (!wholesaleModal) return console.error('Wholesale modal not found');

    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    resetModal(wholesaleContainer);
    wholesaleModal.classList.remove('hidden');
    currentContainer = wholesaleContainer;

    try {
        if (!preloadedStockData) preloadedStockData = await fetchStockData(false);
    } catch (err) {
        showModalError('wholesale', 'Failed to load stock.');
    }

    // RESET TOGGLE
    if (paymentToggle) {
        paymentToggle.checked = false;
        console.log('[WHOLESALE] Toggle reset to SINGLE');
    }
    singlePaymentMode.classList.remove('hidden');
    dualPaymentMode.classList.add('hidden');

    attachAddItemListeners(wholesaleContainer);
    wholesaleModal.dispatchEvent(new Event('modal:open'));
}

function resetModal(container) {
    const header = container.querySelector('.item-row-header');
    const addBtn = container.querySelector('.add-item-btn');
    if (!header || !addBtn) return;

    container.innerHTML = '';
    container.appendChild(header);
    container.appendChild(addBtn);
    updateSubtotal(container);

    const changeSpan = document.getElementById('wholesale-order-change');
    if (changeSpan) changeSpan.textContent = '0.00';

    // Reset inputs
    if (wholesaleAmountPaid) wholesaleAmountPaid.value = '';
    if (cashAmountInput) cashAmountInput.value = '';
    if (mpesaAmountInput) mpesaAmountInput.value = '';
    if (dualTotalSpan) dualTotalSpan.textContent = '0.00';
    if (dualChangeSpan) dualChangeSpan.textContent = '0.00';
}

function attachAddItemListeners(container) {
    container.removeEventListener('click', handleAddItemClick);
    container.addEventListener('click', handleAddItemClick);
}

function handleAddItemClick(e) {
    if (e.target.classList.contains('add-item-btn')) addItem(wholesaleContainer);
}

async function addItem(container) {
    if (!wholesaleModal || wholesaleModal.classList.contains('hidden')) return;

    const div = document.createElement('div');
    div.className = 'grid grid-cols-6 gap-2 item-row';
    div.innerHTML = `
        <select name="items[]" class="col-span-1 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 product-select w-full">
            <option value="">Search or select a product</option>
        </select>
        <input name="quantities[]" type="number" placeholder="Qty" class="p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 qty-input text-center w-full" min="0" step="0.01" disabled>
        <input name="unit_prices[]" type="number" class="price-display p-2 border rounded-lg text-center w-full" ${window.userRole === 'manager' ? '' : 'readonly'} step="0.01" min="0">
        <input type="number" class="stock-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly>
        <input type="number" class="total-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly>
        <button type="button" class="remove-item bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">X</button>
    `;

    const addBtn = container.querySelector('.add-item-btn');
    container.insertBefore(div, addBtn);

    const select = div.querySelector('.product-select');
    const choices = new Choices(select, { searchEnabled: true, itemSelectText: '', placeholderValue: 'Search...' });

    let stockItems = preloadedStockData || await fetchStockData(false);
    preloadedStockData = stockItems;

    if (!stockItems.length) return showModalError('wholesale', 'No stock items.');

    choices.setChoices(stockItems.map(item => ({
        value: `product|${item.stock_name}|quantity|0|price|${item.wholesale}|stock|${item.stock_quantity}|uom|${item.uom}`,
        label: `${item.stock_name} (${item.uom})`
    })), 'value', 'label', true);

    div.querySelector('.remove-item').addEventListener('click', () => {
        div.remove();
        updateSubtotal(container);
    });

    attachPriceListener(div, wholesaleModal);
    updateSubtotal(container);
}

// DUAL PAYMENT UPDATE
function updateDualPaymentTotals() {
    const cash = parseFloat(cashAmountInput?.value) || 0;
    const mpesa = parseFloat(mpesaAmountInput?.value) || 0;
    const total = cash + mpesa;
    const subtotal = parseFloat(document.getElementById('wholesale-order-total')?.textContent) || 0;
    const change = Math.max(0, total - subtotal);

    console.log('[WHOLESALE] Dual update:', { cash, mpesa, total, subtotal, change });

    if (dualTotalSpan) dualTotalSpan.textContent = total.toFixed(2);
    if (dualChangeSpan) dualChangeSpan.textContent = change.toFixed(2);
}

// TOGGLE HANDLER — RETAIL-STYLE
if (paymentToggle && singlePaymentMode && dualPaymentMode) {
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
            if (cashAmountInput) cashAmountInput.value = '';
            if (mpesaAmountInput) mpesaAmountInput.value = '';
            if (dualTotalSpan) dualTotalSpan.textContent = '0.00';
            if (dualChangeSpan) dualChangeSpan.textContent = '0.00';
        }

        const paymentType = document.getElementById('wholesale-payment-type');
        if (paymentType) paymentType.toggleAttribute('required', !paymentToggle.checked);
    };

    paymentToggle.addEventListener('change', toggleHandler);
    console.log('[WHOLESALE] Toggle listener attached');
}

// INPUT LISTENERS
if (cashAmountInput) cashAmountInput.addEventListener('input', updateDualPaymentTotals);
if (mpesaAmountInput) mpesaAmountInput.addEventListener('input', updateDualPaymentTotals);
if (wholesaleAmountPaid) wholesaleAmountPaid.addEventListener('input', () => updateChange(wholesaleContainer));

// CLOSE
if (closeWholesale) {
    closeWholesale.addEventListener('click', () => {
        resetModal(wholesaleContainer);
        wholesaleModal.classList.add('hidden');
    });
}

// MANUAL ITEM
const addManualBtn = document.getElementById('add-wholesale-manual');
if (addManualBtn) addManualBtn.addEventListener('click', () => addManualItem(wholesaleContainer, wholesaleModal));

// FORM SUBMIT
const wholesaleForm = document.getElementById('wholesale-form');
if (wholesaleForm) {
    wholesaleForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (wholesaleModal.classList.contains('hidden')) return;

        const submitBtn = this.querySelector('.submit-btn');
        submitBtn.classList.add('processing');
        submitBtn.disabled = true;

        // Validate dual
        if (paymentToggle.checked) {
            const cash = parseFloat(cashAmountInput.value) || 0;
            const mpesa = parseFloat(mpesaAmountInput.value) || 0;
            if (cash <= 0 && mpesa <= 0) {
                showModalError('wholesale', 'Both payment amounts cannot be zero.');
                submitBtn.classList.remove('processing');
                submitBtn.disabled = false;
                return;
            }
        }

        updateChange(wholesaleContainer);

        const formData = new FormData(this);
        const items = [];
        const rows = wholesaleContainer.querySelectorAll('.item-row');

        rows.forEach(row => {
            const select = row.querySelector('.product-select');
            const qty = row.querySelector('.qty-input');
            const price = row.querySelector('.price-display');
            const manual = row.querySelector('.product-input');

            if (select?.value && qty?.value && price?.value) {
                let v = select.value.split('|');
                v[5] = (parseFloat(price.value) || parseFloat(v[5])).toFixed(2);
                items.push(v.join('|'), qty.value);
            } else if (manual?.value && qty?.value && price?.value) {
                items.push(`product|${manual.value}|quantity|0|price|${parseFloat(price.value).toFixed(2)}|stock|0|uom|Unit`, qty.value);
            }
        });

        if (!items.length) {
            showModalError('wholesale', 'Add at least one item.');
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
            return;
        }

        if (paymentToggle.checked) {
            const cash = parseFloat(cashAmountInput.value) || 0;
            const mpesa = parseFloat(mpesaAmountInput.value) || 0;
            formData.delete('payment_type'); formData.delete('amount_paid');
            formData.set('payment_type_dual', 'true');
            formData.set('cash_amount', cash.toFixed(2));
            formData.set('mpesa_amount', mpesa.toFixed(2));
            formData.set('total_amount_paid', (cash + mpesa).toFixed(2));
            formData.set('change', dualChangeSpan.textContent);
        } else {
            formData.set('change', document.getElementById('wholesale-order-change').textContent);
        }

        formData.delete('items[]');
        items.forEach(i => formData.append('items[]', i));

        try {
            const res = await fetch(this.action, {
                method: 'POST',
                body: formData,
                headers: { 'X-CSRFToken': formData.get('csrf_token') },
                signal: AbortSignal.timeout(5000)
            });
            const text = await res.text();
            const data = JSON.parse(text);

            if (res.ok) {
                wholesaleModal.classList.add('hidden');
                preloadedStockData = null;
                window.location.reload();
            } else {
                showModalError('wholesale', data.error || text);
            }
        } catch (err) {
            showModalError('wholesale', 'Submission failed.');
        } finally {
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
        }
    });
}

export { openWholesaleModal, addItem, resetModal };