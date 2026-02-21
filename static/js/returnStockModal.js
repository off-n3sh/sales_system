// static/js/returnStockModal.js

import { showModalError } from './utils.js';

const returnModal = document.getElementById('return-stock-modal');
const closeReturn = document.getElementById('close-return-modal');

function returnStock(receiptId, itemsJson) {
    document.querySelectorAll('.modal').forEach(modal => modal.classList.add('hidden'));
    returnModal.classList.remove('hidden');
    document.getElementById('return-order-id').textContent = receiptId;
    const form = document.getElementById('return-stock-form');
    const returnItemsContainer = document.getElementById('return-stock-items-container');
    form.action = `/return_stock/${receiptId}`;

    returnItemsContainer.innerHTML = '';
    let items = typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
    if (Array.isArray(items) && items.length > 0) {
        items.forEach(item => {
            if (item.name && item.quantity > 0) {
                const div = document.createElement('div');
                div.className = 'flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 rounded-lg';
                div.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <input type="checkbox" name="return_item_${item.name}" class="return-item-checkbox h-5 w-5 text-yellow-500 rounded">
                        <span class="text-gray-900 dark:text-white">${item.name} (Ordered: ${item.quantity})</span>
                    </div>
                    <input type="number" name="return_qty_${item.name}" placeholder="Qty to Return" class="return-qty-input p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 w-24 text-center hidden" min="0" max="${item.quantity}" value="0">
                `;
                returnItemsContainer.appendChild(div);

                const checkbox = div.querySelector('.return-item-checkbox');
                const qtyInput = div.querySelector('.return-qty-input');
                checkbox.addEventListener('change', () => {
                    qtyInput.classList.toggle('hidden', !checkbox.checked);
                    if (!checkbox.checked) qtyInput.value = 0;
                });
            }
        });
    } else {
        returnItemsContainer.innerHTML = '<p class="text-gray-700 dark:text-gray-300">No items available for return.</p>';
    }

    let isSubmitting = false;
    form.onsubmit = function(e) {
        e.preventDefault();
        if (isSubmitting) return;

        const submitBtn = form.querySelector('.submit-btn');
        submitBtn.classList.add('processing');
        submitBtn.disabled = true;
        isSubmitting = true;

        const formData = new FormData(this);
        let hasReturns = false;
        items.forEach(item => {
            const qty = parseInt(formData.get(`return_qty_${item.name}`)) || 0;
            if (qty > 0) {
                hasReturns = true;
                if (qty > item.quantity) {
                    showModalError('return-stock', `Cannot return more than ${item.quantity} units of ${item.name}.`);
                    submitBtn.classList.remove('processing');
                    submitBtn.disabled = false;
                    isSubmitting = false;
                    return;
                }
            }
        });

        if (!hasReturns) {
            showModalError('return-stock', 'Please specify at least one item to return.');
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
            isSubmitting = false;
            return;
        }

        fetch(this.action, {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (response.ok) {
                returnModal.classList.add('hidden');
                alert('Stock returns logged successfully. Please update the stock manually.');
                window.location.href = '/orders';
            } else {
                response.text().then(text => showModalError('return-stock', 'Error logging stock returns: ' + text));
                submitBtn.classList.remove('processing');
                submitBtn.disabled = false;
                isSubmitting = false;
            }
        })
        .catch(error => {
            showModalError('return-stock', 'An error occurred while logging the stock returns: ' + error);
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
            isSubmitting = false;
        });
    };
}

closeReturn.addEventListener('click', () => returnModal.classList.add('hidden'));

export { returnStock };
