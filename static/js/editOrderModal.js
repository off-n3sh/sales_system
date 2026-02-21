import { showModalError, fetchStockData } from './utils.js';

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let editState = {
    receiptId: null,
    originalItems: [],      // Original 5+ items
    itemsToKeep: [],        // Items user wants to keep
    itemsRemoved: [],       // Items user removed (max 2)
    newItems: [],           // Items user added (unlimited)
    amountPaid: 0,          // Fixed amount already paid
    orderType: 'wholesale',
    shopName: '',
    orderDate: null,
    ageHours: 0
};

const editModal = document.getElementById('edit-order-modal');
const closeEdit = document.getElementById('close-edit-modal');
let isEditOrderRunning = false;

// ============================================================================
// ELIGIBILITY CHECK
// ============================================================================

async function checkEligibility(receiptId) {
    console.log(`[EDIT] Checking eligibility for: ${receiptId}`);
    
    try {
        const response = await fetch(`/api/orders/${receiptId}/can-edit`);
        const result = await response.json();
        
        if (!result.can_edit) {
            console.warn(`[EDIT] Cannot edit: ${result.reason}`);
            showModalError('edit-order', result.reason);
            return null;
        }
        
        console.log('[EDIT] Order is eligible for editing:', result.order);
        return result.order;
    } catch (error) {
        console.error('[EDIT] Eligibility check error:', error);
        showModalError('edit-order', `Failed to check eligibility: ${error.message}`);
        return null;
    }
}

// ============================================================================
// MODAL RENDERING
// ============================================================================

function renderOriginalItems(items, stockItems) {
    const container = document.getElementById('original-items-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    items.forEach((item, index) => {
        const stock = stockItems.find(s => s.stock_name === item.product)?.stock_quantity || 0;
        const isRemoved = editState.itemsRemoved.some(r => r.product === item.product);
        
        const div = document.createElement('div');
        div.className = `item-row grid grid-cols-7 gap-2 p-3 rounded-lg border ${isRemoved ? 'bg-red-50 border-red-300' : 'bg-white border-gray-300'}`;
        div.dataset.itemIndex = index;
        
        div.innerHTML = `
            <div class="col-span-2">
                <input type="text" value="${item.product}" readonly 
                    class="w-full p-2 border rounded bg-gray-100 text-gray-700" />
            </div>
            <div>
                <input type="number" value="${item.quantity}" readonly 
                    class="w-full p-2 border rounded bg-gray-100 text-center" />
            </div>
            <div>
                <input type="number" value="${item.price}" readonly 
                    class="w-full p-2 border rounded bg-gray-100 text-center" />
            </div>
            <div>
                <input type="number" value="${stock}" readonly 
                    class="w-full p-2 border rounded bg-gray-100 text-center" />
            </div>
            <div>
                <input type="number" value="${item.total.toFixed(2)}" readonly 
                    class="w-full p-2 border rounded bg-gray-100 text-center font-semibold" />
            </div>
            <div class="flex justify-center">
                <button type="button" 
                    class="remove-item-btn px-3 py-2 rounded text-white font-semibold ${isRemoved ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}"
                    data-item-index="${index}">
                    ${isRemoved ? 'Undo' : 'Remove'}
                </button>
            </div>
        `;
        
        container.appendChild(div);
    });
    
    // Attach event listeners
    container.querySelectorAll('.remove-item-btn').forEach(btn => {
        btn.addEventListener('click', toggleItemRemoval);
    });
    
    updateRemovalCount();
}

function renderNewItems(stockItems) {
    const container = document.getElementById('new-items-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    editState.newItems.forEach((item, index) => {
        const div = createNewItemRow(item, index, stockItems);
        container.appendChild(div);
    });
}

function createNewItemRow(item, index, stockItems) {
    const div = document.createElement('div');
    div.className = 'item-row grid grid-cols-7 gap-2 p-3 rounded-lg border bg-green-50 border-green-300';
    div.dataset.newItemIndex = index;
    
    // Create stock options
    const stockOptions = stockItems.map(stock => 
        `<option value="${stock.stock_name}|${stock.retail_price}|${stock.wholesale_price}|${stock.stock_quantity}" 
            ${item.product === stock.stock_name ? 'selected' : ''}>
            ${stock.stock_name}
        </option>`
    ).join('');
    
    const stock = stockItems.find(s => s.stock_name === item.product)?.stock_quantity || 0;
    
    div.innerHTML = `
        <div class="col-span-2">
            <select class="product-select w-full p-2 border rounded" data-new-index="${index}">
                <option value="">Select Item</option>
                ${stockOptions}
            </select>
        </div>
        <div>
            <input type="number" class="qty-input w-full p-2 border rounded text-center" 
                value="${item.quantity}" min="1" data-new-index="${index}" />
        </div>
        <div>
            <input type="number" class="price-input w-full p-2 border rounded text-center" 
                value="${item.price}" step="0.01" data-new-index="${index}" />
        </div>
        <div>
            <input type="number" value="${stock}" readonly 
                class="stock-display w-full p-2 border rounded bg-gray-100 text-center" />
        </div>
        <div>
            <input type="number" value="${item.total.toFixed(2)}" readonly 
                class="total-display w-full p-2 border rounded bg-gray-100 text-center font-semibold" />
        </div>
        <div class="flex justify-center">
            <button type="button" class="delete-new-item-btn px-3 py-2 rounded bg-red-500 hover:bg-red-600 text-white font-semibold"
                data-new-index="${index}">
                Delete
            </button>
        </div>
    `;
    
    // Attach listeners
    div.querySelector('.product-select').addEventListener('change', (e) => updateNewItem(index, 'product', e));
    div.querySelector('.qty-input').addEventListener('input', (e) => updateNewItem(index, 'quantity', e));
    div.querySelector('.price-input').addEventListener('input', (e) => updateNewItem(index, 'price', e));
    div.querySelector('.delete-new-item-btn').addEventListener('click', () => deleteNewItem(index));
    
    return div;
}

// ============================================================================
// ITEM MANAGEMENT
// ============================================================================

function toggleItemRemoval(event) {
    const index = parseInt(event.target.dataset.itemIndex);
    const item = editState.originalItems[index];
    
    // Check if already removed
    const removedIndex = editState.itemsRemoved.findIndex(r => r.product === item.product);
    
    if (removedIndex >= 0) {
        // UNDO removal
        editState.itemsRemoved.splice(removedIndex, 1);
        editState.itemsToKeep.push(item);
        console.log(`[EDIT] Restored item: ${item.product}`);
    } else {
        // Try to REMOVE
        if (editState.itemsRemoved.length >= 2) {
            showModalError('edit-order', 'Cannot remove more than 2 items. Maximum removal limit reached.');
            return;
        }
        
        if (editState.itemsToKeep.length <= 3) {
            showModalError('edit-order', 'Must keep at least 3 original items. Cannot remove more.');
            return;
        }
        
        editState.itemsRemoved.push(item);
        editState.itemsToKeep = editState.itemsToKeep.filter(k => k.product !== item.product);
        console.log(`[EDIT] Removed item: ${item.product}`);
    }
    
    renderOriginalItems(editState.originalItems, window.cachedStockItems);
    updateBalanceSummary();
}

function addNewItem() {
    const newItem = {
        product: '',
        quantity: 1,
        price: 0,
        total: 0
    };
    
    editState.newItems.push(newItem);
    renderNewItems(window.cachedStockItems);
    console.log('[EDIT] Added new item slot');
}

function updateNewItem(index, field, event) {
    const item = editState.newItems[index];
    
    if (field === 'product') {
        const value = event.target.value;
        if (!value) return;
        
        const [name, retailPrice, wholesalePrice, stock] = value.split('|');
        item.product = name;
        item.price = editState.orderType === 'retail' ? parseFloat(retailPrice) : parseFloat(wholesalePrice);
        
        // Update price input
        const row = event.target.closest('.item-row');
        row.querySelector('.price-input').value = item.price;
        row.querySelector('.stock-display').value = stock;
        
    } else if (field === 'quantity') {
        item.quantity = parseFloat(event.target.value) || 0;
    } else if (field === 'price') {
        item.price = parseFloat(event.target.value) || 0;
    }
    
    item.total = item.quantity * item.price;
    
    // Update total display
    const row = event.target.closest('.item-row');
    row.querySelector('.total-display').value = item.total.toFixed(2);
    
    updateBalanceSummary();
}

function deleteNewItem(index) {
    editState.newItems.splice(index, 1);
    renderNewItems(window.cachedStockItems);
    updateBalanceSummary();
    console.log(`[EDIT] Deleted new item at index ${index}`);
}

// ============================================================================
// BALANCE CALCULATIONS
// ============================================================================

function updateBalanceSummary() {
    // Calculate totals
    const keptTotal = editState.itemsToKeep.reduce((sum, item) => sum + item.total, 0);
    const newTotal = editState.newItems.reduce((sum, item) => sum + item.total, 0);
    const grandTotal = keptTotal + newTotal;
    const newBalance = grandTotal - editState.amountPaid;
    
    // Update displays
    document.getElementById('original-total').textContent = editState.originalItems.reduce((sum, item) => sum + item.total, 0).toFixed(2);
    document.getElementById('original-items-count').textContent = editState.originalItems.length;
    document.getElementById('amount-paid').textContent = editState.amountPaid.toFixed(2);
    document.getElementById('original-balance').textContent = (editState.originalItems.reduce((sum, item) => sum + item.total, 0) - editState.amountPaid).toFixed(2);
    
    document.getElementById('new-total').textContent = grandTotal.toFixed(2);
    document.getElementById('paid-amount').textContent = editState.amountPaid.toFixed(2);
    document.getElementById('new-balance').textContent = newBalance.toFixed(2);
    
    // Color code balance
    const balanceSpan = document.getElementById('new-balance');
    if (newBalance < 0) {
        balanceSpan.classList.add('text-green-600');
        balanceSpan.classList.remove('text-red-600');
    } else if (newBalance > 0) {
        balanceSpan.classList.add('text-red-600');
        balanceSpan.classList.remove('text-green-600');
    } else {
        balanceSpan.classList.remove('text-red-600', 'text-green-600');
    }
    
    console.log(`[EDIT] Balance update: Total=${grandTotal}, Paid=${editState.amountPaid}, Balance=${newBalance}`);
}

function updateRemovalCount() {
    const countSpan = document.getElementById('removed-count');
    if (countSpan) {
        countSpan.textContent = editState.itemsRemoved.length;
        
        // Color code
        if (editState.itemsRemoved.length >= 2) {
            countSpan.classList.add('text-red-600', 'font-bold');
        } else {
            countSpan.classList.remove('text-red-600', 'font-bold');
        }
    }
}

// ============================================================================
// MODAL OPEN/CLOSE
// ============================================================================

async function editOrder(receiptId) {
    if (isEditOrderRunning) {
        console.log('[EDIT] Already running, skipping...');
        return;
    }
    isEditOrderRunning = true;
    console.log(`[EDIT] Opening edit modal for: ${receiptId}`);
    
    try {
        // Check eligibility
        const orderData = await checkEligibility(receiptId);
        if (!orderData) {
            isEditOrderRunning = false;
            return;
        }
        
        // Load stock data
        const stockItems = await fetchStockData();
        window.cachedStockItems = stockItems;
        
        // Initialize state
        editState = {
            receiptId: orderData.receipt_id,
            originalItems: orderData.items,
            itemsToKeep: [...orderData.items],  // Start with all items kept
            itemsRemoved: [],
            newItems: [],
            amountPaid: orderData.payment,
            orderType: orderData.order_type,
            shopName: orderData.shop_name,
            orderDate: orderData.order_date,
            ageHours: orderData.age_hours
        };
        
        // Show modal
        document.querySelectorAll('.modal').forEach(modal => modal.classList.add('hidden'));
        editModal.classList.remove('hidden');
        document.getElementById('edit-receipt-id').textContent = receiptId;
        document.getElementById('edit-reason').value = '';
        
        // Render items
        renderOriginalItems(editState.originalItems, stockItems);
        renderNewItems(stockItems);
        updateBalanceSummary();
        
        console.log('[EDIT] Modal opened successfully');
        
    } catch (error) {
        console.error('[EDIT] Error opening modal:', error);
        showModalError('edit-order', `Failed to open edit modal: ${error.message}`);
        isEditOrderRunning = false;
    }
}

function closeEditModal() {
    editModal.classList.add('hidden');
    editState = {
        receiptId: null,
        originalItems: [],
        itemsToKeep: [],
        itemsRemoved: [],
        newItems: [],
        amountPaid: 0,
        orderType: 'wholesale',
        shopName: '',
        orderDate: null,
        ageHours: 0
    };
    isEditOrderRunning = false;
    console.log('[EDIT] Modal closed');
}

// ============================================================================
// FORM SUBMISSION
// ============================================================================

async function submitEditOrder() {
    const reason = document.getElementById('edit-reason')?.value?.trim();
    
    if (!reason) {
        showModalError('edit-order', 'Please provide a reason for this edit.');
        return;
    }
    
    if (editState.itemsToKeep.length === 0 && editState.newItems.length === 0) {
        showModalError('edit-order', 'Cannot save order with no items.');
        return;
    }
    
    const payload = {
        items_to_keep: editState.itemsToKeep,
        items_removed: editState.itemsRemoved,
        new_items: editState.newItems,
        reason: reason,
        edited_by: 'Current User'
    };
    
    console.log('[EDIT] Submitting edit:', payload);
    
    try {
        const response = await fetch(`/api/orders/${editState.receiptId}/edit`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            console.log('[EDIT] Order updated successfully');
            closeEditModal();
            showSuccessMessage(result.message);
            setTimeout(() => window.location.reload(), 2000);
        } else {
            console.error('[EDIT] Update failed:', result.error);
            showModalError('edit-order', result.error || 'Failed to update order');
        }
        
    } catch (error) {
        console.error('[EDIT] Submission error:', error);
        showModalError('edit-order', `An error occurred: ${error.message}`);
    }
}

function showSuccessMessage(message) {
    const div = document.createElement('div');
    div.className = 'fixed top-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg z-50';
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

if (closeEdit) {
    closeEdit.addEventListener('click', closeEditModal);
}

const saveEditBtn = document.getElementById('save-edit');
if (saveEditBtn) {
    saveEditBtn.addEventListener('click', submitEditOrder);
}

const addNewItemBtn = document.getElementById('add-new-item');
if (addNewItemBtn) {
    addNewItemBtn.addEventListener('click', addNewItem);
}

export { editOrder };
