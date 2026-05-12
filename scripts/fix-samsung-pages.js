const fs = require('fs');

function fixSamsungPage(filename, filterFn, sortFn) {
    let content = fs.readFileSync(filename, 'utf8');

    // Normalize line endings
    content = content.replace(/\r\n/g, '\n');

    // Remove the sync serviceTypes line
    content = content.replace(/\n\s*const serviceTypes = pricingData\[DEVICE_TYPE\]\.serviceTypes;\n/, '\n');

    // Remove the sync model population block (everything from "// Load" comment to the closing "}")
    content = content.replace(
        /\n\s*\/\/ Load[\s\S]*?for \(const \[key, model\] of modelEntries\) \{[\s\S]*?deviceModelSelect\.appendChild\(option\);\s*\}\s*\n/,
        '\n'
    );

    // Add initModels function after "let pricingData = null;"
    const initFn = filterFn + sortFn;
    content = content.replace(
        'let pricingData = null;\n',
        `let pricingData = null;\n\n        function initModels(data) {\n            window._serviceTypes = data[DEVICE_TYPE].serviceTypes;\n${initFn}        }\n`
    );

    // Add page-init.js before </body>
    if (!content.includes('page-init.js')) {
        content = content.replace('</body>', '<script src="/page-init.js"></script>\n</body>');
    }

    fs.writeFileSync(filename, content, 'utf8');
    console.log('Fixed:', filename);
}

// A-series
fixSamsungPage('pricing-samsung-a-series.html',
    `            const entries = Object.entries(data[DEVICE_TYPE].models).filter(([k]) => k.startsWith('a'));\n`,
    `            entries.sort((a,b) => parseInt(b[0].match(/\\d+/)?.[0]||0) - parseInt(a[0].match(/\\d+/)?.[0]||0));\n            for (const [key, model] of entries) { const o = document.createElement('option'); o.value=key; o.textContent=model.name; deviceModelSelect.appendChild(o); }\n`
);

// Note-Z series
fixSamsungPage('pricing-samsung-note-z.html',
    `            const entries = Object.entries(data[DEVICE_TYPE].models).filter(([k]) => k.startsWith('note')||k.startsWith('z-')||k.startsWith('fold')||k.startsWith('xcover'));\n`,
    `            entries.sort((a,b) => { const p={'xcover':1,'z-fold':2,'z-flip':3,'fold':4,'note':5}; const pa=Object.keys(p).find(x=>a[0].startsWith(x))||6; const pb=Object.keys(p).find(x=>b[0].startsWith(x))||6; if(pa!==pb)return p[pa]-p[pb]; return parseInt(b[0].match(/\\d+/)?.[0]||0)-parseInt(a[0].match(/\\d+/)?.[0]||0); });\n            for (const [key, model] of entries) { const o = document.createElement('option'); o.value=key; o.textContent=model.name; deviceModelSelect.appendChild(o); }\n`
);

console.log('All Samsung pages fixed!');
