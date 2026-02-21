// static/js/dashboard.js
document.addEventListener('DOMContentLoaded', function() {
    const notificationBell = document.getElementById('notification-bell');
    const notificationModal = document.getElementById('notification-modal');
    const closeNotificationModal = document.getElementById('close-notification-modal');
    const notificationContent = document.getElementById('notification-content');
    const paymentModal = document.getElementById('payment-modal');
    const closePaymentModal = document.getElementById('close-payment-modal');
    const paymentForm = document.getElementById('payment-form');
    const paymentOrderId = document.getElementById('payment-order-id');
    const paymentAmount = document.getElementById('payment-amount');
    const remainingBalance = document.getElementById('remaining-balance');
    const searchInput = document.getElementById('search-input');

    // Update time every second
    function updateTime() {
        const now = new Date();
        document.getElementById('time-display').textContent = now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' });
    }
    setInterval(updateTime, 1000);
    updateTime();

    // Notification Modal

    // Search with debounce
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function() {
            const form = searchInput.closest('form');
            form.submit();
        }, 300));
    }

    // Payment Modal
   

    // Menu Toggle
    document.addEventListener('click', function(e) {
        if (!e.target.closest('button[onclick^="toggleMenu"]')) {
            document.querySelectorAll('[id^="menu-"]').forEach(menu => menu.classList.add('hidden'));
        }
    });
});

// Utility Functions
function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    const allMenus = document.querySelectorAll('[id^="menu-"]');
    allMenus.forEach(m => {
        if (m.id !== menuId) m.classList.add('hidden');
    });
    menu.classList.toggle('hidden');
}

function showPaymentForm(orderId, balance) {
    document.getElementById('payment-order-id').value = orderId;
    document.getElementById('payment-amount').value = '';
    document.getElementById('remaining-balance').textContent = `Remaining Balance: KSh ${balance}`;
    document.getElementById('payment-modal').classList.remove('hidden');
}

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}