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
const DOMAIN = process.env.DOMAIN || 'techcross.ie';

// ─── Security: Helmet (default security headers) ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow onclick handlers in HTML
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", `https://${DOMAIN}`, `https://www.${DOMAIN}`, "http://localhost:*", "https://teschcross-git-1045728849939.europe-west1.run.app", "https://www.google-analytics.com", "https://www.googletagmanager.com"],
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
    `https://${DOMAIN}`,
    `https://www.${DOMAIN}`,
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

// ─── Health endpoint (lightweight, no DB queries, always available) ─────────
// Registered at app level, BEFORE all SPA/static/catch-all middleware,
// so it always returns JSON regardless of MongoDB state.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongo: mongoose.connection.readyState,
    version: process.env.APP_VERSION || '',
    revision: process.env.K_REVISION || '',
    readonlyFrozen: process.env.STORE_FROZEN === 'true',
    uptime: process.uptime()
  });
});

// ─── SaaS SPA: route /saas/* → saas/*.html (BEFORE static to avoid fallthrough)
const SAAS_PAGES = ['', 'login', 'register', 'dashboard', 'admin', 'admin-deployments'];
app.use((req, res, next) => {
  const m = req.path.match(/^\/saas\/([a-z-]*)$/);
  if (m && SAAS_PAGES.includes(m[1])) {
    return res.sendFile(path.join(__dirname, 'saas', (m[1] || 'index') + '.html'));
  }
  next();
});

app.use(express.static(path.join(__dirname), {
  dotfiles: 'deny',
  index: false
}));

// ─── HTML template variable injection ────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const original = res.send.bind(res);
    res.send = function(body) {
      if (typeof body === 'string') {
        body = body
          .replace(/__DOMAIN__/g, DOMAIN)
          .replace(/__GA_ID__/g, process.env.GOOGLE_ANALYTICS_ID || '')
          .replace(/__PRINT_AGENT_URL__/g, process.env.PRINT_AGENT_URL || 'http://localhost:9100')
          .replace(/__YEAR__/g, String(new Date().getFullYear()))
          .replace(/__COMPANY_NAME__/g, process.env.COMPANY_NAME || 'TechCross Repair Centre')
          .replace(/__COMPANY_LOCATION__/g, process.env.COMPANY_ADDRESS || 'Navan, Co. Meath, Ireland')
          .replace(/__COMPANY_EMAIL__/g, process.env.COMPANY_EMAIL || 'info@example.com')
          .replace(/__VAT_NUMBER__/g, process.env.VAT_NUMBER || 'IE3330982OH')
          .replace(/__FB_PAGE__/g, process.env.FACEBOOK_PAGE || 'techcrossnavan');
      }
      return original(body);
    };
  }
  next();
});

// ─── SaaS API routes & SPA fallback ─────────────────────────

// Connect to MongoDB, then start listening
mongoose.connect(process.env.DBCon || process.env.MONGO_URI, { dbName: process.env.STORE_NAME || 'techcross' })
    .then(() => {
        console.log('✅ MongoDB connected');

        // Routes
        app.use('/api/pricing', require('./api/pricing'));
        app.use('/api/brands', require('./api/brands'));
        app.use('/api/reviews', require('./api/reviews'));
        app.use('/api/banner', require('./api/banner'));

        // Inventory & Till system routes
        // Read-only freeze gate — blocks writes when STORE_FROZEN env var is 'true'
        app.use('/api/inv', function(req, res, next) {
          if (process.env.STORE_FROZEN === 'true' && ['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(req.method) !== -1) {
            return res.status(403).json({ error: 'STORE_FROZEN_READONLY', message: 'System is in read-only mode.' });
          }
          next();
        });
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
	        app.use('/api/saas/deployments', require('./api/saas/deployments'));

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
