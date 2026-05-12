require('dotenv').config();
const dns = require('dns');
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '1.1.1.1']); // Bypass local DNS that blocks MongoDB Atlas
}
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// ─── Security: Helmet (default security headers) ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow onclick handlers in HTML
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://techcross.ie", "https://www.techcross.ie", "http://localhost:*", "https://www.google-analytics.com", "https://www.googletagmanager.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ─── CORS: allow production domain + local dev ──────────────────────────────
app.use(cors({
  origin: [
    'https://techcross.ie',
    'https://www.techcross.ie',
    'https://teschcross-git-1045728849939.europe-west1.run.app',
    'http://localhost:8080',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Block access to sensitive application files when serving static assets.
app.use((req, res, next) => {
  const blockedFiles = [
    '.env', '.env.local', 'package.json', 'package-lock.json',
    'Dockerfile', 'docker-compose.yml', 'README.md', 'README', '.gitignore',
    'gitignore', '.gitmodules', 'config.json', 'trigger-config.yaml'
  ];
  const reqPath = path.normalize(req.path).replace(/\\/g, '/');
  const baseName = path.basename(reqPath);
  if (blockedFiles.includes(baseName) || reqPath.includes('/.git')) {
    return res.status(404).end();
  }
  next();
});

// ─── SaaS SPA: route /saas/* → saas/*.html (BEFORE static to avoid fallthrough)
const SAAS_PAGES = ['', 'login', 'register', 'dashboard', 'admin'];
app.use((req, res, next) => {
  const m = req.path.match(/^\/saas\/([a-z]*)$/);
  if (m && SAAS_PAGES.includes(m[1])) {
    return res.sendFile(path.join(__dirname, 'saas', (m[1] || 'index') + '.html'));
  }
  next();
});

app.use(express.static(path.join(__dirname), {
  dotfiles: 'deny',
  index: false
}));

// ─── SaaS API routes & SPA fallback ─────────────────────────

// Connect to MongoDB, then start listening
mongoose.connect(process.env.DBCon, { dbName: 'techcross' })
    .then(() => {
        console.log('✅ MongoDB connected');

        // Routes
        app.use('/api/pricing', require('./api/pricing'));
        app.use('/api/brands', require('./api/brands'));
        app.use('/api/reviews', require('./api/reviews'));
        app.use('/api/banner', require('./api/banner'));

        // Inventory & Till system routes
        app.use('/api/inv/auth', require('./api/inv/auth'));
        app.use('/api/inv/products', require('./api/inv/products'));
        app.use('/api/inv/stock', require('./api/inv/stock'));
        app.use('/api/inv/suppliers', require('./api/inv/suppliers'));
        app.use('/api/inv/purchases', require('./api/inv/purchases'));
        app.use('/api/inv/transactions', require('./api/inv/transactions'));
        app.use('/api/inv/reports', require('./api/inv/reports'));
        app.use('/api/inv/settings', require('./api/inv/settings'));
        app.use('/api/inv/invoices', require('./api/inv/invoices'));
        app.use('/api/inv/expenses', require('./api/inv/expenses'));
        app.use('/api/inv/close', require('./api/inv/close'));
        app.use('/api/inv/pos-shortcuts', require('./api/inv/pos-shortcuts'));
        app.use('/api/inv/root', require('./api/inv/root'));
        app.use('/api/inv/export', require('./api/inv/export'));
        app.use('/api/inv/root/export', require('./api/inv/root-export'));
        app.use('/api/inv/delivery', require('./api/inv/delivery'));
        app.use('/api/inv/whatsapp', require('./api/inv/whatsapp'));

        // ─── SaaS routes (separate from TechCross POS) ───────────────────────────
        app.use('/api/saas/auth', require('./api/saas/auth'));
        app.use('/api/saas/signup', require('./api/saas/signup'));
        app.use('/api/saas/stores', require('./api/saas/stores'));

        // ─── Public share routes (MUST be before the catch-all) ────────────────
        app.use('/share', require('./api/inv/share-public'));
        app.use('/api/share', require('./api/inv/share-public'));

        // ─── Global error handler ────────────────────────────────────────────
        app.use((err, req, res, next) => {
            console.error('Unhandled error:', err.message);
            const status = err.status || err.statusCode || 500;
            res.status(status).json({ error: err.message || 'Internal server error' });
        });

        // Fallback: serve index.html for all remaining non-API routes
        app.use((req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    })
    .catch(err => console.error('❌ MongoDB error:', err.message));
