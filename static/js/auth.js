// Initialize particles.js
if (typeof particlesJS !== 'undefined') {
    particlesJS("particles-js", {
        particles: {
            number: { value: 60, density: { enable: true, value_area: 800 } },
            color: { value: "#ffffff" },
            opacity: { value: 0.3, random: true },
            size: { value: 3, random: true },
            line_linked: { enable: true, distance: 150, color: "#ffffff", opacity: 0.2, width: 1 },
            move: { enable: true, speed: 1.5, direction: "none", random: true, out_mode: "out" }
        }
    });
} else {
    console.error("particlesJS is not defined. Check particles.min.js.");
}

const loginTab = document.getElementById("login-tab");
const signupTab = document.getElementById("signup-tab");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");

// Ensure initial state: show login form, hide signup form
loginForm.classList.remove("hidden");
signupForm.classList.add("hidden");
loginTab.classList.add("bg-blue-500", "text-white", "shadow-md");
signupTab.classList.add("text-gray-600");

loginTab.addEventListener("click", () => {
    loginTab.classList.add("bg-blue-500", "text-white", "shadow-md");
    signupTab.classList.remove("bg-blue-500", "text-white", "shadow-md");
    signupTab.classList.add("text-gray-600");
    loginForm.classList.remove("hidden");
    signupForm.classList.add("hidden");
});

signupTab.addEventListener("click", () => {
    signupTab.classList.add("bg-blue-500", "text-white", "shadow-md");
    loginTab.classList.remove("bg-blue-500", "text-white", "shadow-md");
    loginTab.classList.add("text-gray-600");
    signupForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
});

document.getElementById("switch-to-login").addEventListener("click", (e) => {
    e.preventDefault();
    loginTab.click();
});

function togglePassword(inputId, toggleBtnId) {
    const input = document.getElementById(inputId);
    const toggle = document.getElementById(toggleBtnId);
    toggle.addEventListener("click", () => {
        const type = input.type === "password" ? "text" : "password";
        input.type = type;
        toggle.querySelector("i").classList.toggle("fa-eye");
        toggle.querySelector("i").classList.toggle("fa-eye-slash");
    });
}

togglePassword("login-password", "toggle-login-password");
togglePassword("signup-password", "toggle-signup-password");
togglePassword("signup-confirm-password", "toggle-signup-confirm-password");

function showError(form, message) {
    const existingError = form.querySelector('.error-message');
    const existingSuccess = form.querySelector('.success-message');
    if (existingError) existingError.remove();
    if (existingSuccess) existingSuccess.remove();
    const errorDiv = document.createElement('div');
    errorDiv.className = 'bg-red-100 border-l-4 border-red-500 text-red-700 p-3 rounded animate-shake error-message';
    errorDiv.innerHTML = `<p class="text-sm">${message}</p>`;
    form.insertBefore(errorDiv, form.firstChild);
    setTimeout(() => errorDiv?.remove(), 5000);
}

function showSuccess(form, message) {
    const existingError = form.querySelector('.error-message');
    const existingSuccess = form.querySelector('.success-message');
    if (existingError) existingError.remove();
    if (existingSuccess) existingSuccess.remove();
    const successDiv = document.createElement('div');
    successDiv.className = 'bg-green-100 border-l-4 border-green-500 text-green-700 p-3 rounded animate-slide-in success-message';
    successDiv.innerHTML = `<p class="text-sm">${message}</p>`;
    form.insertBefore(successDiv, form.firstChild);
    setTimeout(() => successDiv?.remove(), 5000);
}

signupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const submitBtn = signupForm.querySelector('.submit-btn');
    submitBtn.classList.add('processing');
    submitBtn.disabled = true;

    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById("signup-confirm-password").value;

    if (password !== confirmPassword) {
        showError(signupForm, "Passwords don’t match.");
        submitBtn.classList.remove('processing');
        submitBtn.disabled = false;
        return;
    }

    const formData = new FormData(signupForm);
    fetch(signupForm.action, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            showSuccess(signupForm, "Signup successful! Awaiting approval.");
            setTimeout(() => {
                window.location.href = '/awaiting?email=' + encodeURIComponent(formData.get('email'));
            }, 2000);
        } else {
            showError(signupForm, data.error || "Signup failed.");
        }
    })
    .catch(() => showError(signupForm, "Server error. Try again."))
    .finally(() => {
        submitBtn.classList.remove('processing');
        submitBtn.disabled = false;
    });
});

loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector('.submit-btn');
    submitBtn.classList.add('processing');
    submitBtn.disabled = true;

    const formData = new FormData(loginForm);
    fetch(loginForm.action, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            window.location.href = data.redirect || '/dashboard';
        } else if (data.status === 'pending') {
            window.location.href = data.redirect;
        } else {
            showError(loginForm, data.error || "Login failed.");
        }
    })
    .catch(() => showError(loginForm, "Server error. Try again."))
    .finally(() => {
        submitBtn.classList.remove('processing');
        submitBtn.disabled = false;
    });
});

document.getElementById("forgot-password").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = '/forgot-password';
});
