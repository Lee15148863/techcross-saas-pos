/**
 * search-data-api.js
 * Loads search index from /api/brands (MongoDB) instead of localStorage JS files.
 * Replaces search-data-enhanced.js for the new Brand→Type→Model→Issue structure.
 */

let _searchIndex = [];
let _indexReady = false;
let _indexPromise = null;

async function buildSearchIndex() {
    try {
        const res = await fetch('/api/brands');
        if (!res.ok) throw new Error('API error');
        const brands = await res.json();

        _searchIndex = [];

        for (const [brandId, brand] of Object.entries(brands)) {
            for (const [typeId, type] of Object.entries(brand.types || {})) {
                for (const [modelId, model] of Object.entries(type.models || {})) {
                    // Build a flat services map for display in search results
                    const issues = model.issues || {};
                    const visibleIssues = Object.fromEntries(
                        Object.entries(issues).filter(([, v]) => v.price !== -1)
                    );

                    _searchIndex.push({
                        id: `${brandId}-${typeId}-${modelId}`,
                        name: model.name,
                        brand: brand.name,
                        type: type.name,
                        category: type.name,
                        icon: getIcon(brand.name, type.name),
                        // link goes to pricing.html — the new unified page
                        link: `pricing.html`,
                        // store for display in modal
                        issues: visibleIssues,
                        // legacy fields expected by search engine
                        services: Object.fromEntries(
                            Object.entries(visibleIssues).map(([k, v]) => [k, v.price])
                        ),
                        serviceTypes: Object.fromEntries(
                            Object.entries(visibleIssues).map(([k, v]) => [k, { name: v.name }])
                        ),
                        keywords: [
                            brandId, brand.name.toLowerCase(),
                            typeId, type.name.toLowerCase(),
                            model.name.toLowerCase()
                        ]
                    });
                }
            }
        }

        _indexReady = true;
        console.log(`Search index built from API: ${_searchIndex.length} models`);
    } catch (e) {
        console.error('Failed to build search index from API:', e);
        _indexReady = true; // don't block forever
    }
}

function getIcon(brandName, typeName) {
    const b = brandName.toLowerCase();
    const t = typeName.toLowerCase();
    if (t.includes('tablet') || t.includes('ipad')) return '📲';
    if (t.includes('laptop') || t.includes('macbook') || t.includes('computer')) return '💻';
    if (t.includes('console') || t.includes('playstation') || t.includes('xbox') || t.includes('switch')) return '🎮';
    return '📱';
}

// Start loading immediately
_indexPromise = buildSearchIndex();

// Override getAllSearchData used by search-engine-enhanced.js
function getAllSearchData() {
    return _searchIndex;
}

// Expose promise so search engine can wait for data
window._searchIndexReady = _indexPromise;
