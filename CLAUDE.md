# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Tech Cross Repair Centre is a dual-system project:
1. **Public website** — static repair shop portal (HTML/CSS/JS, deployed via GitHub Pages)
2. **POS + ERP system** — internal inventory, till, and financial system (Node.js/Express/MongoDB backend + HTML/JS frontend, deployed via Docker/Cloud Run)

The business is a real phone/electronics repair shop in Navan, Ireland. The POS/ERP handles Irish VAT compliance (23% standard, 13.5% services, margin VAT on second-hand goods).

## Architecture: 3-Layer System

Per SYSTEM_SPEC.md and RUNBOOK.md, the system has strict layer separation:

- **L1 — UI Layer**: HTML pages + frontend JS (no business logic, no calculations, no VAT)
- **L2 — Service Layer**: `services/` — all VAT calculations, transaction creation, refund logic, cash ledger writes
- **L3 — Financial Core**: `utils/inv-integrity-layer.js`, model-level pre-save hooks — immutability enforcement, audit rules, transaction integrity

L2 + L3 are the ONLY places that may touch financial data. Frontend must never calculate VAT or totals.

## Project Structure

```
/
├── index.html                    # Public website homepage
├── styles.css                    # Global styles
├── script.js                     # Public website JS
├── lang.js                       # EN/ZH bilingual system (Boss panel)
├── server.js                     # Express entry point (port 8080)
├── package.json                  # Dependencies: express, mongoose, bcryptjs, jsonwebtoken, etc.
├── Dockerfile                    # Node 20 Alpine container image
├── cloudbuild.yaml               # GCP Cloud Build → Artifact Registry → Cloud Run
├── .github/workflows/pages.yml   # GitHub Actions → GitHub Pages (static site)
│
├── api/                          # Express route handlers
│   ├── pricing.js                # Pricing data CRUD (per brand)
│   ├── brands.js                 # Brand listing
│   ├── reviews.js                # Customer reviews
│   └── inv/                      # POS/ERP API endpoints
│       ├── auth.js               # JWT login/logout
│       ├── products.js           # Product catalog CRUD
│       ├── stock.js              # Stock movements
│       ├── transactions.js       # Transaction listing/delete
│       ├── expenses.js           # Business expenses
│       ├── close.js              # Daily close
│       ├── invoices.js           # VAT invoice generation
│       ├── reports.js            # Monthly reports
│       ├── settings.js           # System settings
│       ├── pos-shortcuts.js      # POS shortcut configuration
│       ├── root.js               # Root-level emergency operations
│       ├── whatsapp.js           # WhatsApp messaging
│       └── ...                   # suppliers, purchases, delivery, share-public, export
│
├── models/                       # Mongoose schemas
│   ├── Brand.js, Pricing.js, Review.js
│   └── inv/                      # POS/ERP models (24 models)
│       ├── Transaction.js        # Sale/refund records (pre-save integrity hooks)
│       ├── CashLedger.js         # IMMUTABLE — append-only money movement
│       ├── Product.js            # Inventory items
│       ├── Device.js             # Second-hand device lifecycle
│       ├── DailyClose.js         # Daily snapshots (PENDING → CLOSED, immutable)
│       ├── MonthlyReport.js      # Tax reporting snapshots
│       ├── User.js               # Staff/manager/root accounts
│       ├── AuditLog.js           # All root actions logged
│       └── ...                   # Supplier, PurchaseOrder, StockMovement, Invoice, etc.
│
├── services/                     # L2 Business logic (single source of truth)
│   ├── inv-checkout-service.js   # Sale checkout (atomic Transaction + CashLedger)
│   ├── inv-refund-service.js     # Refund processing
│   ├── inv-daily-close-service.js
│   ├── inv-query-service.js
│   ├── inv-receipt-delivery-service.js
│   ├── inv-invoice-delivery-service.js
│   └── ...
│
├── utils/                        # L3 Financial core + utility modules
│   ├── inv-integrity-layer.js    # Authorization tokens for financial operations
│   ├── inv-vat-calculator.js     # 23%/13.5%/margin VAT computation
│   ├── inv-discount-calculator.js
│   ├── inv-receipt-generator.js  # Receipt data structure for printing
│   ├── inv-receipt-number.js     # YYYYMMDDHHmmss receipt numbers
│   ├── inv-reconciliation.js     # Cash/transaction matching
│   ├── inv-system-lock.js        # Emergency system pause
│   └── inv-validators.js         # Input validation helpers
│
├── middleware/
│   └── inv-auth.js               # JWT + role/permission middleware
│
├── auth-guard.js                 # Frontend auth module (JWT from localStorage)
├── inv-common.js                 # Frontend common: auth check, API fetch, toast
├── api-client.js                 # PricingAPI frontend client
├── admin-enhanced-core.js        # Base class for brand admin UIs
├── page-init.js                  # Async pricing page loader
│
├── inv-pos.html                  # Main POS/till page (largest: 171KB)
├── inv-login.html                # Login page
├── boss.html + boss.js           # Root control panel
├── boss-audit.html + .js         # Audit log viewer
├── admin.html + admin.js         # Website admin dashboard
├── admin-{brand}.html            # Per-brand pricing admin pages (apple, samsung, etc.)
├── admin-brands.html             # Multi-brand pricing editor
├── admin-reviews.html            # Customer review management
├── inv-*.html                    # Inventory/ERP pages (products, stock, suppliers, etc.)
├── announcement-admin.html/.js   # Announcement management
├── whatsapp-center.html/.js      # WhatsApp customer communication
├── find-model.html               # Model lookup tool
├── pricing.html                  # Public pricing page
├── computer-pricing.html         # Computer/laptop pricing
├── data-transfer.html            # Data transfer service page
├── share-*.html                  # Public invoice/receipt share pages
├── shop-coming-soon.html         # Coming soon page
│
├── print-agent/                  # Local thermal printer agent (Node.js)
│   └── README.md                 # Full setup docs for ESC/POS 80mm printer
├── print-agent-universal/        # Alternative print agent
│
├── tests/
│   ├── unit/                     # Unit tests (vitest)
│   │   ├── inv-vat-calculator.test.js
│   │   ├── inv-validators.test.js
│   │   ├── inv-receipt-generator.test.js
│   │   ├── inv-discount-calculator.test.js
│   │   ├── inv-reconciliation.test.js
│   │   ├── inv-auth*.test.js
│   │   └── *-routes.test.js      # Route integration tests
│   └── integration/              # E2E / stress tests
│       ├── inv-checkout-e2e.test.js
│       ├── inv-system-audit.test.js
│       └── inv-system-stress.test.js
│
├── scripts/                      # Seed/migration/admin scripts
│   ├── seed.js                   # Main DB seeder
│   ├── bootstrap-users.js        # Create initial admin user
│   └── ...
│
├── Data/apple.csv                # Seed data
├── DEPLOYMENT_SAFETY_RULES.md    # Deployment safety protocol (read this first)
├── SYSTEM_SPEC.md                # Full system specification (read for financial rules)
├── RUNBOOK.md                    # AI development protocol for L1/L2/L3 layers
├── SOFT_FREEZE_POLICY.md         # Code freeze policies
└── REQUIREMENTS_SUMMARY.md       # Requirements breakdown
```

## Common Commands

```bash
# Start dev server
npm start              # or: npm run dev  (same: node server.js)
# Requires .env with DBCon (MongoDB), INV_JWT_SECRET, SMTP_* etc.

# Run all tests
npm test               # vitest --run

# Run a single test file
npx vitest --run tests/unit/inv-vat-calculator.test.js

# Seed database
npm run seed           # node scripts/seed.js

# Bootstrap initial admin user
node scripts/bootstrap-users.js

# Local static server (for testing public website only)
npx http-server -p 8000
```

## Key Business Rules

- **VAT**: 23% products, 13.5% services, margin VAT (salePrice - buyPrice) × rate for second-hand
- **CashLedger**: IMMUTABLE — never edited or deleted, append-only
- **DailyClose**: OPEN → PENDING → CLOSED (immutable once confirmed)
- **Transactions**: deletable by root only, blocked if invoice generated, blocked if day CLOSED (unless month already reported)
- **User roles**: STAFF < MANAGER < ROOT (hierarchical, each inherits below)
- **Inventory**: reference only — never blocks a sale, stock can go negative
- **Devices**: immutable assets — buy → pending → tested → sold lifecycle, never deleted

## Hidden Boss Account

- **Lee087** is the hidden super-admin (boss) account — invisible in the user list, undeletable, undisableable
- Defined in `models/inv/User.js` via `SYSTEM_ROOTS` and enforced by the `boss: true` field
- `boss: true` is automatically set in the pre-save hook for SYSTEM_ROOTS usernames
- The user listing API (`GET /api/inv/auth/users`) filters out `{ boss: { $ne: true } }`
- DELETE and DISABLE endpoints reject operations on boss accounts
- Bootstrap script (`scripts/bootstrap-users.js`) creates Lee087 with `boss: true`
- Only one boss account exists — hard-coded as `['Lee087']` in the model

## SaaS System (Separate Layer)

A **new standalone SaaS onboarding layer** for future external store owners, completely separate from current TechCross POS.

### Routes
| Path | Page |
|------|------|
| `/saas/` | Landing page — features, pricing, CTAs |
| `/saas/login` | Store owner login (separate from TechCross login) |
| `/saas/register` | Store signup request form |
| `/api/saas/auth/login` | SaaS auth (JWT) |
| `/api/saas/signup` | Store registration (pending approval) |
| `/api/saas/stores` | Super admin store management |

### Permission Hierarchy
```
super_admin    ← Lee087 (new role, above root)
     ↑
store_root     ← Future store owners (each controls only their store)
     ↑
manager
     ↑
staff
```

### Super Admin (Lee087)
- Created via `scripts/bootstrap-saas.js` or API bootstrap
- Can: create/approve/reject/suspend stores, access all stores, impersonate store owners
- Stored in `SaaSUser` collection (separate from POS `InvUser`)

### Key Separation
- SaaS users (`models/saas/SaaSUser`) are in a **separate MongoDB collection** from POS users
- SaaS routes are under `/api/saas/*`, distinct from `/api/inv/*`
- Existing TechCross login, POS, and financial core are **untouched**

## Critical Constraints

- NEVER modify VAT logic, invoice calculations, financial workflows, or accounting structure without **triple confirmation** (see DEPLOYMENT_SAFETY_RULES.md)
- NEVER write frontend business logic (L1 must not duplicate L2)
- CashLedger, DailyClose (CLOSED), and MonthlyReport are immutable — enforce at DB level
- All financial operations must be atomic (MongoDB sessions) across Transaction + CashLedger + Device

## Deployment

- **Static site**: push to `main` → GitHub Actions deploys to GitHub Pages
- **Backend (Cloud Run)**: Docker build via Cloud Build → Artifact Registry → Cloud Run (`europe-west3`)
- AI assistant must NEVER auto-deploy; always ask for explicit approval before git push or deploy
