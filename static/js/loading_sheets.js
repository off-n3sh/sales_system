// static/js/loading_sheets.js
document.addEventListener('DOMContentLoaded', function() {
    // Print current sheet
    const printButton = document.getElementById('print-button');
    if (printButton) {
        printButton.addEventListener('click', function() {
            window.print();
        });
    }
});

// Print specific loading sheet by ID
function printLoadingSheet(sheetId) {
    // Open the sheet in a new window/tab for printing
    const printUrl = `/view-loading-sheet?sheet_id=${sheetId}&print=true`;
    const printWindow = window.open(printUrl, '_blank');
    
    // Trigger print when content is loaded
    printWindow.onload = function() {
        printWindow.print();
    };
}