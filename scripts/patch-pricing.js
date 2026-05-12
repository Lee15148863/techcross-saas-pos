const fs = require('fs');
let html = fs.readFileSync('pricing.html', 'utf8');

// 1. Add model-grid CSS before </style>
const gridCSS = `
        /* Model grid */
        .model-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(175px,1fr)); gap:12px; margin-bottom:24px; }
        .model-card { background:#fff; border:1.5px solid #e5e5ea; border-radius:14px; padding:18px 14px; cursor:pointer; transition:all .2s; text-align:center; }
        .model-card:hover { border-color:#0071e3; background:#f0f7ff; transform:translateY(-2px); box-shadow:0 4px 16px rgba(0,113,227,.1); }
        .model-card.active { border-color:#0071e3; background:#e8f0fe; }
        .model-card .model-name { font-size:13px; font-weight:700; color:#1d1d1f; line-height:1.4; margin-bottom:4px; }
        .model-card .model-meta { font-size:11px; color:#86868b; }
        .model-expand { grid-column:1/-1; background:#f5f5f7; border:1.5px solid #0071e3; border-radius:14px; overflow:hidden; animation:expandIn .2s ease; }
        @keyframes expandIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .expand-header { padding:14px 20px 10px; font-size:15px; font-weight:700; color:#1d1d1f; border-bottom:1px solid #e5e5ea; display:flex; align-items:center; justify-content:space-between; }
        .expand-close { background:none; border:none; cursor:pointer; font-size:18px; color:#86868b; line-height:1; }
        .expand-close:hover { color:#1d1d1f; }
`;
html = html.replace('    </style>', gridCSS + '    </style>');

// 2. Replace the entire old selectType + toggleModel + renderIssues block
// Find the start marker
const startMarker = '// ── Step 3: Model list ──────────────────────────────────';
const endMarker = 'init();';

const startIdx = html.indexOf(startMarker);
const endIdx = html.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
    console.error('Could not find markers. startIdx:', startIdx, 'endIdx:', endIdx);
    process.exit(1);
}

const newFunctions = `// ── Step 3: Model grid ──────────────────────────────────
function selectType(brandId, typeId) {
    currentBrand = brandId;
    openModel = null;
    const brand = allBrands[brandId];
    const type  = brand.types[typeId];
    const models = Object.entries(type.models || {});

    const bookBar = \`
        <div class="book-bar">
            <p>Ready to book your repair?</p>
            <div class="actions">
                <a href="index.html#contact" class="btn-primary">Book Repair</a>
                <a href="https://wa.me/353894825300?text=Hi%20I%20need%20phone%20repair%20in%20Navan" target="_blank" rel="noopener"
                   style="display:inline-flex;align-items:center;gap:8px;background:#25d366;color:#fff;padding:12px 24px;border-radius:980px;font-size:15px;font-weight:600;text-decoration:none;">
                    WhatsApp Us
                </a>
            </div>
        </div>\`;

    if (models.length === 0) {
        app.innerHTML = \`
            <button class="section-back" onclick="selectBrand('\${brandId}')">← \${brand.name}</button>
            <div class="section-title">\${type.name}</div>
            <div class="empty">No models listed yet.</div>\${bookBar}\`;
        return;
    }

    app.innerHTML = \`
        <button class="section-back" onclick="selectBrand('\${brandId}')">← \${brand.name}</button>
        <div class="section-title">\${type.name}</div>
        <div class="model-grid" id="modelGrid">
            \${models.map(([mid, model]) => {
                const ic = Object.values(model.issues||{}).filter(v=>v.price!==-1).length;
                return \`<div class="model-card" id="mc-\${mid}" onclick="toggleModel('\${typeId}','\${mid}')">
                    <div class="model-name">\${model.name}</div>
                    <div class="model-meta">\${ic} service\${ic!==1?'s':''}</div>
                </div>\`;
            }).join('')}
        </div>
        \${bookBar}\`;

    app.dataset.typeId = typeId;
}

// ── Step 4: Inline expand ────────────────────────────────
function toggleModel(typeId, modelId) {
    const card = document.getElementById(\`mc-\${modelId}\`);
    const existing = document.getElementById('expandPanel');
    if (existing) existing.remove();

    if (openModel === modelId) {
        card.classList.remove('active');
        openModel = null;
        return;
    }

    if (openModel) {
        const prev = document.getElementById(\`mc-\${openModel}\`);
        if (prev) prev.classList.remove('active');
    }

    card.classList.add('active');
    openModel = modelId;

    const panel = document.createElement('div');
    panel.className = 'model-expand';
    panel.id = 'expandPanel';
    panel.innerHTML = buildIssuesHTML(typeId, modelId);
    card.after(panel);
    setTimeout(() => panel.scrollIntoView({ behavior:'smooth', block:'nearest' }), 50);
}

function closeExpand() {
    const panel = document.getElementById('expandPanel');
    if (panel) panel.remove();
    if (openModel) {
        const card = document.getElementById(\`mc-\${openModel}\`);
        if (card) card.classList.remove('active');
    }
    openModel = null;
}

function buildIssuesHTML(typeId, modelId) {
    const model = allBrands[currentBrand].types[typeId].models[modelId];
    const issues = Object.entries(model.issues || {}).filter(([,v]) => v.price !== -1);
    const rows = issues.length === 0
        ? \`<tr><td colspan="2" style="text-align:center;color:#86868b;padding:20px;">No services listed. Please contact us.</td></tr>\`
        : issues.map(([, issue]) => \`
            <tr>
                <td>\${issue.name}</td>
                <td class="price-cell">\${issue.price === 0 ? '<span class="price-contact">Contact Us</span>' : '€' + issue.price}</td>
            </tr>\`).join('');
    return \`
        <div class="expand-header">
            <span>\${model.name}</span>
            <button class="expand-close" onclick="closeExpand()">✕</button>
        </div>
        <table class="issues-table">
            <thead><tr><th>Service</th><th style="text-align:right;">Price</th></tr></thead>
            <tbody>\${rows}</tbody>
        </table>\`;
}

`;

html = html.slice(0, startIdx) + newFunctions + endMarker + html.slice(endIdx + endMarker.length);

fs.writeFileSync('pricing.html', html, 'utf8');
console.log('✅ pricing.html patched successfully');
