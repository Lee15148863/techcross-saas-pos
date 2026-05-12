// Enhanced Admin Core Functions
// This file provides common functionality for all brand admin pages

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

class EnhancedAdmin {
    constructor(config) {
        this.brandName = config.brandName;
        this.loadDataFunc = config.loadDataFunc;
        this.saveDataFunc = config.saveDataFunc; // kept for fallback
        this.apiBrand = config.apiBrand; // e.g. 'apple', 'samsung', 'multi'
        this.hasDeviceTypes = config.hasDeviceTypes || false;
        this.deviceTypes = config.deviceTypes || ['default'];
        this.currentDevice = this.deviceTypes[0];
        this.pricingData = null;
        this.themeColor = config.themeColor || '#0071e3';
        this._loadFromAPI();
    }

    async _loadFromAPI() {
        if (typeof PricingAPI !== 'undefined' && this.apiBrand) {
            try {
                const data = await PricingAPI.get(this.apiBrand);
                if (data) {
                    this.pricingData = data;
                    this.init();
                    return;
                }
            } catch(e) { console.warn('API load failed, falling back to localStorage', e); }
        }
        // Fallback to localStorage
        this.pricingData = this.loadDataFunc();
        this.init();
    }

    async _saveToAPI() {
        try {
            if (typeof PricingAPI !== 'undefined' && this.apiBrand) {
                await PricingAPI.save(this.apiBrand, this.pricingData);
                return true;
            }
        } catch(e) {
            console.warn('API save failed, trying fallback', e);
        }
        // Fallback to saveDataFunc (e.g. localStorage)
        try {
            if (typeof this.saveDataFunc === 'function') {
                this.saveDataFunc(this.pricingData);
                return true;
            }
        } catch(e) {
            console.warn('Save fallback failed', e);
        }
        return false;
    }

    // Initialize the admin interface
    init() {
        if (!this.pricingData) return;
        this.setupTabs();
        this.setupDeviceButtons();
        this.renderPricingEditor();
    }

    // Setup tab switching
    setupTabs() {
        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                document.querySelectorAll('.admin-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
                
                if (tab.dataset.tab === 'pricing') {
                    this.renderPricingEditor();
                } else if (tab.dataset.tab === 'models') {
                    this.renderModelsEditor();
                } else if (tab.dataset.tab === 'services') {
                    this.renderServicesEditor();
                } else if (tab.dataset.tab === 'batch') {
                    this.renderBatchEditor();
                }
            });
        });
    }

    // Setup device type buttons
    setupDeviceButtons() {
        document.querySelectorAll('.device-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.parentElement.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentDevice = btn.dataset.device;
                
                const activeTab = document.querySelector('.admin-tab.active').dataset.tab;
                if (activeTab === 'pricing') {
                    this.renderPricingEditor();
                } else if (activeTab === 'models') {
                    this.renderModelsEditor();
                } else if (activeTab === 'services') {
                    this.renderServicesEditor();
                } else if (activeTab === 'batch') {
                    this.renderBatchEditor();
                }
            });
        });
    }

    // Get current data based on device type
    getCurrentData() {
        if (this.hasDeviceTypes) {
            return this.pricingData[this.currentDevice];
        }
        return this.pricingData;
    }

    // Render pricing editor
    renderPricingEditor() {
        const editor = document.getElementById('pricing-editor');
        const data = this.getCurrentData();
        const models = data.models;
        const serviceTypes = data.serviceTypes;

        // Check if any model uses screen as object {compatible, original}
        const firstModel = Object.values(models)[0];
        const screenIsObject = firstModel && typeof firstModel.services.screen === 'object' && firstModel.services.screen !== null;

        let html = '<div class="pricing-table"><table><thead><tr>';
        html += '<th>Model</th>';

        for (const [key, service] of Object.entries(serviceTypes)) {
            if (key === 'screen' && screenIsObject) {
                html += `<th>Screen (Compatible)</th><th>Screen (Original)</th>`;
            } else {
                html += `<th>${escapeHtml(service.name)}</th>`;
            }
        }

        html += '</tr></thead><tbody>';

        for (const [modelKey, model] of Object.entries(models)) {
            html += `<tr><td><strong>${escapeHtml(model.name)}</strong></td>`;

            for (const serviceKey of Object.keys(serviceTypes)) {
                const val = model.services[serviceKey];
                if (serviceKey === 'screen' && screenIsObject) {
                    const comp = (val && typeof val === 'object') ? (val.compatible ?? 0) : 0;
                    const orig = (val && typeof val === 'object') ? (val.original ?? 0) : 0;
                    html += `<td><input type="number" value="${comp}" data-model="${modelKey}" data-service="screen" data-subkey="compatible" min="-1" style="width:70px;"></td>`;
                    html += `<td><input type="number" value="${orig}" data-model="${modelKey}" data-service="screen" data-subkey="original" min="-1" style="width:70px;"></td>`;
                } else {
                    const price = (typeof val === 'number') ? val : 0;
                    html += `<td><input type="number" value="${price}" data-model="${modelKey}" data-service="${serviceKey}" min="-1" style="width:70px;"></td>`;
                }
            }

            html += '</tr>';
        }

        html += '</tbody></table></div>';
        editor.innerHTML = html;
    }

    // Render models editor
    renderModelsEditor() {
        const editor = document.getElementById('models-editor');
        const data = this.getCurrentData();
        const models = data.models;
        
        let html = '<div class="pricing-table"><table><thead><tr>';
        html += '<th>Model ID</th><th>Model Name</th><th>Actions</th>';
        html += '</tr></thead><tbody>';
        
        for (const [modelKey, model] of Object.entries(models)) {
            html += `<tr>`;
            html += `<td><code>${escapeHtml(modelKey)}</code></td>`;
            html += `<td><input type="text" value="${escapeHtml(model.name)}" data-model="${modelKey}" style="width: 300px;"></td>`;
            html += `<td><button class="btn-delete" onclick="admin.deleteModel('${escapeHtml(modelKey)}')">Delete</button></td>`;
            html += `</tr>`;
        }
        
        html += '</tbody></table></div>';
        html += '<button class="btn-save" onclick="admin.saveModelNames()" style="margin-top: 16px;">Save Model Names</button>';
        editor.innerHTML = html;
    }

    // Render services editor
    renderServicesEditor() {
        const editor = document.getElementById('services-editor');
        const data = this.getCurrentData();
        const serviceTypes = data.serviceTypes;
        
        let html = '<div class="pricing-table"><table><thead><tr><th>Service ID</th><th>Service Name</th><th>Description</th><th>Actions</th></tr></thead><tbody>';
        for (const [key, service] of Object.entries(serviceTypes)) {
            html += `<tr><td><code>${escapeHtml(key)}</code></td>`;
            html += `<td><input type="text" value="${escapeHtml(service.name)}" data-service="${key}" data-field="name" style="width: 200px;"></td>`;
            html += `<td><input type="text" value="${escapeHtml(service.description)}" data-service="${key}" data-field="description" style="width: 300px;"></td>`;
            html += `<td><button class="btn-delete" onclick="admin.deleteService('${escapeHtml(key)}')">Delete</button></td></tr>`;
        }
        html += '</tbody></table></div>';
        editor.innerHTML = html;
    }

    // Render batch operations editor
    renderBatchEditor() {
        const editor = document.getElementById('batch-editor');
        const data = this.getCurrentData();
        const serviceTypes = data.serviceTypes;
        
        let html = '<div style="background: #fff; padding: 32px; border-radius: 18px; box-shadow: 0 2px 16px rgba(0, 0, 0, 0.06);">';
        html += '<h3 style="margin-bottom: 24px;">Batch Price Update</h3>';
        html += '<div style="margin-bottom: 24px;">';
        html += '<label style="display: block; margin-bottom: 8px; font-weight: 600;">Select Service:</label>';
        html += '<select id="batchService" style="width: 100%; padding: 12px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 15px;">';
        html += '<option value="">-- Select Service --</option>';
        for (const [key, service] of Object.entries(serviceTypes)) {
            html += `<option value="${key}">${service.name}</option>`;
        }
        html += '</select></div>';
        
        html += '<div style="margin-bottom: 24px;">';
        html += '<label style="display: block; margin-bottom: 8px; font-weight: 600;">Operation:</label>';
        html += '<select id="batchOperation" style="width: 100%; padding: 12px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 15px;">';
        html += '<option value="set">Set to specific price</option>';
        html += '<option value="increase">Increase by amount</option>';
        html += '<option value="decrease">Decrease by amount</option>';
        html += '<option value="multiply">Multiply by percentage</option>';
        html += '</select></div>';
        
        html += '<div style="margin-bottom: 24px;">';
        html += '<label style="display: block; margin-bottom: 8px; font-weight: 600;">Value:</label>';
        html += '<input type="number" id="batchValue" placeholder="Enter value" style="width: 100%; padding: 12px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 15px;" min="0">';
        html += '</div>';
        
        html += '<button class="btn-save" onclick="admin.applyBatchUpdate()">Apply to All Models</button>';
        html += '<div class="success-message" id="batch-message" style="margin-top: 16px;">Batch update applied successfully!</div>';
        html += '</div>';
        
        editor.innerHTML = html;
    }

    // Save pricing with smart timestamp updates
    async savePricing() {
        const inputs = document.querySelectorAll('#pricing-editor input[type="number"]');
        const now = new Date().toISOString();
        const data = this.getCurrentData();

        inputs.forEach(input => {
            const modelKey = input.dataset.model;
            const serviceKey = input.dataset.service;
            const subKey = input.dataset.subkey;
            const newPrice = parseInt(input.value);
            if (isNaN(newPrice)) return;

            if (!data.models[modelKey].serviceUpdates) {
                data.models[modelKey].serviceUpdates = {};
            }

            if (subKey) {
                if (typeof data.models[modelKey].services[serviceKey] !== 'object') {
                    data.models[modelKey].services[serviceKey] = { compatible: 0, original: 0 };
                }
                const oldPrice = data.models[modelKey].services[serviceKey][subKey] ?? 0;
                if (newPrice !== oldPrice) {
                    data.models[modelKey].services[serviceKey][subKey] = newPrice;
                    data.models[modelKey].serviceUpdates[serviceKey] = now;
                }
            } else {
                const oldPrice = data.models[modelKey].services[serviceKey] ?? 0;
                if (newPrice !== oldPrice) {
                    data.models[modelKey].services[serviceKey] = newPrice;
                    data.models[modelKey].serviceUpdates[serviceKey] = now;
                }
            }
        });

        const ok = await this._saveToAPI();
        if (ok) this.showMessage('save-message');
    }

    // Save model names
    async saveModelNames() {
        const inputs = document.querySelectorAll('#models-editor input[type="text"]');
        const data = this.getCurrentData();
        
        inputs.forEach(input => {
            const modelKey = input.dataset.model;
            data.models[modelKey].name = input.value;
        });
        
        await this._saveToAPI();
        alert('Model names saved successfully!');
    }

    // Save services
    async saveServices() {
        const inputs = document.querySelectorAll('#services-editor input[type="text"]');
        const data = this.getCurrentData();
        
        inputs.forEach(input => {
            const serviceKey = input.dataset.service;
            const field = input.dataset.field;
            data.serviceTypes[serviceKey][field] = input.value;
        });
        
        await this._saveToAPI();
        this.showMessage('services-message');
    }

    // Add new model
    async addNewModel(modelId, modelName) {
        const data = this.getCurrentData();
        
        if (!modelId || !modelName) {
            alert('Please fill in all fields');
            return false;
        }
        
        if (data.models[modelId]) {
            alert('Model ID already exists');
            return false;
        }
        
        // Create default services for new model
        const services = {};
        const serviceUpdates = {};
        const now = new Date().toISOString();
        
        for (const key of Object.keys(data.serviceTypes)) {
            services[key] = 0;
            serviceUpdates[key] = now;
        }
        
        data.models[modelId] = {
            name: modelName,
            services: services,
            serviceUpdates: serviceUpdates,
            lastUpdated: now
        };
        
        await this._saveToAPI();
        this.renderModelsEditor();
        alert('Model added successfully!');
        return true;
    }

    // Delete model
    async deleteModel(modelKey) {
        const data = this.getCurrentData();
        
        if (confirm(`Are you sure you want to delete ${data.models[modelKey].name}?`)) {
            delete data.models[modelKey];
            await this._saveToAPI();
            this.renderModelsEditor();
            alert('Model deleted successfully!');
        }
    }

    // Add new service
    async addNewService(serviceId, serviceName, serviceDesc) {
        const data = this.getCurrentData();
        
        if (!serviceId || !serviceName) {
            alert('Please fill in Service ID and Name');
            return false;
        }
        
        if (data.serviceTypes[serviceId]) {
            alert('Service ID already exists');
            return false;
        }
        
        data.serviceTypes[serviceId] = {
            name: serviceName,
            description: serviceDesc || serviceName
        };
        
        // Add this service to all existing models with price 0
        const now = new Date().toISOString();
        for (const modelKey in data.models) {
            data.models[modelKey].services[serviceId] = 0;
            if (!data.models[modelKey].serviceUpdates) {
                data.models[modelKey].serviceUpdates = {};
            }
            data.models[modelKey].serviceUpdates[serviceId] = now;
        }
        
        await this._saveToAPI();
        this.renderServicesEditor();
        alert('Service added successfully!');
        return true;
    }

    // Delete service
    async deleteService(serviceKey) {
        const data = this.getCurrentData();
        
        if (confirm(`Are you sure you want to delete ${data.serviceTypes[serviceKey].name}? This will remove it from all models.`)) {
            delete data.serviceTypes[serviceKey];
            
            // Remove from all models
            for (const modelKey in data.models) {
                delete data.models[modelKey].services[serviceKey];
                if (data.models[modelKey].serviceUpdates) {
                    delete data.models[modelKey].serviceUpdates[serviceKey];
                }
            }
            
            await this._saveToAPI();
            this.renderServicesEditor();
            alert('Service deleted successfully!');
        }
    }

    // Apply batch update
    async applyBatchUpdate() {
        const serviceKey = document.getElementById('batchService').value;
        const operation = document.getElementById('batchOperation').value;
        const value = parseFloat(document.getElementById('batchValue').value);
        
        if (!serviceKey) {
            alert('Please select a service');
            return;
        }
        
        if (isNaN(value)) {
            alert('Please enter a valid value');
            return;
        }
        
        const data = this.getCurrentData();
        const now = new Date().toISOString();
        let count = 0;
        
        for (const modelKey in data.models) {
            const currentPrice = data.models[modelKey].services[serviceKey] || 0;
            let newPrice = currentPrice;
            
            switch (operation) {
                case 'set':
                    newPrice = value;
                    break;
                case 'increase':
                    newPrice = currentPrice + value;
                    break;
                case 'decrease':
                    newPrice = Math.max(0, currentPrice - value);
                    break;
                case 'multiply':
                    newPrice = Math.round(currentPrice * (value / 100));
                    break;
            }
            
            if (newPrice !== currentPrice) {
                data.models[modelKey].services[serviceKey] = newPrice;
                if (!data.models[modelKey].serviceUpdates) {
                    data.models[modelKey].serviceUpdates = {};
                }
                data.models[modelKey].serviceUpdates[serviceKey] = now;
                count++;
            }
        }
        
        await this._saveToAPI();
        this.showMessage('batch-message');
        alert(`Batch update applied to ${count} models!`);
        this.renderPricingEditor();
    }

    // Show success message
    showMessage(messageId) {
        const message = document.getElementById(messageId);
        if (message) {
            message.classList.add('show');
            setTimeout(() => message.classList.remove('show'), 3000);
        }
    }

    // Modal functions
    showModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) el.classList.add('show');
    }

    closeModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) el.classList.remove('show');
    }
}

// Helper function to format update time
function formatUpdateTime(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
            const diffMins = Math.floor(diffMs / (1000 * 60));
            return diffMins <= 1 ? 'Just now' : `${diffMins} mins ago`;
        }
        return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays <= 7) {
        return `${diffDays} days ago`;
    } else if (diffDays <= 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    } else {
        return date.toLocaleDateString();
    }
}
