/**
 * page-init.js
 * Async data loader for all pricing pages.
 * Replaces the synchronous loadXxxPricingData() pattern.
 * 
 * Usage: each page sets window.PAGE_CONFIG before this script runs:
 *   window.PAGE_CONFIG = { brand: 'apple', deviceType: 'iphone', initFn: initPage }
 */
(async function() {
    const cfg = window.PAGE_CONFIG;
    if (!cfg) return;

    // Show loading state
    const modelSelect = document.getElementById('deviceModel');
    if (modelSelect) {
        modelSelect.innerHTML = '<option value="">Loading...</option>';
        modelSelect.disabled = true;
    }

    try {
        const data = await PricingAPI.get(cfg.brand);
        if (!data) throw new Error('No data returned');

        // Make data available globally (same as before)
        window.pricingData = data;

        // Re-enable select
        if (modelSelect) {
            modelSelect.innerHTML = '<option value="">Select Model</option>';
            modelSelect.disabled = false;
        }

        // Call the page's own init function
        if (typeof cfg.initFn === 'function') {
            cfg.initFn(data);
        }

        // Auto-select from URL param
        const params = new URLSearchParams(window.location.search);
        const modelParam = params.get('model');
        if (modelParam && modelSelect) {
            modelSelect.value = modelParam;
            if (modelSelect.value === modelParam) {
                modelSelect.dispatchEvent(new Event('change'));
                modelSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

    } catch (err) {
        console.error('Failed to load pricing data:', err);
        if (modelSelect) {
            modelSelect.innerHTML = '<option value="">Failed to load — please refresh</option>';
        }
    }
})();
