// Admin page functionality
const ADMIN_SESSION_KEY = 'techcross_admin_session';

// Check if user is logged in — supports inv system JWT admin
function checkAuth() {
    // Check session
    const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (session === 'authenticated') {
        showAdminPanel();
        return;
    }
    // Check if logged into inv system as admin
    try {
        const invUser = JSON.parse(localStorage.getItem('inv_user'));
        const invToken = localStorage.getItem('inv_token');
        if (invUser && invUser.role === 'root' && invToken) {
            sessionStorage.setItem(ADMIN_SESSION_KEY, 'authenticated');
            showAdminPanel();
            return;
        }
    } catch(e) {}
}

// Login handler — verify against inv system API
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const username = document.getElementById('usernameInput').value;
    const password = document.getElementById('passwordInput').value;

    try {
        const res = await fetch('/api/inv/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.token && data.user && data.user.role === 'root') {
            localStorage.setItem('inv_token', data.token);
            localStorage.setItem('inv_user', JSON.stringify(data.user));
            sessionStorage.setItem(ADMIN_SESSION_KEY, 'authenticated');
            showAdminPanel();
        } else {
            document.getElementById('loginError').classList.add('show');
            document.getElementById('usernameInput').value = '';
            document.getElementById('passwordInput').value = '';
            setTimeout(() => { document.getElementById('loginError').classList.remove('show'); }, 3000);
        }
    } catch(err) {
        document.getElementById('loginError').classList.add('show');
        setTimeout(() => { document.getElementById('loginError').classList.remove('show'); }, 3000);
    }
});

// Show admin panel
function showAdminPanel() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('adminNav').style.display = 'block';
    document.getElementById('adminContainer').classList.add('show');
}

// Logout
function logout() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    location.reload();
}

// Check authentication on page load
checkAuth();

let pricingData = loadPricingData();

// Tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        const tabName = this.dataset.tab;
        
        // Update active tab
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        // Update active content
        document.querySelectorAll('.admin-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');
    });
});

// Render pricing editor
function renderPricingEditor() {
    const editor = document.getElementById('pricing-editor');
    editor.innerHTML = '';

    const filterSection = document.createElement('div');
    filterSection.style.cssText = 'background: #f5f5f7; padding: 20px; border-radius: 12px; margin-bottom: 24px;';

    const filterRow = document.createElement('div');
    filterRow.style.cssText = 'display: flex; gap: 16px; align-items: center; flex-wrap: wrap;';

    const searchWrapper = document.createElement('div');
    searchWrapper.style.cssText = 'flex: 1; min-width: 200px;';
    const searchLabel = document.createElement('label');
    searchLabel.style.cssText = 'display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px;';
    searchLabel.textContent = 'Search Model';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'model-search';
    searchInput.placeholder = 'Type to search models...';
    searchInput.style.cssText = 'width: 100%; padding: 10px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 14px;';
    searchInput.addEventListener('input', filterModels);
    searchWrapper.appendChild(searchLabel);
    searchWrapper.appendChild(searchInput);

    const brandWrapper = document.createElement('div');
    const brandLabel = document.createElement('label');
    brandLabel.style.cssText = 'display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px;';
    brandLabel.textContent = 'Filter by Brand';
    const brandSelect = document.createElement('select');
    brandSelect.id = 'brand-filter';
    brandSelect.style.cssText = 'padding: 10px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 14px;';
    brandSelect.addEventListener('change', filterModels);
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'All Brands';
    brandSelect.appendChild(defaultOption);
    Object.entries(pricingData).forEach(([key, brand]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = brand.name;
        brandSelect.appendChild(option);
    });
    brandWrapper.appendChild(brandLabel);
    brandWrapper.appendChild(brandSelect);

    const buttonWrapper = document.createElement('div');
    buttonWrapper.style.cssText = 'margin-top: 24px;';
    const expandButton = document.createElement('button');
    expandButton.type = 'button';
    expandButton.textContent = 'Expand All';
    expandButton.style.cssText = 'padding: 10px 20px; background: #0071e3; color: white; border: none; border-radius: 8px; cursor: pointer; margin-right: 8px;';
    expandButton.addEventListener('click', expandAll);
    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.textContent = 'Collapse All';
    collapseButton.style.cssText = 'padding: 10px 20px; background: #6e6e73; color: white; border: none; border-radius: 8px; cursor: pointer;';
    collapseButton.addEventListener('click', collapseAll);
    buttonWrapper.appendChild(expandButton);
    buttonWrapper.appendChild(collapseButton);

    filterRow.appendChild(searchWrapper);
    filterRow.appendChild(brandWrapper);
    filterRow.appendChild(buttonWrapper);
    filterSection.appendChild(filterRow);
    editor.appendChild(filterSection);

    Object.entries(pricingData).forEach(([brandKey, brand]) => {
        const brandSection = document.createElement('div');
        brandSection.className = 'brand-section';
        brandSection.dataset.brand = brandKey;

        const modelCount = Object.keys(brand.models).length;
        const brandHeader = document.createElement('div');
        brandHeader.className = 'brand-header';

        const headerTitle = document.createElement('h3');
        headerTitle.textContent = brand.name + ' ';
        const countSpan = document.createElement('span');
        countSpan.style.cssText = 'font-size: 14px; color: #86868b; font-weight: normal;';
        countSpan.textContent = `(${modelCount} models)`;
        headerTitle.appendChild(countSpan);

        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'toggle-icon';
        toggleIcon.textContent = '▼';

        brandHeader.appendChild(headerTitle);
        brandHeader.appendChild(toggleIcon);

        const brandContent = document.createElement('div');
        brandContent.className = 'brand-content';

        brandHeader.addEventListener('click', function() {
            brandContent.classList.toggle('show');
            toggleIcon.textContent = brandContent.classList.contains('show') ? '▼' : '▶';
        });

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'pricing-table';
        tableWrapper.style.overflowX = 'auto';

        const table = document.createElement('table');
        table.style.minWidth = '2000px';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const thModel = document.createElement('th');
        thModel.style.cssText = 'position: sticky; left: 0; background: #1d1d1f; z-index: 10; min-width: 200px; color: white;';
        thModel.textContent = 'Model';
        headerRow.appendChild(thModel);

        Object.values(serviceTypes).forEach(service => {
            const th = document.createElement('th');
            th.style.minWidth = '120px';
            th.textContent = service.name;
            headerRow.appendChild(th);
        });

        const thAction = document.createElement('th');
        thAction.style.minWidth = '100px';
        thAction.textContent = 'Action';
        headerRow.appendChild(thAction);

        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        tbody.id = `tbody-${brandKey}`;
        table.appendChild(tbody);
        tableWrapper.appendChild(table);

        brandContent.appendChild(tableWrapper);
        brandSection.appendChild(brandHeader);
        brandSection.appendChild(brandContent);
        editor.appendChild(brandSection);

        Object.entries(brand.models).forEach(([modelKey, model]) => {
            const row = document.createElement('tr');
            row.dataset.modelKey = modelKey;
            row.dataset.modelName = model.name.toLowerCase();

            const tdModel = document.createElement('td');
            tdModel.style.cssText = 'position: sticky; left: 0; background: #fff; z-index: 5;';
            const nameStrong = document.createElement('strong');
            nameStrong.id = `model-name-${brandKey}-${modelKey}`;
            nameStrong.textContent = model.name;
            tdModel.appendChild(nameStrong);

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.style.cssText = 'margin-left: 8px; color: #0071e3; background: none; border: none; cursor: pointer; font-size: 12px;';
            editButton.textContent = '✏️ Edit';
            editButton.addEventListener('click', function() {
                editModelName(brandKey, modelKey);
            });
            tdModel.appendChild(editButton);

            const lastUpdatedText = document.createElement('div');
            lastUpdatedText.style.cssText = 'font-size: 11px; color: #86868b; margin-top: 4px;';
            lastUpdatedText.textContent = model.lastUpdated ? `Last updated: ${new Date(model.lastUpdated).toLocaleString('en-IE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'N/A';
            tdModel.appendChild(lastUpdatedText);
            row.appendChild(tdModel);

            Object.keys(serviceTypes).forEach(serviceKey => {
                const price = model.services[serviceKey] || 0;
                const td = document.createElement('td');
                const input = document.createElement('input');
                input.type = 'number';
                input.value = price;
                input.dataset.brand = brandKey;
                input.dataset.model = modelKey;
                input.dataset.service = serviceKey;

                if (serviceKey === 'network_unlock') {
                    input.disabled = true;
                    input.style.cssText = 'background: #f5f5f7; cursor: not-allowed;';
                }

                td.appendChild(input);
                row.appendChild(td);
            });

            const actionTd = document.createElement('td');
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = 'Delete';
            deleteButton.style.cssText = 'color: #ff3b30; background: none; border: none; cursor: pointer; font-size: 14px;';
            deleteButton.addEventListener('click', function() {
                deleteModel(brandKey, modelKey);
            });
            actionTd.appendChild(deleteButton);
            row.appendChild(actionTd);
            tbody.appendChild(row);
        });
    });
}

// Filter models based on search and brand filter
function filterModels() {
    const searchTerm = document.getElementById('model-search').value.toLowerCase();
    const brandFilter = document.getElementById('brand-filter').value;
    
    document.querySelectorAll('.brand-section').forEach(section => {
        const brandKey = section.dataset.brand;
        const shouldShowBrand = !brandFilter || brandKey === brandFilter;
        
        if (!shouldShowBrand) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        const tbody = section.querySelector('tbody');
        let visibleCount = 0;
        
        tbody.querySelectorAll('tr').forEach(row => {
            const modelName = row.dataset.modelName;
            const matches = !searchTerm || modelName.includes(searchTerm);
            row.style.display = matches ? '' : 'none';
            if (matches) visibleCount++;
        });
        
        // Auto-expand if filtered
        if (searchTerm || brandFilter) {
            const content = section.querySelector('.brand-content');
            content.classList.add('show');
            section.querySelector('.toggle-icon').textContent = '▼';
        }
    });
}

// Expand all brand sections
function expandAll() {
    document.querySelectorAll('.brand-content').forEach(content => {
        content.classList.add('show');
    });
    document.querySelectorAll('.toggle-icon').forEach(icon => {
        icon.textContent = '▼';
    });
}

// Collapse all brand sections
function collapseAll() {
    document.querySelectorAll('.brand-content').forEach(content => {
        content.classList.remove('show');
    });
    document.querySelectorAll('.toggle-icon').forEach(icon => {
        icon.textContent = '▶';
    });
}

// Save pricing changes
function savePricing() {
    const inputs = document.querySelectorAll('#pricing-editor input[type="number"]');
    
    inputs.forEach(input => {
        const brand = input.dataset.brand;
        const model = input.dataset.model;
        const service = input.dataset.service;
        const newValue = parseInt(input.value) || 0;
        
        if (pricingData[brand]?.models[model]?.services) {
            const oldValue = pricingData[brand].models[model].services[service];
            
            // Only update timestamp if the price actually changed
            if (oldValue !== newValue) {
                pricingData[brand].models[model].services[service] = newValue;
                pricingData[brand].models[model].lastUpdated = new Date().toISOString();
            }
        }
    });
    
    savePricingData(pricingData);
    
    const message = document.getElementById('save-message');
    message.classList.add('show');
    setTimeout(() => message.classList.remove('show'), 3000);
    
}

// Add new model
function addNewModel() {
    const brand = document.getElementById('new-brand').value;
    const modelId = document.getElementById('new-model-id').value.trim();
    const modelName = document.getElementById('new-model-name').value.trim();
    
    if (!modelId || !modelName) {
        alert('Please fill in Model ID and Model Name');
        return;
    }
    
    if (pricingData[brand].models[modelId]) {
        alert('This model ID already exists');
        return;
    }
    
    const services = {};
    for (const serviceKey in serviceTypes) {
        const input = document.getElementById(`new-${serviceKey}`);
        if (input) {
            services[serviceKey] = parseInt(input.value) || 0;
        }
    }
    
    pricingData[brand].models[modelId] = {
        name: modelName,
        services: services,
        lastUpdated: new Date().toISOString()
    };
    
    savePricingData(pricingData);
    renderPricingEditor();
    
    // Clear form
    document.getElementById('new-model-id').value = '';
    document.getElementById('new-model-name').value = '';
    
    const message = document.getElementById('add-message');
    message.classList.add('show');
    setTimeout(() => message.classList.remove('show'), 3000);
    
}

// Render service inputs for new model form
function renderNewModelServices() {
    const container = document.getElementById('new-model-services');
    container.innerHTML = '';

    Object.entries(serviceTypes).forEach(([key, service]) => {
        const div = document.createElement('div');
        div.className = 'form-group';

        const label = document.createElement('label');
        label.textContent = service.name;

        const input = document.createElement('input');
        input.type = 'number';
        input.id = `new-${key}`;
        input.value = key === 'network_unlock' ? 9999 : (key.includes('screen') && key !== 'screen_compatible' ? 0 : 99);
        if (key === 'network_unlock') {
            input.disabled = true;
        }

        div.appendChild(label);
        div.appendChild(input);
        container.appendChild(div);
    });
}

// Render brand select dropdown
function renderBrandSelect() {
    const select = document.getElementById('new-brand');
    select.innerHTML = '';
    
    for (const brandKey in pricingData) {
        const option = document.createElement('option');
        option.value = brandKey;
        option.textContent = pricingData[brandKey].name;
        select.appendChild(option);
    }
}

// Render current brands list
function renderCurrentBrands() {
    const container = document.getElementById('current-brands-list');
    container.innerHTML = '';

    Object.entries(pricingData).forEach(([key, brand]) => {
        const modelCount = Object.keys(brand.models).length;
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f5f5f7;';

        const brandInfo = document.createElement('div');
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = brand.name;
        const infoP = document.createElement('p');
        infoP.style.cssText = 'font-size: 12px; color: #6e6e73; margin: 4px 0 0 0;';
        infoP.textContent = `${modelCount} models`;
        brandInfo.appendChild(nameStrong);
        brandInfo.appendChild(infoP);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.style.cssText = 'color: #ff3b30; background: none; border: none; cursor: pointer; font-size: 14px; padding: 8px 16px;';
        if (['apple', 'samsung', 'xiaomi', 'other'].includes(key)) {
            deleteButton.disabled = true;
            deleteButton.style.opacity = '0.3';
            deleteButton.style.cursor = 'not-allowed';
        } else {
            deleteButton.addEventListener('click', function() {
                deleteBrand(key);
            });
        }

        div.appendChild(brandInfo);
        div.appendChild(deleteButton);
        container.appendChild(div);
    });
}

// Add new brand
function addNewBrand() {
    const brandId = document.getElementById('new-brand-id').value.trim().toLowerCase();
    const brandName = document.getElementById('new-brand-name').value.trim();
    
    if (!brandId || !brandName) {
        alert('Please fill in all fields');
        return;
    }
    
    if (pricingData[brandId]) {
        alert('This brand ID already exists');
        return;
    }
    
    // Add new brand with empty models
    pricingData[brandId] = {
        name: brandName,
        models: {}
    };
    
    savePricingData(pricingData);
    renderPricingEditor();
    renderBrandSelect();
    renderCurrentBrands();
    
    // Clear form
    document.getElementById('new-brand-id').value = '';
    document.getElementById('new-brand-name').value = '';
    
    const message = document.getElementById('brand-message');
    message.classList.add('show');
    setTimeout(() => message.classList.remove('show'), 3000);
    
}

// Delete brand
function deleteBrand(brandKey) {
    const coreBrands = ['apple', 'samsung', 'xiaomi', 'other'];
    if (coreBrands.includes(brandKey)) {
        alert('Cannot delete core brands');
        return;
    }
    
    const modelCount = Object.keys(pricingData[brandKey].models).length;
    if (!confirm(`Are you sure you want to delete "${pricingData[brandKey].name}"? This will delete ${modelCount} models.`)) {
        return;
    }
    
    delete pricingData[brandKey];
    savePricingData(pricingData);
    renderPricingEditor();
    renderBrandSelect();
    renderCurrentBrands();
    
}

// Edit model name
function editModelName(brandKey, modelKey) {
    const currentName = pricingData[brandKey].models[modelKey].name;
    const newName = prompt('Enter new model name:', currentName);
    
    if (newName && newName.trim() && newName !== currentName) {
        pricingData[brandKey].models[modelKey].name = newName.trim();
        pricingData[brandKey].models[modelKey].lastUpdated = new Date().toISOString();
        savePricingData(pricingData);
        
        // Update display
        document.getElementById(`model-name-${brandKey}-${modelKey}`).textContent = newName.trim();
        
        }
}

// Render current services list
function renderCurrentServices() {
    const container = document.getElementById('current-services-list');
    container.innerHTML = '';

    Object.entries(serviceTypes).forEach(([key, service]) => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f5f5f7;';

        const infoWrapper = document.createElement('div');
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = service.name;
        const descP = document.createElement('p');
        descP.style.cssText = 'font-size: 12px; color: #6e6e73; margin: 4px 0 0 0;';
        descP.textContent = service.description;
        infoWrapper.appendChild(nameStrong);
        infoWrapper.appendChild(descP);

        if (key === 'network_unlock') {
            const note = document.createElement('span');
            note.style.cssText = 'font-size: 11px; color: #ff3b30;';
            note.textContent = 'Fixed price (contact required)';
            infoWrapper.appendChild(note);
        }

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.style.cssText = 'color: #ff3b30; background: none; border: none; cursor: pointer; font-size: 14px; padding: 8px 16px;';
        if (key === 'network_unlock') {
            deleteButton.disabled = true;
            deleteButton.style.opacity = '0.3';
            deleteButton.style.cursor = 'not-allowed';
        } else {
            deleteButton.addEventListener('click', function() {
                deleteService(key);
            });
        }

        div.appendChild(infoWrapper);
        div.appendChild(deleteButton);
        container.appendChild(div);
    });
}

// Add new service type
function addNewService() {
    const serviceId = document.getElementById('new-service-id').value.trim();
    const serviceName = document.getElementById('new-service-name').value.trim();
    const serviceDesc = document.getElementById('new-service-desc').value.trim();
    
    if (!serviceId || !serviceName || !serviceDesc) {
        alert('Please fill in all fields');
        return;
    }
    
    if (serviceTypes[serviceId]) {
        alert('This service ID already exists');
        return;
    }
    
    // Add to serviceTypes
    serviceTypes[serviceId] = {
        name: serviceName,
        description: serviceDesc
    };
    
    // Add this service to all existing models with default price 9999
    for (const brand in pricingData) {
        for (const modelKey in pricingData[brand].models) {
            pricingData[brand].models[modelKey].services[serviceId] = 9999;
            pricingData[brand].models[modelKey].lastUpdated = new Date().toISOString();
        }
    }
    
    savePricingData(pricingData);
    renderPricingEditor();
    renderNewModelServices();
    renderCurrentServices();
    
    // Clear form
    document.getElementById('new-service-id').value = '';
    document.getElementById('new-service-name').value = '';
    document.getElementById('new-service-desc').value = '';
    
    const message = document.getElementById('service-message');
    message.classList.add('show');
    setTimeout(() => message.classList.remove('show'), 3000);
    
}

// Delete service type
function deleteService(serviceKey) {
    if (serviceKey === 'network_unlock') {
        alert('Cannot delete network unlock service');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete "${serviceTypes[serviceKey].name}"? This will remove it from all models.`)) {
        return;
    }
    
    // Remove from serviceTypes
    delete serviceTypes[serviceKey];
    
    // Remove from all models
    for (const brand in pricingData) {
        for (const modelKey in pricingData[brand].models) {
            delete pricingData[brand].models[modelKey].services[serviceKey];
            pricingData[brand].models[modelKey].lastUpdated = new Date().toISOString();
        }
    }
    
    savePricingData(pricingData);
    renderPricingEditor();
    renderNewModelServices();
    renderCurrentServices();
    
}

// Delete model
function deleteModel(brand, modelKey) {
    if (confirm('Are you sure you want to delete this model?')) {
        delete pricingData[brand].models[modelKey];
        savePricingData(pricingData);
        renderPricingEditor();
    }
}

// Initialize
renderPricingEditor();
renderBrandSelect();
renderNewModelServices();
renderCurrentBrands();
renderCurrentServices();
