// Enhanced Search Engine with Advanced Features
class EnhancedSearchEngine {
    constructor() {
        this.searchInput = document.getElementById('searchInput');
        this.modalSearchInput = document.getElementById('modalSearchInput');
        this.searchBtn = document.getElementById('searchBtn');
        this.mobileSearchBtn = document.getElementById('mobileSearchBtn');
        this.searchModal = document.getElementById('searchModal');
        this.searchResults = document.getElementById('searchResults');
        this.searchDropdown = document.getElementById('searchDropdown');
        
        this.selectedIndex = -1;
        this.searchHistory = this.loadSearchHistory();
        this.debounceTimer = null;
        this.cache = new Map();
        this.maxCacheSize = 100;
        
        this.init();
    }
    
    init() {
        // Event listeners
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => this.handleInput(e));
            this.searchInput.addEventListener('focus', () => this.showDropdown());
            this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));
            this.searchInput.addEventListener('blur', () => {
                setTimeout(() => this.hideDropdown(), 200);
            });
        }
        
        if (this.modalSearchInput) {
            this.modalSearchInput.addEventListener('input', (e) => this.handleModalInput(e));
            this.modalSearchInput.addEventListener('keydown', (e) => this.handleModalKeydown(e));
        }
        
        if (this.searchBtn) {
            this.searchBtn.addEventListener('click', () => this.openModal());
        }
        
        if (this.mobileSearchBtn) {
            this.mobileSearchBtn.addEventListener('click', () => this.openModal());
        }
        
        // Click outside to close
        if (this.searchModal) {
            this.searchModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('search-modal-overlay') || e.target === this.searchModal) {
                    this.closeModal();
                }
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K to open search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.openModal();
            }
            
            // ESC to close
            if (e.key === 'Escape' && this.searchModal && this.searchModal.classList.contains('active')) {
                this.closeModal();
            }
        });
    }
    
    // Advanced text normalization
    normalize(text) {
        return text.toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[^\w\s\u4e00-\u9fa5]/g, '');
    }
    
    // Extract numbers from text
    extractNumbers(text) {
        const matches = text.match(/\d+/g);
        return matches ? matches.map(n => parseInt(n)) : [];
    }
    
    // Highlight matching text with better algorithm
    highlightMatch(text, query) {
        if (!query) return text;
        
        const words = query.toLowerCase().split(/\s+/);
        let result = text;
        
        words.forEach(word => {
            const regex = new RegExp(`(${word})`, 'gi');
            result = result.replace(regex, '<mark>$1</mark>');
        });
        
        return result;
    }
    
    // Advanced fuzzy matching algorithm
    fuzzyMatch(item, query) {
        const t = item.name.toLowerCase().trim();
        const q = query.toLowerCase().trim();
        const tNorm = this.normalize(item.name);
        const qNorm = this.normalize(query);

        // Smart split: "iphone11" → "iphone 11", "ipad pro" stays as is
        const smartSplit = (str) => {
            return str
                .replace(/([a-z])(\d)/gi, '$1 $2')   // "iphone11" → "iphone 11"
                .replace(/(\d)([a-z])/gi, '$1 $2')   // "11pro" → "11 pro"
                .trim();
        };

        const qSmart = smartSplit(q);
        const tSmart = smartSplit(t);

        // Exact match
        if (t === q || tNorm === qNorm || tSmart === qSmart) return { match: true, score: 1000 };

        // Name starts with query
        if (t.startsWith(q) || tNorm.startsWith(qNorm) || tSmart.startsWith(qSmart)) return { match: true, score: 900 };

        // Split into words for word-level matching
        const textWords = tSmart.split(/[\s\-\/\(\),\.]+/).filter(Boolean);
        const queryWords = qSmart.split(/\s+/).filter(Boolean);
        const totalWords = queryWords.length;

        // Extract numbers for precise number matching
        const queryNums = this.extractNumbers(qSmart);
        const textNums = this.extractNumbers(t);

        let exactWordMatches = 0;
        let partialWordMatches = 0;
        for (const qw of queryWords) {
            if (textWords.some(tw => tw === qw)) {
                exactWordMatches++;
            } else if (textWords.some(tw => tw.includes(qw))) {
                partialWordMatches++;
            }
        }

        let score = 0;
        if (exactWordMatches === totalWords) {
            score = 800;
        } else if (exactWordMatches + partialWordMatches === totalWords) {
            score = 600 + (exactWordMatches / totalWords) * 100;
        } else if (exactWordMatches > 0 || partialWordMatches > 0) {
            score = 300 + ((exactWordMatches + partialWordMatches) / totalWords) * 100;
        } else if (tNorm.includes(qNorm) || tSmart.includes(qSmart)) {
            score = 200;
        } else {
            return { match: false, score: 0 };
        }

        // Boost: exact number match (e.g. searching "11" should boost iPhone 11 over iPhone 12)
        if (queryNums.length > 0) {
            const exactNumMatches = queryNums.filter(qn => textNums.includes(qn)).length;
            if (exactNumMatches === queryNums.length) {
                score += 300; // All numbers match exactly
            } else if (exactNumMatches > 0) {
                score += 100; // Some numbers match
            } else {
                score -= 200; // No number match, penalize
            }
        }

        // Boost when query words match the item's type/brand
        const itemType = (item.type || '').toLowerCase();
        const itemBrand = (item.brand || '').toLowerCase();
        for (const qw of queryWords) {
            if (qw.length > 2 && (itemType.includes(qw) || itemBrand.includes(qw))) {
                score += 500;
            }
        }

        // Boost shorter names (more specific match, e.g. "iPhone 11" over "iPhone 11 Pro Max")
        if (score > 0) {
            score += Math.max(0, 50 - t.length);
        }

        return { match: true, score };
    }
    
    // Enhanced search with better ranking
    search(query) {
        if (!query || query.length < 2) {
            return [];
        }
        
        // Check cache
        const cacheKey = query.toLowerCase();
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        
        const results = [];
        
        try {
            // Get all search data
            const allData = typeof getAllSearchData === 'function' ? getAllSearchData() : [];
            
            allData.forEach(item => {
                const matchResult = this.fuzzyMatch(item, query);
                
                if (matchResult.match && matchResult.score > 100) {
                    results.push({
                        ...item,
                        matchScore: matchResult.score
                    });
                }
            });
        } catch (error) {
            console.error('Search error:', error);
        }
        
        // Sort by match score (descending)
        results.sort((a, b) => b.matchScore - a.matchScore);
        
        // Limit results
        const limitedResults = results.slice(0, 15);
        
        // Cache results (with size limit)
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(cacheKey, limitedResults);
        
        return limitedResults;
    }
    
    // Handle input with debounce
    handleInput(e) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            const query = e.target.value.trim();
            if (query.length >= 2) {
                this.showAutocomplete(query);
            } else if (query.length === 0) {
                this.showSearchHistory();
            } else {
                this.hideDropdown();
            }
        }, 150);
    }
    
    // Show search history
    showSearchHistory() {
        if (this.searchHistory.length === 0) {
            this.hideDropdown();
            return;
        }
        
        let html = '<div class="search-dropdown-section">';
        html += '<div class="search-dropdown-title">Recent Searches</div>';
        
        this.searchHistory.slice(0, 5).forEach((query, index) => {
            html += `
                <div class="search-dropdown-item history-item" data-query="${query}">
                    <div class="search-dropdown-icon">🕐</div>
                    <div class="search-dropdown-info">
                        <div class="search-dropdown-name">${query}</div>
                    </div>
                    <button class="search-history-delete" data-query="${query}" title="Remove">×</button>
                </div>
            `;
        });
        
        html += '</div>';
        
        this.searchDropdown.innerHTML = html;
        this.searchDropdown.classList.add('active');
        
        // Add click handlers
        this.searchDropdown.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('search-history-delete')) {
                    const query = item.getAttribute('data-query');
                    this.searchInput.value = query;
                    this.showAutocomplete(query);
                }
            });
        });
        
        // Add delete handlers
        this.searchDropdown.querySelectorAll('.search-history-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const query = btn.getAttribute('data-query');
                this.removeFromHistory(query);
                this.showSearchHistory();
            });
        });
    }
    
    // Show autocomplete dropdown
    showAutocomplete(query) {
        const results = this.search(query);
        
        if (results.length === 0) {
            this.searchDropdown.innerHTML = `
                <div class="search-dropdown-empty">
                    <p>No results found</p>
                    <small>Try "iPhone 15", "Samsung S24", "PS5", "MacBook"</small>
                </div>
            `;
            this.searchDropdown.classList.add('active');
            return;
        }
        
        let html = '<div class="search-dropdown-section">';
        html += `<div class="search-dropdown-title">Found ${results.length} result${results.length > 1 ? 's' : ''}</div>`;
        
        results.slice(0, 6).forEach((result, index) => {
            const highlightedName = this.highlightMatch(result.name, query);
            const priceText = result.price || (result.services ? 'View pricing' : 'See details');
            
            html += `
                <div class="search-dropdown-item" data-index="${index}" data-link="${result.link}">
                    <div class="search-dropdown-icon">${result.icon}</div>
                    <div class="search-dropdown-info">
                        <div class="search-dropdown-name">${highlightedName}</div>
                        <div class="search-dropdown-meta">${result.brand} • ${result.type}</div>
                    </div>
                    <div class="search-dropdown-badge">${priceText}</div>
                </div>
            `;
        });
        
        html += '</div>';
        
        this.searchDropdown.innerHTML = html;
        this.searchDropdown.classList.add('active');
        this.selectedIndex = -1;
        
        // Add click handlers
        this.searchDropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                const link = item.getAttribute('data-link');
                this.addToHistory(query);
                window.location.href = link;
            });
        });
    }
    
    // Handle modal input
    handleModalInput(e) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            const query = e.target.value.trim();
            this.showModalResults(query);
        }, 200);
    }
    
    // Show modal results with enhanced display
    showModalResults(query) {
        if (!query || query.length < 2) {
            this.searchResults.innerHTML = `
                <div class="search-no-results">
                    <p>Start typing to search</p>
                    <small>Try: "iPhone 15 Pro", "Samsung Galaxy S24", "PS5 controller", "MacBook screen"</small>
                    ${this.searchHistory.length > 0 ? `
                        <div style="margin-top: 24px;">
                            <strong>Recent Searches:</strong>
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;">
                                ${this.searchHistory.slice(0, 5).map(h => `
                                    <button class="search-history-chip" data-query="${h}">${h}</button>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
            
            // Add click handlers for history chips
            this.searchResults.querySelectorAll('.search-history-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const query = chip.getAttribute('data-query');
                    this.modalSearchInput.value = query;
                    this.showModalResults(query);
                });
            });
            return;
        }
        
        const results = this.search(query);
        
        if (results.length === 0) {
            this.searchResults.innerHTML = `
                <div class="search-no-results">
                    <p>No results found for "${query}"</p>
                    <small>Try different keywords or check spelling</small>
                    <div style="margin-top: 16px;">
                        <strong>Suggestions:</strong>
                        <ul style="text-align: left; margin-top: 8px; padding-left: 20px;">
                            <li>Use model numbers (e.g., "iPhone 15", "S24")</li>
                            <li>Try brand names (e.g., "Apple", "Samsung")</li>
                            <li>Search for services (e.g., "screen repair", "battery")</li>
                        </ul>
                    </div>
                </div>
            `;
            return;
        }
        
        // Save to history
        this.addToHistory(query);
        
        let html = `
            <div style="margin-bottom: 16px; padding: 0 12px; color: #86868b; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
                <span>Found ${results.length} result${results.length > 1 ? 's' : ''}</span>
                <span style="font-size: 11px;">Sorted by relevance</span>
            </div>
        `;
        
        results.forEach((result, index) => {
            const highlightedName = this.highlightMatch(result.name, query);
            
            // For devices with services
            if (result.services && result.serviceTypes && Object.keys(result.services).length > 0) {
                const services = result.services;
                const serviceTypes = result.serviceTypes;
                const serviceKeys = Object.keys(services).slice(0, 6);
                
                const servicesList = serviceKeys.map(serviceKey => {
                    const serviceInfo = serviceTypes[serviceKey];
                    const serviceName = serviceInfo ? serviceInfo.name : serviceKey;
                    let price = services[serviceKey];
                    
                    if (price === 0) {
                        price = '<span style="color: #ff9500;">Contact Us</span>';
                    } else if (price === -1) {
                        return ''; // hidden
                    } else {
                        price = `<span style="color: #34c759; font-weight: 600;">€${price}</span>`;
                    }
                    
                    return `
                        <div class="search-result-service">
                            <span class="service-name">${serviceName}</span>
                            <span class="service-price">${price}</span>
                        </div>
                    `;
                }).filter(Boolean).join('');
                
                const totalVisible = Object.values(services).filter(p => p !== -1).length;

                html += `
                    <div class="search-result-item" data-index="${index}" data-link="${result.link}">
                        <h3>
                            <span class="device-type">${result.icon} ${result.type}</span>
                            <span>${highlightedName}</span>
                        </h3>
                        <div class="search-result-services">
                            ${servicesList}
                        </div>
                        ${totalVisible > 6 ? `<div style="text-align:center;margin-top:8px;color:#86868b;font-size:13px;">+${totalVisible - 6} more services</div>` : ''}
                        <a href="${result.link}" class="search-result-link">View full pricing →</a>
                    </div>
                `;
            } else {
                // For services without detailed pricing
                html += `
                    <div class="search-result-item" data-index="${index}" data-link="${result.link}">
                        <h3>
                            <span class="device-type">${result.icon} ${result.type}</span>
                            <span>${highlightedName}</span>
                            ${result.matchScore >= 90 ? '<span class="match-badge">Best Match</span>' : ''}
                        </h3>
                        <div class="search-result-services">
                            <div class="search-result-service">
                                <span class="service-name">${result.brand || result.category}</span>
                                <span class="service-price" style="color: #34c759; font-weight: 600;">${result.price || 'See pricing'}</span>
                            </div>
                        </div>
                        <a href="${result.link}" class="search-result-link">View details →</a>
                    </div>
                `;
            }
        });
        
        this.searchResults.innerHTML = html;
        this.selectedIndex = -1;
        
        // Add click handlers
        this.searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('search-result-link')) {
                    const link = item.getAttribute('data-link');
                    window.location.href = link;
                }
            });
        });
    }
    
    // Keyboard navigation
    handleKeydown(e) {
        const items = this.searchDropdown.querySelectorAll('.search-dropdown-item:not(.history-item)');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
            this.updateSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
            this.updateSelection(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
                items[this.selectedIndex].click();
            } else {
                this.openModal();
            }
        } else if (e.key === 'Escape') {
            this.hideDropdown();
            this.searchInput.blur();
        }
    }
    
    handleModalKeydown(e) {
        const items = this.searchResults.querySelectorAll('.search-result-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
            this.updateModalSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
            this.updateModalSelection(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
                const link = items[this.selectedIndex].getAttribute('data-link');
                window.location.href = link;
            }
        }
    }
    
    updateSelection(items) {
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.classList.remove('selected');
            }
        });
    }
    
    updateModalSelection(items) {
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.classList.remove('selected');
            }
        });
    }
    
    showDropdown() {
        if (this.searchInput.value.trim().length >= 2) {
            this.searchDropdown.classList.add('active');
        } else if (this.searchInput.value.trim().length === 0) {
            this.showSearchHistory();
        }
    }
    
    hideDropdown() {
        this.searchDropdown.classList.remove('active');
    }
    
    openModal() {
        this.searchModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
            this.modalSearchInput.focus();
            if (this.searchInput.value) {
                this.modalSearchInput.value = this.searchInput.value;
                this.showModalResults(this.searchInput.value);
            } else {
                this.showModalResults('');
            }
        }, 100);
    }
    
    closeModal() {
        this.searchModal.classList.remove('active');
        document.body.style.overflow = '';
        this.modalSearchInput.value = '';
        this.searchResults.innerHTML = '';
        this.selectedIndex = -1;
    }
    
    // Search history management
    loadSearchHistory() {
        try {
            return JSON.parse(localStorage.getItem('search_history') || '[]');
        } catch {
            return [];
        }
    }
    
    addToHistory(query) {
        if (!query || query.length < 2) return;
        
        this.searchHistory = this.searchHistory.filter(q => q.toLowerCase() !== query.toLowerCase());
        this.searchHistory.unshift(query);
        this.searchHistory = this.searchHistory.slice(0, 10);
        
        localStorage.setItem('search_history', JSON.stringify(this.searchHistory));
    }
    
    removeFromHistory(query) {
        this.searchHistory = this.searchHistory.filter(q => q !== query);
        localStorage.setItem('search_history', JSON.stringify(this.searchHistory));
    }
    
    clearHistory() {
        this.searchHistory = [];
        localStorage.removeItem('search_history');
    }
}

// Initialize enhanced search engine when DOM is ready
// If search-data-api.js is loaded, wait for the index to be built first
async function initSearchEngine() {
    if (window._searchIndexReady) {
        await window._searchIndexReady;
    }
    window.enhancedSearchEngine = new EnhancedSearchEngine();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearchEngine);
} else {
    initSearchEngine();
}
