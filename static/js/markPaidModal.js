// static/js/markPaidModal.js
import { showModalError } from './utils.js';

const paidModal = document.getElementById('mark-paid-modal');
const closePaid = document.getElementById('close-paid-modal');
const paymentMethodBtns = document.querySelectorAll('.payment-method-btn');
const singlePaymentSection = document.getElementById('single-payment-section');
const dualPaymentSection = document.getElementById('dual-payment-section');
const paymentTypeInput = document.getElementById('payment-type');
const isDualPaymentInput = document.getElementById('is-dual-payment');
const cashAmountInput = document.getElementById('cash-amount');
const mpesaAmountInput = document.getElementById('mpesa-amount');
const dualTotalDisplay = document.getElementById('dual-total');

let currentBalance = 0;

// Payment method toggle
paymentMethodBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        paymentMethodBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        const method = this.dataset.method;
        const singleAmountInput = document.getElementById('paid-amount');
        
        if (method === 'dual') {
            singlePaymentSection.classList.add('hidden');
            dualPaymentSection.classList.remove('hidden');
            isDualPaymentInput.value = 'true';
            paymentTypeInput.value = 'dual';
            singleAmountInput.disabled = true;
            singleAmountInput.removeAttribute('required');
            cashAmountInput.disabled = false;
            mpesaAmountInput.disabled = false;
        } else {
            singlePaymentSection.classList.remove('hidden');
            dualPaymentSection.classList.add('hidden');
            isDualPaymentInput.value = 'false';
            paymentTypeInput.value = method;
            singleAmountInput.disabled = false;
            singleAmountInput.setAttribute('required', 'required');
            cashAmountInput.disabled = true;
            mpesaAmountInput.disabled = true;
        }
        
        document.getElementById('mark-paid-error').classList.add('hidden');
    });
});

// Dual total update
function updateDualTotal() {
    const cash = parseFloat(cashAmountInput.value) || 0;
    const mpesa = parseFloat(mpesaAmountInput.value) || 0;
    const total = cash + mpesa;
    dualTotalDisplay.textContent = `KSh ${total.toFixed(2)}`;
    
    const remaining = currentBalance - total;
    const helperText = document.getElementById('dual-full-amount-text');
    if (total > currentBalance) {
        helperText.textContent = `Warning: Total exceeds balance by KSh ${(total - currentBalance).toFixed(2)}`;
        helperText.className = 'text-red-600 dark:text-red-400';
    } else if (total > 0) {
        helperText.textContent = remaining === 0 ? 'Check: Full payment' : `Remaining: KSh ${remaining.toFixed(2)}`;
        helperText.className = 'text-gray-600 dark:text-gray-400';
    } else {
        helperText.textContent = '';
    }
}
cashAmountInput.addEventListener('input', updateDualTotal);
mpesaAmountInput.addEventListener('input', updateDualTotal);

function markPaid(receiptId, balance) {
    currentBalance = parseFloat(balance);
    
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    paidModal.classList.remove('hidden');
    
    document.getElementById('paid-order-id').textContent = receiptId;
    document.getElementById('full-amount-text').textContent = `Remaining Balance: KSh ${currentBalance.toFixed(2)}`;
    
    const form = document.getElementById('mark-paid-form');
    form.action = `/mark_paid/${receiptId}`;
    
    // Reset to cash
    paymentMethodBtns.forEach(b => b.classList.remove('active'));
    paymentMethodBtns[0].classList.add('active');
    singlePaymentSection.classList.remove('hidden');
    dualPaymentSection.classList.add('hidden');
    paymentTypeInput.value = 'cash';
    isDualPaymentInput.value = 'false';
    
    document.getElementById('paid-amount').value = '';
    document.getElementById('paid-amount').disabled = false;
    document.getElementById('paid-amount').setAttribute('required', 'required');
    cashAmountInput.value = '';
    cashAmountInput.disabled = true;
    mpesaAmountInput.value = '';
    mpesaAmountInput.disabled = true;
    dualTotalDisplay.textContent = 'KSh 0.00';
    document.getElementById('dual-full-amount-text').textContent = '';
    document.getElementById('paid-error').classList.add('hidden');
    
    let isSubmitting = false;
    
    form.onsubmit = function(e) {
        e.preventDefault();
        if (isSubmitting) return;
        isSubmitting = true;
        
        const submitBtn = form.querySelector('.submit-btn');
        submitBtn.classList.add('processing');
        submitBtn.disabled = true;
        
        const isDual = isDualPaymentInput.value === 'true';
        let totalAmount = 0;
        let cashAmount = 0;
        let mpesaAmount = 0;
        
        if (isDual) {
            cashAmount = parseFloat(cashAmountInput.value) || 0;
            mpesaAmount = parseFloat(mpesaAmountInput.value) || 0;
            totalAmount = cashAmount + mpesaAmount;
            
            if (totalAmount <= 0 || cashAmount < 0 || mpesaAmount < 0 || totalAmount > currentBalance) {
                const msg = totalAmount <= 0 ? 'Enter valid amounts' :
                           totalAmount > currentBalance ? `Exceeds balance: KSh ${totalAmount.toFixed(2)}` :
                           'Negative amounts not allowed';
                showModalError('mark-paid', msg);
                submitBtn.classList.remove('processing');
                submitBtn.disabled = false;
                isSubmitting = false;
                return;
            }
        } else {
            totalAmount = parseFloat(document.getElementById('paid-amount').value) || 0;
            if (totalAmount <= 0 || totalAmount > currentBalance) {
                showModalError('mark-paid', totalAmount <= 0 ? 'Enter amount > 0' : `Exceeds balance: KSh ${totalAmount.toFixed(2)}`);
                submitBtn.classList.remove('processing');
                submitBtn.disabled = false;
                isSubmitting = false;
                return;
            }
        }
        
        const formData = new FormData(form);
        
        // Always send amount_paid
        formData.set('amount_paid', totalAmount.toString());
        
        // Dual: send breakdown + flag
        if (isDual) {
            formData.set('is_dual_payment', 'true');
            formData.set('cash_amount', cashAmount.toString());
            formData.set('mpesa_amount', mpesaAmount.toString());
            // ADD RETAIL-STYLE DUAL FIELDS
            formData.set('payment_type_dual', 'true');
            formData.set('total_amount_paid', totalAmount.toString());
        } else {
            formData.set('is_dual_payment', 'false');
        }
        
        fetch(form.action, {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': formData.get('csrf_token'),
                'Accept': 'application/json'
            }
        })
        .then(r => r.json().then(data => ({ok: r.ok, data})))
        .then(({ok, data}) => {
            if (ok && data.success) {
                paidModal.classList.add('hidden');
                window.location.href = '/orders';
            } else {
                showModalError('mark-paid', data.error || 'Failed');
                submitBtn.classList.remove('processing');
                submitBtn.disabled = false;
                isSubmitting = false;
            }
        })
        .catch(err => {
            showModalError('mark-paid', 'Request failed');
            submitBtn.classList.remove('processing');
            submitBtn.disabled = false;
            isSubmitting = false;
        });
    };
}

closePaid.addEventListener('click', () => paidModal.classList.add('hidden'));

export { markPaid };
