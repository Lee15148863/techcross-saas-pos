const fs = require('fs');
const path = require('path');

const GA_TAG = `<!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-B76Y6PXQH7"><\/script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-B76Y6PXQH7');
    <\/script>`;

const dir = path.join(__dirname, '..');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.startsWith('admin') && !f.startsWith('announcement') && !f.startsWith('clear-cache') && !f.startsWith('test'));

let count = 0;
for (const f of files) {
    const fp = path.join(dir, f);
    let html = fs.readFileSync(fp, 'utf8');
    if (html.includes('G-B76Y6PXQH7')) continue;
    // Insert after <head> or after first <meta charset>
    if (html.includes('</head>')) {
        html = html.replace('</head>', GA_TAG + '\n</head>');
        fs.writeFileSync(fp, html);
        count++;
        console.log('Added GA to', f);
    }
}
console.log(`Done. Updated ${count} files.`);
