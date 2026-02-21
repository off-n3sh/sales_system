import { showModalError } from './utils.js';

const modal = document.getElementById('expenseModal');
const form = document.getElementById('expense-form');
const categorySelect = document.getElementById('expense-category');
const stockSection = document.getElementById('section-stock');
const closeBtn = document.getElementById('close-expense-modal');
const xBtn = document.getElementById('close-x');

// Function to reset and show modal (Exported for main.js)
export function openExpenseModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    form.reset();
    stockSection.classList.add('hidden');
    document.getElementById('expense-error').classList.add('hidden');
    modal.classList.remove('hidden');
}

// 1. Toggle Stock Fields based on Category
categorySelect.addEventListener('change', (e) => {
    const isStock = e.target.value === 'Stock';
    stockSection.classList.toggle('hidden', !isStock);
    
    // Set 'required' only when visible
    const stockInputs = stockSection.querySelectorAll('input');
    stockInputs.forEach(input => {
        isStock ? input.setAttribute('required', '') : input.removeAttribute('required');
    });
});

// 2. Unified Form Submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('expense-error');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Processing...';
    errorDiv.classList.add('hidden');

    const formData = new FormData(form);

    try {
    const response = await fetch(form.action, {
        method: 'POST',
        body: formData,
        // Ensure no Content-Type header is set manually here
    });

    // Check if the response is actually JSON before parsing
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        const result = await response.json();
        
        if (response.ok) {
            // Use the redirect URL sent by the backend
            window.location.href = result.redirect_url || '/dashboard';
        } else {
            throw new Error(result.error || 'Server error occurred');
        }
    } else {
        // If server sent HTML instead of JSON (likely a 500 error)
        const errorText = await response.text();
        console.error("Server returned HTML instead of JSON:", errorText);
        throw new Error("Server Error: Check your Flask console logs.");
    }
} catch (error) {
    errorDiv.innerText = error.message;
    errorDiv.classList.remove('hidden');
}
});

// 3. Close Handlers
[closeBtn, xBtn].forEach(btn => {
    btn?.addEventListener('click', () => modal.classList.add('hidden'));
});