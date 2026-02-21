import { openRetailModal } from './retailModal.js';
import { openWholesaleModal } from './wholesaleModal.js';
import { openExpenseModal } from './expenseModal.js';
import { editOrder } from './editOrderModal.js';
import { returnStock } from './returnStockModal.js';
import { markPaid } from './markPaidModal.js';
import { populateClients, addManualItem } from './utils.js';

const openWholesaleBtn = document.getElementById('open-wholesale-modal');
if (openWholesaleBtn) {
    openWholesaleBtn.addEventListener('click', openWholesaleModal);
} else {
    console.error('Open wholesale modal button not found');
}

document.getElementById('open-retail-modal')?.addEventListener('click', openRetailModal);
document.getElementById('open-expense-modal')?.addEventListener('click', openExpenseModal);
const addWholesaleManualBtn = document.getElementById('add-wholesale-manual');
if (addWholesaleManualBtn) {
    addWholesaleManualBtn.addEventListener('click', () => addManualItem(
        document.getElementById('wholesale-items-container'),
        document.getElementById('wholesale-modal')
    ));
} else {
    console.error('Add wholesale manual button not found');
}

populateClients(document.getElementById('retail-client-input'), document.getElementById('retail-client-debt'));
populateClients(document.getElementById('wholesale-client-input'), document.getElementById('wholesale-client-debt'));

function attachActionButtonListeners() {
    document.querySelectorAll('.order-actions-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = newBtn.nextElementSibling;
            const isOpen = !menu.classList.contains('hidden');

            document.querySelectorAll('.order-actions-menu').forEach(m => {
                if (m !== menu) m.classList.add('hidden');
            });

            menu.classList.toggle('hidden');

            const menuRect = menu.getBoundingClientRect();
            const tableRect = document.getElementById('orders-table').getBoundingClientRect();
            if (menuRect.bottom > tableRect.bottom) {
                menu.style.top = 'auto';
                menu.style.bottom = '40px';
            } else {
                menu.style.top = '12px';
                menu.style.bottom = 'auto';
            }
            if (menuRect.right > tableRect.right) {
                menu.style.right = '0';
                menu.style.left = 'auto';
            } else {
                menu.style.right = '6px';
                menu.style.left = 'auto';
            }
        });
    });

    document.querySelectorAll('.mark-paid-btn').forEach(btn => {
        btn.removeEventListener('click', handleMarkPaid);
        btn.addEventListener('click', handleMarkPaid);
    });

    function handleMarkPaid(e) {
        e.stopPropagation();
        const receiptId = e.target.getAttribute('data-receipt-id');
        const balance = parseFloat(e.target.getAttribute('data-balance'));
        console.log('Mark Paid clicked:', { receiptId, balance });
        markPaid(receiptId, balance);
    }

    document.querySelectorAll('.return-stock-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const receiptId = btn.getAttribute('data-receipt-id');
            const itemsJson = btn.getAttribute('data-items');
            returnStock(receiptId, itemsJson);
        });
    });

    document.querySelectorAll('.edit-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const orderRow = btn.closest('.order-row');
            const receiptId = orderRow.getAttribute('data-receipt-id');
            const orderType = orderRow.getAttribute('data-order-type');
            const shopName = orderRow.querySelector('td:nth-child(2)').textContent.split('\n')[0].trim();
            const itemsJson = btn.getAttribute('data-items');
            editOrder(receiptId, orderType, shopName, itemsJson);
        });
    });

    document.querySelectorAll('.delete-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const receiptId = btn.getAttribute('data-receipt-id');
            deleteOrder(receiptId);
        });
    });
}

function deleteOrder(receiptId) {
    if (!confirm(`Are you sure you want to delete order #${receiptId}?`)) return;

    // We removed the CSRF token check here
    fetch(`/delete_order/${receiptId}`, {
        method: 'POST'
        // Headers removed for now
    })
    .then(response => {
        if (response.ok) {
            alert('Order deleted successfully.');
            window.location.reload(); // Hard refresh to show changes
        } else {
            alert('Error deleting order. Check console.');
        }
    })
    .catch(error => {
        console.error('Delete failed:', error);
    });
}

const ordersPerPage = 10;
let currentPage = 1;
const ordersTbody = document.getElementById('orders-tbody');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const orderSearch = document.getElementById('order-search');
let currentFilter = 'all';
const allRows = Array.from(document.querySelectorAll('.order-row'));

function updateOrdersDisplay() {
    const searchTerm = orderSearch.value.toLowerCase();
    let filteredRows = allRows.filter(row => {
        const balance = parseFloat(row.getAttribute('data-balance'));
        const searchText = row.getAttribute('data-search').toLowerCase();
        const matchesFilter = currentFilter === 'all' ||
                             (currentFilter === 'pending' && balance > 0) ||
                             (currentFilter === 'paid' && balance === 0);
        const matchesSearch = searchTerm === '' || searchText.includes(searchTerm);
        return matchesFilter && matchesSearch;
    });

    filteredRows.sort((a, b) => new Date(b.getAttribute('data-date')) - new Date(a.getAttribute('data-date')));
    const totalPages = Math.ceil(filteredRows.length / ordersPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * ordersPerPage;
    const end = start + ordersPerPage;
    const visibleRows = filteredRows.slice(start, end);

    ordersTbody.innerHTML = '';
    visibleRows.forEach(row => ordersTbody.appendChild(row.cloneNode(true)));
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages || filteredRows.length === 0;
    attachActionButtonListeners();
}

prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        updateOrdersDisplay();
    }
});

nextPageBtn.addEventListener('click', () => {
    const filteredRows = allRows.filter(row => {
        const balance = parseFloat(row.getAttribute('data-balance'));
        const searchText = row.getAttribute('data-search').toLowerCase();
        const matchesFilter = currentFilter === 'all' ||
                             (currentFilter === 'pending' && balance > 0) ||
                             (currentFilter === 'paid' && balance === 0);
        return matchesFilter && (orderSearch.value.toLowerCase() === '' || searchText.includes(orderSearch.value.toLowerCase()));
    });
    const totalPages = Math.ceil(filteredRows.length / ordersPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        updateOrdersDisplay();
    }
});

orderSearch.addEventListener('input', () => {
    currentPage = 1;
    updateOrdersDisplay();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.remove('bg-blue-500', 'text-white');
            b.classList.add('text-gray-600', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-700');
        });
        btn.classList.remove('text-gray-600', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-700');
        btn.classList.add('bg-blue-500', 'text-white');
        currentFilter = btn.getAttribute('data-filter');
        currentPage = 1;
        updateOrdersDisplay();
    });
});

document.querySelector('[data-filter="all"]').click();

document.addEventListener('click', (e) => {
    if (!e.target.closest('.order-actions-btn') && !e.target.closest('.order-actions-menu')) {
        document.querySelectorAll('.order-actions-menu').forEach(menu => {
            menu.classList.add('hidden');
        });
    }
});

attachActionButtonListeners();
