const fs = require('fs');

const adminBrands = {
    'admin-samsung.html': 'samsung',
    'admin-apple.html':   'apple',
    'admin-google.html':  'multi',
    'admin-honor.html':   'honor',
    'admin-huawei.html':  'huawei',
    'admin-oneplus.html': 'oneplus',
    'admin-oppo.html':    'oppo',
    'admin-other.html':   'other',
    'admin-xiaomi.html':  'xiaomi',
};

for (const [file, brand] of Object.entries(adminBrands)) {
    if (!fs.existsSync(file)) { console.log('SKIP:', file); continue; }
    let c = fs.readFileSync(file, 'utf8');

    // Add api-client.js before admin-enhanced-core.js (if not already there)
    if (!c.includes('api-client.js')) {
        c = c.replace(
            '<script src="admin-enhanced-core.js"></script>',
            '<script src="/api-client.js"></script>\n    <script src="admin-enhanced-core.js"></script>'
        );
    }

    // Add apiBrand to config if not already there
    if (!c.includes('apiBrand')) {
        c = c.replace(
            /brandName:\s*(['"][^'"]+['"])/,
            `brandName: $1,\n            apiBrand: '${brand}'`
        );
    }

    fs.writeFileSync(file, c, 'utf8');
    console.log('Updated:', file);
}
console.log('Done!');
