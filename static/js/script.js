// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const closeBtn = document.getElementById('sidebar-close');
    const themeToggle = document.getElementById('theme-toggle');
    const toggleBall = document.getElementById('toggle-ball');

    // Sidebar Toggle
    if (toggleBtn && closeBtn && sidebar && mainContent) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('show');
            sidebar.classList.toggle('-translate-x-full'); // Keep translate for animation
            mainContent.classList.toggle('sidebar-open');
        });

        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('show');
            sidebar.classList.add('-translate-x-full');
            mainContent.classList.remove('sidebar-open');
        });

        // Close sidebar when clicking outside
        document.addEventListener('click', (e) => {
            if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target) && sidebar.classList.contains('show')) {
                sidebar.classList.remove('show');
                sidebar.classList.add('-translate-x-full');
                mainContent.classList.remove('sidebar-open');
            }
        });
    }

    // Dark Mode Toggle
    if (themeToggle && toggleBall) {
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark');
            if (document.body.classList.contains('dark')) {
                toggleBall.classList.add('translate-x-8');
            } else {
                toggleBall.classList.remove('translate-x-8');
            }
            localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
        });

        // Apply saved theme on load
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark');
            toggleBall.classList.add('translate-x-8');
        } else {
            document.body.classList.remove('dark');
            toggleBall.classList.remove('translate-x-8');
        }
    }

    // Remove retail modal logic (for now—revisit for analytics later if needed)
});
