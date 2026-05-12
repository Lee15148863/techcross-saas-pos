# Full Codebase Audit — TechCross POS/ERP

*Generated: 2026-05-11 | Coverage: 90+ files analyzed by 7 parallel agents*

---

## Executive Summary

**Codebase Health: MODERATE RISK**

The system has a strong architectural foundation with clear 3-layer separation (L1 UI / L2 Services / L3 Core), atomic checkout via MongoDB sessions, and well-designed immutable financial models (CashLedger, Invoice snapshot, DailyClose). However, several critical gaps exist in the daily close flow, refund handling, and frontend architecture.

### Stats
- **Files audited:** 90+ (all .js, .html, config files excluding node_modules)
- **TODO/FIXME/HACK found:** 0 — remarkably clean codebase
- **Tests:** 411 passed / 15 failed (6 test files failing)
- **Critical bugs:** 3
- **High-severity issues:** 10
- **Medium-severity issues:** 15
- **Duplicate indexes:** 5 (all confirmed, warn on startup)
- **Hardcoded credentials:** 1 file (announcement-admin.js)

---

## Architecture Compliance

### Layer Separation (L1 / L2 / L3)
| Rule | Status | Notes |
|------|--------|-------|
| L1 never calculates VAT | ❌ VIOLATED | `inv-pos.html:2158-2187` computes VAT categories client-side |
| L1 never calculates totals | ✅ PASS | Totals calculated server-side via `/transactions/calculate` |
| L2 is single source of truth | ✅ PASS | Services own all business logic |
| L3 enforces integrity | ⚠️ GAP | Daily close bypasses authorize() entirely |
| Financial operations atomic | ⚠️ GAP | Invoice generation NOT atomic (2 separate writes) |
| CashLedger immutable | ✅ PASS | Model correctly blocks all mutations |
| DailyClose immutable after CLOSED | ✅ PASS | Pre-save hook blocks closed-state edits |

### Permission System
| Rule | Status | Notes |
|------|--------|-------|
| STAFF cannot delete transactions | ✅ PASS | Role check in route |
| STAFF cannot view cost prices | ❌ VIOLATED | Multiple routes return costPrice to all roles |
| MANAGER cannot manage users | ✅ PASS | Route requires root |
| ROOT has full control | ✅ PASS | By design |
| All ROOT actions logged | ⚠️ GAP | Daily close actions not audited |

---

## Findings by Layer

### L1 — UI Layer (Frontend)
- **3 CRITICAL:** L1 VAT calculation, hardcoded credentials, admin.js dead code with crash
- **5 HIGH:** Console.log leaking password, race conditions in cart, silent error swallowing
- **8 MEDIUM:** Hardcoded VAT defaults, missing error handlers, dual auth modules

### L2 — Service Layer
- **6 HIGH:** Daily close bypasses integrity layer (no authorize), missing audit logs for close actions, confirmDay race condition, partial-refund race
- **7 MEDIUM:** No session in daily close, no audit logs for checkout/refund, stock movement race
- **12 LOW:** Duplicated utility functions (encryptData ×4, createTransporter ×2)

### L3 — Financial Core Layer
- **3 HIGH:** No 13.5% VAT rate support, receipt number always "sale" type, reconciliation race conditions
- **5 MEDIUM:** Per-item VAT skip for non-CHECKOUT, missing costPrice inflates margin VAT, NaN validation gap, collision risk in receipt numbers, rounding residuals in discount calculator

### Models
- **5 duplicate indexes** — wasted DB resources, startup warnings
- **Transaction model has NO immutability** — pre-save hook only guards `this.isNew`
- **DailyClose closed→open rollback possible** — guard checks `this.status` not existing doc status
- **Invoice/MonthlyReport immutability bypassable** via `updateOne()`
- **4 models with stale `updatedAt`** — Product, User, Supplier, PurchaseOrder

### API Routes
- **2 CRITICAL:** PATCH edit-items saves without authorize(), edits transaction financials without updating CashLedger
- **4 HIGH:** Stock race conditions, cost price exposure, expense/product deletion accessible to staff
- **5 MEDIUM:** Custom auth duplicated, no input validation on pricing/brand data, CAPTCHA cleanup crash

### Infrastructure
- **CRITICAL:** `express.static(__dirname)` serves entire project root
- **HIGH:** No rate limiting on auth, no error-handling middleware, dns.setServers hardcoded, no `USER node` in Dockerfile
- **MEDIUM:** CORS typo candidate, `NODE_ENV` not set, wrong `"main"` in package.json

---

## File-by-File Summary

| File | Issues Found | Severity |
|------|-------------|----------|
| `server.js:61` | express.static serves project root | CRITICAL |
| `server.js:2-3` | dns.setServers hardcoded for production | HIGH |
| `server.js` | No error-handling middleware | MEDIUM |
| `server.js:37` | CORS typo candidate | MEDIUM |
| `announcement-admin.js:1-5` | Hardcoded credentials | CRITICAL |
| `announcement-admin.js:240` | Password logged to console | HIGH |
| `inv-pos.html:2158-2187` | L1 VAT calculation violation | CRITICAL |
| `inv-pos.html:1492-1536` | L1 total calculation in split payment | HIGH |
| `admin.js` | Dead code (708 lines), calls undefined function | HIGH |
| `services/inv-daily-close-service.js` | No authorize() import, no audit logs | HIGH |
| `services/inv-daily-close-service.js:215-236` | Lost-update race in confirmDay | HIGH |
| `services/inv-checkout-service.js` | Stock movement race outside session | MEDIUM |
| `services/inv-refund-service.js:177-186` | TOCTOU in duplicate refund check | MEDIUM |
| `utils/inv-vat-calculator.js` | No 13.5% reduced rate | HIGH |
| `utils/inv-receipt-generator.js:19` | Always generates 'sale' receipt numbers | HIGH |
| `utils/inv-reconciliation.js:70-80` | Race condition in stock reconcile | HIGH |
| `utils/inv-reconciliation.js:103-106` | Payment method misclassification | HIGH |
| `utils/inv-discount-calculator.js:231-262` | Rounding residual in discount distribution | MEDIUM |
| `utils/inv-validators.js:62-76` | NaN values pass validation | MEDIUM |
| `utils/inv-receipt-number.js:58` | No collision retry | MEDIUM |
| `api/inv/transactions.js:441-496` | edit-items no authorize(), no CashLedger update | CRITICAL |
| `api/inv/transactions.js:191-260` | Manual refund skips CashLedger | CRITICAL |
| `api/inv/invoices.js:299-325` | Invoice generation not atomic | CRITICAL |
| `api/inv/stock.js:59-61,121-123` | Stock race condition | HIGH |
| `api/inv/expenses.js:115` | Staff can delete expenses | HIGH |
| `api/inv/products.js:356` | Staff can disable products | HIGH |
| `api/inv/auth.js:37-44` | CAPTCHA cleanup may crash | MEDIUM |
| `api/inv/invoices.js:329,342,350` | Errors silently swallowed | MEDIUM |
| `api/inv/purchases.js:272-322` | No MongoDB session for multi-product receive | HIGH |
| `models/inv/Transaction.js:62-74` | No immutability for existing documents | HIGH |
| `models/inv/Transaction.js` | invoiceGenerated flag unprotected | MEDIUM |
| `models/inv/DailyClose.js:87-94` | Closed→open rollback possible | MEDIUM |
| `models/inv/Transaction.js:52` | Duplicate index (receiptNumber) | LOW |
| `models/inv/DailyClose.js:80` | Duplicate index (date) | LOW |
| `models/inv/MonthlyReport.js:79` | Duplicate index (month) | LOW |
| `models/inv/PosShortcut.js:14` | Duplicate index (sort_no) | LOW |
| `models/inv/Device.js:25` | Duplicate index (serialNumber) | LOW |
| `lang.js:647-649` | Dead code in applyLang() | LOW |
| `package.json:5` | Wrong "main" field | LOW |

---

## Dependency Analysis

### Direct dependencies (from package.json)
```
express        ^4.21.0    (stable, actively maintained)
mongoose       ^8.9.5     (stable, actively maintained)
bcryptjs       ^2.4.3     (stable, no longer active development)
jsonwebtoken   ^9.0.2     (stable, actively maintained)
dotenv         ^17.3.1    (stable, actively maintained)
cors           ^2.8.5     (stable, maintenance mode)
helmet         ^8.1.0     (STABLE — pinned, no caret)
pdfkit         ^0.15.0    (stable)
nodemailer     ^6.9.16    (stable)
morgan         ^1.10.0    (stable, maintenance mode)
```

### Missing dependencies
- `express-rate-limit` — brute force protection
- `express-validator` or `joi` — input validation
- `mongodb-memory-server` — needed for integration tests (currently failing)

### Dev dependencies
- `vitest` — test runner
- `supertest` — HTTP assertion testing
- `mongodb-memory-server` (listed but not installed) — integration tests

---

## Test Coverage

| Test File | Status | Tests | Coverage |
|-----------|--------|-------|----------|
| unit/inv-vat-calculator.test.js | ✅ PASS | ? | VAT calculations |
| unit/inv-validators.test.js | ✅ PASS | ? | Input validation |
| unit/inv-receipt-generator.test.js | ✅ PASS | ? | Receipt generation |
| unit/inv-discount-calculator.test.js | ✅ PASS | ? | Discount logic |
| unit/inv-reconciliation.test.js | ✅ PASS | ? | Reconciliation |
| unit/inv-auth-routes.test.js | ❌ 2 FAIL | 35 | Auth middleware (500 vs 400) |
| unit/inv-invoices-routes.test.js | ❌ 7 FAIL | 19 | Invoice routes (lang/status mismatch) |
| unit/inv-transactions-routes.test.js | ❌ 6 FAIL | 27 | Transaction routes (timeout) |
| integration/inv-checkout-e2e.test.js | ❌ SKIP | 0 | Missing mongodb-memory-server |
| integration/inv-system-audit.test.js | ❌ SKIP | 0 | Missing mongodb-memory-server |
| integration/inv-system-stress.test.js | ❌ SKIP | 0 | Missing mongodb-memory-server |

**Gap areas (no tests):**
- Services (checkout, refund, daily close)
- API routes (stock, products, expenses, close, reports)
- Models (pre-save hooks, immutability enforcement)
- Frontend

---

## Recommendations Summary

### Must fix (critical)
1. Remove hardcoded credentials from `announcement-admin.js`
2. Fix `express.static(__dirname)` to serve only `public/`
3. Make invoice generation atomic (MongoDB session)
4. Add CashLedger entry for manual refunds or remove the feature
5. Call `authorize()` in PATCH edit-items

### Should fix (high)
1. Remove L1 VAT calculations from `inv-pos.html:2158-2187`
2. Hide cost prices from staff role
3. Add rate limiting to auth endpoint
4. Add integrity layer + audit log to daily close service
5. Remove 5 duplicate MongoDB indexes
6. Add error-handling middleware

### Nice to fix (medium)
1. 13.5% VAT rate (when needed)
2. Transaction model immutability hooks
3. Receipt number collision retry
4. Stock atomic $inc instead of read-modify-write
5. Timezone consistency (UTC vs local)
6. Fix 15 failing tests

---

*See also: BUG_REPORT.md, RISK_ANALYSIS.md, ARCHITECTURE_MAP.md, SAFE_REFACTOR_PLAN.md*
