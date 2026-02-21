// static/js/manualItemModal.js

import { updateSubtotal, showModalError } from './utils.js';

const manualModal = document.getElementById('manual-item-modal');
const closeManual = document.getElementById('close-manual-modal');
const addManualToOrder = document.getElementById('add-manual-to-order');
const manualQty = document.getElementById('manual-item-qty');
const manualPrice = document.getElementById('manual-item-price');
const manualTotal = document.getElementById('manual-total');

let currentContainer;

function openManualModal(containerId) {
    document.querySelectorAll('.modal').forEach(modal => modal.classList.add('hidden'));
    manualModal.classList.remove('hidden');
    currentContainer = document.getElementById(`${containerId}-items-container`);
    document.getElementById('manual-item-form').reset();
    manualTotal.textContent = 'Total: 0.00';
}

addManualToOrder.addEventListener('click', () => {
    const name = document.getElementById('manual-item-name').value.trim();
    const qty = parseFloat(manualQty.value) || 0;
    const price = parseFloat(manualPrice.value) || 0;
    if (!name) {
        showModalError('manual-item', 'Item name is required.');
        return;
    }
    if (qty <= 0) {
        showModalError('manual-item', 'Quantity must be greater than 0.');
        return;
    }
    if (price <= 0) {
        showModalError('manual-item', 'Price must be greater than 0.');
        return;
    }
    const div = document.createElement('div');
    div.className = 'grid grid-cols-6 gap-2 item-row';
    div.innerHTML = `
        <input name="items[]" type="hidden" value="product|${name}|quantity|0|price|${price}|stock|0|uom|Unit">
        <span class="col-span-1 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center">${name}</span>
        <input name="items[]" type="number" value="${qty}" class="p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 qty-input text-center w-full" min="0" step="0.01">
        <input type="number" value="${price}" class="price-display p-2 border rounded-lg text-center w-full" readonly>
        <input type="number" value="0" class="stock-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly>
        <input type="number" value="${price * qty}" class="total-display p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center w-full" readonly>
        <button type="button" class="remove-item bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">X</button>
    `;
    const addBtn = currentContainer.querySelector('.add-item-btn');
    currentContainer.insertBefore(div, addBtn);
    div.querySelector('.remove-item').addEventListener('click', () => {
        div.remove();
        updateSubtotal(currentContainer);
    });
    div.querySelector('.qty-input').addEventListener('input', () => updatePriceAndTotal(div));
    manualModal.classList.add('hidden');
    document.getElementById('manual-item-form').reset();
    manualTotal.textContent = 'Total: 0.00';
    updateSubtotal(currentContainer);
});

function updatePriceAndTotal(row) {
    const qtyInput = row.querySelector('.qty-input');
    const priceDisplay = row.querySelector('.price-display');
    const totalDisplay = row.querySelector('.total-display');
    const basePrice = parseFloat(row.querySelector('input[type="hidden"]')?.value.split('|')[5]) || parseFloat(priceDisplay.value) || 0;
    const qty = parseFloat(qtyInput.value) || 0;
    totalDisplay.value = (basePrice * qty).toFixed(2);
    updateSubtotal(row.closest('.space-y-4'));
}

closeManual.addEventListener('click', () => {
    manualModal.classList.add('hidden');
    document.getElementById('manual-item-form').reset();
    manualTotal.textContent = 'Total: 0.00';
});

manualQty.addEventListener('input', updateManualTotal);
manualPrice.addEventListener('input', updateManualTotal);

function updateManualTotal() {
    const qty = parseFloat(manualQty.value) || 0;
    const price = parseFloat(manualPrice.value) || 0;
    manualTotal.textContent = `Total: ${(qty * price).toFixed(2)}`;
}

export { openManualModal, updatePriceAndTotal };
