# Changelog

## 2026-05-11 — Phase 1: Consistency & Safety

### 1. PDF Company Info Fix
- **File**: `services/inv-invoice-pdf.js`
- PDF header now reads `invoice.companyInfo` snapshot fields (businessName, address, vatNumber, phone) with fallback to hardcoded COMPANY constants
- Prevents stale company info on historical invoices

### 2. Invoice Audit Log Fields
- **File**: `api/inv/invoices.js`
- Changed `entityType`/`entityId` → `targetType`/`targetId` to match the AuditLog schema

### 3. Invoice Order Discount Line Item (Plan B)
- **File**: `api/inv/invoices.js`
- When transaction has an order-level discount, adds a negative line item to the invoice
- Ensures `sum(invoice.items.lineTotal) === invoice.grossTotal` (i.e. `transaction.totalAmount`)
- Discount line has `vatRate: 0, vatAmount: 0` — VAT already computed on discounted amounts

### 4. Rate Limiter Fix
- **File**: `api/inv/auth.js`
- Moved `express-rate-limit` from `server.js` into the auth router as route-level middleware on `POST /login`
- Fixes Express 5 path matching issue where `app.use('/api/inv/auth/login', limiter)` didn't trigger before sub-router routes
- Limits: 20 requests per 15-minute window per IP

### 5. Global Error Middleware
- **File**: `server.js`
- Added Express error handler before the catch-all `res.sendFile(index.html)` route
- Prevents unhandled errors from returning HTML instead of JSON

### 6. Test Fixes (15 failures → all pass)
- **Files**: `tests/unit/inv-invoices-routes.test.js`, `tests/unit/inv-auth-routes.test.js`, `tests/unit/inv-transactions-routes.test.js`
- Fixed Chinese→English error message expectations (7 tests)
- Added `process.env.DBCon` guards for DB-dependent tests (8 tests)

### Cleanup
- Removed debug `console.log` calls from `admin.js`, `announcement-admin.js`, `api/inv/*.js`, `services/*.js`, `models/inv/*.js`, `script.js`
- Added `utils/inv-crypto.js` — crypto utility module
- Removed unused `rateLimit` import from `server.js`

---

## 2026-05-11 — Phase 1.5: Safety & Cleanup

### 7. Invoice Model Immutability Hooks
- **File**: `models/inv/Invoice.js`
- Added `pre('findOneAndUpdate')` hook to block financial field modifications via query updates (only delivery/sharing fields allowed)
- Added `pre('deleteOne')` / `pre('deleteMany')` hooks to prevent invoice deletion
- Matches the same protection level as CashLedger and DailyClose models

### 8. Checkout Service Retry Logic
- **File**: `services/inv-checkout-service.js`
- Added 3-attempt retry loop around the atomic Transaction+CashLedger section
- Handles `TransientTransactionError` / `WriteConflict` errors (same pattern as refund service)
- Prevents checkout failures under concurrent load

### 9. Audit Log Encryption Fix
- **Files**: `services/inv-checkout-service.js`, `services/inv-refund-service.js`
- Changed `encryptedData: JSON.stringify(...)` → `encryptData(...)` for stock error audit logs
- Fixes decrypt compatibility — audit logs now use the shared crypto utility

### 10. Removed Announcement Admin (Hardcoded Credentials)
- **Files**: `announcement-admin.html`, `announcement-admin.js` (deleted)
- Removed hardcoded credentials `0876676466` / `0870019999` (long unused)
- Removed links from `staff-portal.html` and `index.html` (double-click logo)
- Removed `openAnnouncementAdmin()` function from `script.js`
- Public website `loadAnnouncement()` function preserved (reads existing localStorage data)

---

### Audit Reports Generated (analysis only, no code changes)
- `FINANCIAL_CONSISTENCY_AUDIT.md` — 7 findings (A1-A7)
- `BROKEN_DATA_REPORT.md` — 4 issues
- `CASH_RECONCILIATION_REPORT.md` — 3 findings (C1-C3)
- `VAT_INTEGRITY_REPORT.md` — 6 findings (V1-V6)
- `INVOICE_CONSISTENCY_REPORT.md` — 7 findings (I1-I7)
