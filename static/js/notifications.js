// ============================================================================
// NOTIFICATION SYSTEM - COMPLETE VERSION WITH ENHANCEMENTS
// ============================================================================

let notifications = [];
let currentFilter = 'all';
let currentGroupBy = 'date';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatTime(dateString) {
    try {
        const date = new Date(dateString);
        
        // Format: 9-2-2026, 10:00:35 AM
        const day = date.getDate();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        
        let hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        
        hours = hours % 12;
        hours = hours ? hours : 12; // 0 should be 12
        
        return `${day}-${month}-${year}, ${hours}:${minutes}:${seconds} ${ampm}`;
    } catch (error) {
        console.error('Error formatting time:', error, dateString);
        return 'Unknown';
    }
}

function formatDateHeader(dateString) {
    try {
        const date = new Date(dateString);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const notifDate = new Date(date);
        notifDate.setHours(0, 0, 0, 0);
        
        if (notifDate.getTime() === today.getTime()) {
            return 'Today';
        } else if (notifDate.getTime() === yesterday.getTime()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString('en-GB', { 
                day: '2-digit', 
                month: 'short', 
                year: 'numeric' 
            });
        }
    } catch (error) {
        console.error('Error formatting date header:', error, dateString);
        return 'Unknown Date';
    }
}

function getWeekRange(date) {
    try {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        
        return `${monday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} - ${sunday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    } catch (error) {
        console.error('Error getting week range:', error, date);
        return 'Unknown Week';
    }
}

// ============================================================================
// ICON SYSTEM
// ============================================================================

function getIconSVG(icon) {
    const icons = {
        'payment': '<path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>',
        'order': '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>',
        'alert': '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
        'warning': '<path d="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z"/>',
        'stock': '<path d="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z"/>'
    };
    return icons[icon] || icons['order'];
}

function getNotificationTypeLabel(type) {
    const labels = {
        'order': 'Orders Created',
        'payment': 'Payments',
        'stock_expiry': 'Expiring Stock',
        'low_stock': 'Low Stock Alerts',
        'system': 'System Notifications'
    };
    return labels[type] || type.replace('_', ' ').toUpperCase();
}

// ============================================================================
// BADGE UPDATE
// ============================================================================

function updateBadge(count) {
    try {
        const badge = document.getElementById('badgeCount');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error updating badge:', error);
    }
}

// ============================================================================
// NOTIFICATION RENDERING - DYNAMIC
// ============================================================================

function renderNotification(notif, showActions = true) {
    try {
        console.log('Rendering notification:', notif);
        
        if (!notif) {
            console.warn('Null notification');
            return '';
        }
        
        // ADAPT LEGACY FORMAT
        notif = adaptLegacyNotification(notif);
        
        const data = notif.data;
        const clickHandler = data.receipt_id ? `onclick="viewReceipt('${data.receipt_id}')"` : '';
        
        // Build details HTML dynamically
        let detailsHTML = '';
        if (data.details && Array.isArray(data.details)) {
            detailsHTML = data.details.map(detail => {
                const urgentClass = detail.urgent ? 'urgent' : '';
                const badgeClass = detail.badge ? `status-badge ${getStatusClass(detail.value)}` : '';
                
                return `
                    <div class="notification-detail ${urgentClass}">
                        <span class="detail-label">${detail.label}:</span>
                        <span class="detail-value ${badgeClass}">${detail.value}</span>
                    </div>
                `;
            }).join('');
        }
        
        return `
            <div class="notification-item ${notif.unread ? 'unread' : ''}" 
                 data-id="${notif.id}" 
                 data-type="${notif.type}"
                 ${clickHandler}>
                <div class="notification-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        ${getIconSVG(data.icon)}
                    </svg>
                </div>
                <div class="notification-content">
                    <div class="notification-title">${data.title || 'Notification'}</div>
                    ${data.subtitle ? `<div class="notification-subtitle">${data.subtitle}</div>` : ''}
                    ${detailsHTML ? `<div class="notification-details">${detailsHTML}</div>` : ''}
                </div>
                <div class="notification-time">${formatTime(notif.time)}</div>
                ${showActions ? `
                <div class="notification-actions">
                    <button class="btn-small btn-mark-read" onclick="markAsRead('${notif.id}'); event.stopPropagation();">
                        ${notif.unread ? 'Mark as read' : 'Mark as unread'}
                    </button>
                    <button class="btn-small btn-clear" onclick="clearNotification('${notif.id}'); event.stopPropagation();">
                        Clear
                    </button>
                </div>
                ` : ''}
            </div>
        `;
    } catch (error) {
        console.error('Error rendering notification:', error, notif);
        return '';
    }
}

function getStatusClass(status) {
    if (!status) return '';
    const statusLower = status.toString().toLowerCase();
    const classes = {
        'paid': 'status-paid',
        'partial': 'status-partial',
        'partial_payment': 'status-partial',
        'credit': 'status-credit',
        'pending': 'status-pending',
        'alert': 'status-alert'
    };
    return classes[statusLower] || '';
}

// ============================================================================
// API CALLS
// ============================================================================

async function fetchNotifications(filter = 'all', view = 'recent') {
    try {
        console.log(`Fetching notifications: filter=${filter}, view=${view}`);
        
        const response = await fetch(`/api/notifications?filter=${filter}&view=${view}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Notifications fetched:', data);
        
        notifications = data.notifications || [];
        updateBadge(data.unread_count || 0);
        
        return notifications;
    } catch (error) {
        console.error('Error fetching notifications:', error);
        showError('Failed to load notifications. Please refresh the page.');
        return [];
    }
}

async function markAsRead(id) {
    try {
        console.log('Marking as read:', id);
        
        const response = await fetch(`/api/notifications/${id}/mark-read`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        console.log('Marked as read successfully');
        await renderNotifications();
        
        const modal = document.getElementById('historyModal');
        if (modal && modal.classList.contains('active')) {
            await renderHistory(currentFilter);
        }
    } catch (error) {
        console.error('Error marking notification as read:', error);
        showError('Failed to mark notification as read');
    }
}

async function clearNotification(id) {
    try {
        console.log('Clearing notification:', id);
        
        const response = await fetch(`/api/notifications/${id}/clear`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        console.log('Notification cleared successfully');
        await renderNotifications();
        
        const modal = document.getElementById('historyModal');
        if (modal && modal.classList.contains('active')) {
            await renderHistory(currentFilter);
        }
    } catch (error) {
        console.error('Error clearing notification:', error);
        showError('Failed to clear notification');
    }
}

// ============================================================================
// UI RENDERING
// ============================================================================

async function renderNotifications() {
    const list = document.getElementById('notificationsList');
    if (!list) {
        console.error('notificationsList element not found');
        return;
    }
    
    try {
        const notifs = await fetchNotifications('all', 'recent');
        
        if (notifs.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                    </svg>
                    <p>No new notifications</p>
                </div>
            `;
        } else {
            list.innerHTML = notifs.map(n => renderNotification(n, true)).join('');
        }
    } catch (error) {
        console.error('Error rendering notifications:', error);
        list.innerHTML = '<div class="error-state"><p>Error loading notifications</p></div>';
    }
}

function toggleDropdown() {
    try {
        const dropdown = document.getElementById('notificationDropdown');
        if (!dropdown) {
            console.error('notificationDropdown element not found');
            return;
        }
        
        const isActive = dropdown.classList.toggle('active');
        console.log('Dropdown toggled:', isActive);
        
        if (isActive) {
            renderNotifications();
        }
    } catch (error) {
        console.error('Error toggling dropdown:', error);
    }
}

// ============================================================================
// BACKWARD COMPATIBILITY - Converts old notification format to new
// ============================================================================

function adaptLegacyNotification(notif) {
    // If already has data object, return as-is
    if (notif.data) {
        return notif;
    }
    
    console.log('Adapting legacy notification:', notif);
    
    // Convert old structure to new
    let adapted = {
        id: notif.id,
        type: notif.type || 'order',
        time: notif.time,
        unread: notif.unread,
        data: {}
    };
    
    // Handle different types
    if (notif.type === 'payment') {
        adapted.data = {
            title: notif.creator || 'Payment received',
            subtitle: `Receipt #${notif.receiptId || 'N/A'}`,
            details: [
                { label: 'Client/Shop', value: notif.shopName || 'Unknown' },
                { label: 'Amount', value: `KSh ${notif.amount?.toLocaleString() || 0}` },
                { label: 'Status', value: notif.status || 'paid', badge: true }
            ],
            icon: 'payment',
            receipt_id: notif.receiptId
        };
    } else if (notif.type === 'order') {
        adapted.data = {
            title: notif.creator || 'Order created',
            subtitle: `Receipt #${notif.receiptId || 'N/A'}`,
            details: [
                { label: 'Client/Shop', value: notif.shopName || 'Unknown' },
                { label: 'Amount', value: `KSh ${notif.amount}` },  // Keep as-is, backend sends formatted amount
                { label: 'Status', value: notif.status || 'paid', badge: true }
            ],
            icon: 'order',
            receipt_id: notif.receiptId
        };
    } else if (notif.type === 'expiry' || notif.type === 'stock_expiry') {
        adapted.data = {
            title: 'Stock Expiry Alert',
            subtitle: notif.stock_name || notif.message || 'Stock expiring soon',
            details: [
                { label: 'Days remaining', value: notif.days_left || 0, urgent: (notif.days_left || 0) < 7 }
            ],
            icon: 'alert'
        };

    } else if (notif.type === 'order_edit') {
    // Extract edit details
    const editDetails = notif.edit_details || {};
    const changes = editDetails.changes || 'Modified';
    const oldTotal = editDetails.old_total || 0;
    const newTotal = editDetails.new_total || 0;
    const newBalance = editDetails.new_balance || 0;
    
    adapted.data = {
        title: notif.creator || 'Order modified',
        subtitle: `Receipt #${notif.receiptId || 'N/A'}`,
        details: [
            { label: 'Client/Shop', value: notif.shopName || 'Unknown' },
            { label: 'Changes', value: changes },
            { 
                label: 'Total', 
                value: `KSh ${oldTotal.toLocaleString()} → KSh ${newTotal.toLocaleString()}`,
                urgent: Math.abs(newTotal - oldTotal) > 1000  // Highlight big changes
            },
            { label: 'New Balance', value: `KSh ${notif.amount}` },
            { label: 'Status', value: notif.status || 'credit', badge: true }
        ],
        icon: 'order',
        receipt_id: notif.receiptId
    };
    } else {
        // Generic fallback
        adapted.data = {
            title: notif.message || notif.creator || 'Notification',
            subtitle: notif.shopName || '',
            details: [],
            icon: 'order'
        };
    }
    
    return adapted;
}

function showHistory() {
    try {
        const dropdown = document.getElementById('notificationDropdown');
        const modal = document.getElementById('historyModal');
        
        if (dropdown) dropdown.classList.remove('active');
        if (modal) {
            modal.classList.add('active');
            renderHistory('all');
        }
    } catch (error) {
        console.error('Error showing history:', error);
    }
}

function closeHistory() {
    try {
        const modal = document.getElementById('historyModal');
        if (modal) modal.classList.remove('active');
    } catch (error) {
        console.error('Error closing history:', error);
    }
}

async function filterHistory(filter) {
    try {
        currentFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        await renderHistory(filter);
    } catch (error) {
        console.error('Error filtering history:', error);
    }
}

function toggleGroupBy(groupBy) {
    try {
        currentGroupBy = groupBy;
        document.querySelectorAll('.group-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        renderHistory(currentFilter);
    } catch (error) {
        console.error('Error toggling group by:', error);
    }
}

// ============================================================================
// HISTORY RENDERING
// ============================================================================

async function renderHistory(filter) {
    const historyList = document.getElementById('historyList');
    if (!historyList) {
        console.error('historyList element not found');
        return;
    }
    
    try {
        historyList.innerHTML = '<div class="loading">Loading...</div>';
        
        const notifs = await fetchNotifications(filter, 'history');
        console.log(`History loaded: ${notifs.length} notifications`);

        if (notifs.length === 0) {
            historyList.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                    </svg>
                    <p>No notifications found</p>
                </div>
            `;
            return;
        }

        let groupedHTML = '';
        
        if (currentGroupBy === 'type') {
            groupedHTML = renderGroupedByType(notifs);
        } else {
            if (filter === 'today' || filter === 'all') {
                const grouped = groupByDay(notifs);
                groupedHTML = renderGroupedByDay(grouped);
            } else if (filter === 'week') {
                const grouped = groupByWeek(notifs);
                groupedHTML = renderGroupedByWeek(grouped);
            } else {
                groupedHTML = notifs.map(n => renderNotification(n, false)).join('');
            }
        }
        
        historyList.innerHTML = groupedHTML;
    } catch (error) {
        console.error('Error rendering history:', error);
        historyList.innerHTML = '<div class="error-state"><p>Error loading history</p></div>';
    }
}

// ============================================================================
// GROUPING FUNCTIONS
// ============================================================================

function groupByDay(notifs) {
    try {
        const groups = {};
        
        notifs.forEach(notif => {
            const date = new Date(notif.time);
            date.setHours(0, 0, 0, 0);
            const key = date.toISOString();
            
            if (!groups[key]) {
                groups[key] = {
                    date: key,
                    notifications: []
                };
            }
            
            groups[key].notifications.push(notif);
        });
        
        return Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (error) {
        console.error('Error grouping by day:', error);
        return [];
    }
}

function groupByWeek(notifs) {
    try {
        const groups = {};
        
        notifs.forEach(notif => {
            const date = new Date(notif.time);
            const weekKey = getWeekRange(date);
            
            if (!groups[weekKey]) {
                groups[weekKey] = {
                    week: weekKey,
                    notifications: []
                };
            }
            
            groups[weekKey].notifications.push(notif);
        });
        
        return Object.values(groups);
    } catch (error) {
        console.error('Error grouping by week:', error);
        return [];
    }
}

function groupByType(notifs) {
    try {
        const types = {};
        
        notifs.forEach(notif => {
            const type = notif.type || 'other';
            if (!types[type]) {
                types[type] = [];
            }
            types[type].push(notif);
        });
        
        return types;
    } catch (error) {
        console.error('Error grouping by type:', error);
        return {};
    }
}

function renderGroupedByType(notifs) {
    try {
        const grouped = groupByType(notifs);
        let html = '';
        
        Object.keys(grouped).forEach(type => {
            if (grouped[type].length > 0) {
                const icon = grouped[type][0].data?.icon || 'order';
                html += `
                    <div class="notification-group">
                        <div class="group-header">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;">
                                ${getIconSVG(icon)}
                            </svg>
                            ${getNotificationTypeLabel(type)} (${grouped[type].length})
                        </div>
                        ${grouped[type].map(n => renderNotification(n, false)).join('')}
                    </div>
                `;
            }
        });
        
        return html || '<div class="empty-state"><p>No notifications</p></div>';
    } catch (error) {
        console.error('Error rendering grouped by type:', error);
        return '<div class="error-state"><p>Error grouping notifications</p></div>';
    }
}

function renderGroupedByDay(groups) {
    try {
        let html = '';
        
        groups.forEach(group => {
            const dateHeader = formatDateHeader(group.date);
            
            html += `
                <div class="notification-group">
                    <div class="group-header">${dateHeader}</div>
                    ${group.notifications.map(n => renderNotification(n, false)).join('')}
                </div>
            `;
        });
        
        return html;
    } catch (error) {
        console.error('Error rendering grouped by day:', error);
        return '<div class="error-state"><p>Error grouping notifications</p></div>';
    }
}

function renderGroupedByWeek(groups) {
    try {
        let html = '';
        
        groups.forEach(group => {
            html += `
                <div class="notification-group">
                    <div class="group-header">${group.week}</div>
                    ${group.notifications.map(n => renderNotification(n, false)).join('')}
                </div>
            `;
        });
        
        return html;
    } catch (error) {
        console.error('Error rendering grouped by week:', error);
        return '<div class="error-state"><p>Error grouping notifications</p></div>';
    }
}

// ============================================================================
// ERROR DISPLAY
// ============================================================================

function showError(message) {
    console.error('User-facing error:', message);
    alert(message);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Notification system initializing...');
    
    try {
        // Close dropdown when clicking outside
        document.addEventListener('click', function(event) {
            const dropdown = document.getElementById('notificationDropdown');
            const bell = document.querySelector('.notification-bell');
            
            if (dropdown && bell && !bell.contains(event.target) && !dropdown.contains(event.target)) {
                dropdown.classList.remove('active');
            }
        });

        // Close modal when clicking outside
        const historyModal = document.getElementById('historyModal');
        if (historyModal) {
            historyModal.addEventListener('click', function(event) {
                if (event.target === historyModal) {
                    closeHistory();
                }
            });
        }

        // Initial fetch
        fetchNotifications('all', 'recent');

        // Poll for new notifications every 3 hours
        setInterval(() => {
            fetchNotifications('all', 'recent');
        }, 10800000);  // 3 hours in milliseconds
        
        console.log('Notification system initialized successfully');
    } catch (error) {
        console.error('Error initializing notification system:', error);
    }
});
