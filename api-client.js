/**
 * API Client - replaces localStorage-based pricing data
 * Fetches pricing data from the backend API
 */
const PricingAPI = {
    _cache: {},

    async get(brand) {
        if (this._cache[brand]) return this._cache[brand];
        try {
            const res = await fetch(`/api/pricing/${brand}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this._cache[brand] = data;
            return data;
        } catch (err) {
            console.error(`Failed to load pricing for ${brand}:`, err);
            return null;
        }
    },

    async save(brand, data) {
        // Build auth headers: JWT only
        const user = Auth.getUser();
        const token = Auth.getToken();
        if (!user || user.role !== 'root' || !token) {
            throw new Error('Admin authentication required');
        }
        const headers = Auth.getHeaders();

        const res = await fetch(`/api/pricing/${brand}`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Save failed');
        }
        // Invalidate cache
        delete this._cache[brand];
        return await res.json();
    }
};
