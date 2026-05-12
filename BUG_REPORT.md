# Bug Report — TechCross POS/ERP

*Generated: 2026-05-11 | Source: Full codebase audit (7 agents)*

---

## CRITICAL

### C1. Invoice generation not atomic with `invoiceGenerated` flag
- **File:** `api/inv/invoices.js:299-325`
- **Flow:** Invoice
- **Description:** `Invoice.create()` and `transaction.invoiceGenerated = true` are separate writes with NO MongoDB session. A crash between them can leave an invoice-less transaction marked as invoiced, or an invoice with the transaction not flagged.
- **Fix:** Wrap both writes in a `startSession()` / `commitTransaction()` block.
- **Exists in production:** Yes

### C2. Manual refunds skip CashLedger entirely
- **File:** `api/inv/transactions.js:191-260`
- **Flow:** Refund
- **Description:** The manual refund path (no receipt number) creates a Transaction but NO CashLedger entry. Daily close validation will report a permanent mismatch between Transaction and Ledger totals for that day.
- **Fix:** Either remove manual refunds or implement proper CashLedger entry.
- **Note:** Comment at line 192 explicitly acknowledges this gap.
- **Exists in production:** Yes

### C3. Hardcoded admin credentials in announcement-admin.js
- **File:** `announcement-admin.js:1-5`
- **Description:** Username `0876676466` and password `0870019999` are hardcoded in plain text. Client-side authentication only (sessionStorage bypass). Password also logged to console at line 240.
- **Fix:** Move auth to server-side API endpoint.
- **Exists in production:** Yes

---

## HIGH

### H1. Daily close has no transaction lock — snapshots incomplete
- **File:** `services/inv-daily-close-service.js:102-205`
- **Flow:** Daily Close
- **Description:** `closeDay()` fetches transactions at line 120, creates snapshot at line 203. Any transaction created between these steps is permanently missed. Snapshot will show incomplete totals.
- **Fix:** Use a timestamp-based cutoff recorded atomically, or block new transactions during close.

### H2. L1 violation — VAT category calculations in frontend
- **File:** `inv-pos.html:2158-2187`
- **Flow:** POS
- **Description:** `searchOrders()` reads raw transaction data and computes `stdSales`, `marginSales`, `serviceSales`, `lycaSales` buckets client-side. This duplicates server-side reporting logic (`reports.js:138-191`, `invoices.js:257-289`).
- **Fix:** Move aggregation to a backend API endpoint; frontend should only display pre-computed totals.
- **Exists in production:** Yes

### H3. Cost prices exposed to all staff
- **Files (multiple):**
  - `api/inv/transactions.js:47` (calculate endpoint)
  - `api/inv/products.js:112` (product detail)
  - `api/inv/products.js:200+` (product list)
  - `api/inv/reports.js:133,147` (reports)
- **Description:** Every API route listed returns `costPrice` in its response. Staff-level users can see profit margins on all products.
- **Fix:** Strip `costPrice` from responses for `role: 'staff'` users.
- **Exists in production:** Yes

### H4. PATCH /:id/edit-items saves without integrity `authorize()`
- **File:** `api/inv/transactions.js:441-496`
- **Flow:** Transaction
- **Description:** The route imports `authorize` and `SOURCES` from integrity layer but NEVER calls `authorize()`. The transaction is saved at line 491 without integrity-layer authorization. Also does NOT update corresponding CashLedger, creating permanent mismatch.
- **Fix:** Call `authorize(transaction, SOURCES.ROOT_EDIT)` before save.
- **Exists in production:** Yes

### H5. Daily close service completely bypasses L3 integrity layer
- **File:** `services/inv-daily-close-service.js` (entire file)
- **Description:** Neither `authorize` nor `SOURCES` is imported from `inv-integrity-layer`. All DailyClose writes happen without integrity-layer authorization.
- **Fix:** Import and call `authorize()` on snapshot creation.

### H6. No audit log for daily close ROOT actions
- **File:** `services/inv-daily-close-service.js:102-204,215-236`
- **Description:** `closeDay()` and `confirmDay()` are ROOT-level actions that create NO AuditLog entry. These are the most sensitive managerial operations in the system.
- **Fix:** Create AuditLog entries for both operations.
- **Exists in production:** Yes

### H7. Race condition in stock entry/exit (non-atomic read-modify-write)
- **Files:** `api/inv/stock.js:59-61,121-123`
- **Description:** Stock entry/exit reads `product.stock`, computes new value, then calls `product.save()`. Two concurrent operations on the same product race: the second one overwrites the first's delta.
- **Fix:** Use `Product.findByIdAndUpdate(id, { $inc: { stock: quantity } })` instead.

### H8. Lost-update race in `confirmDay`
- **File:** `services/inv-daily-close-service.js:215-236`
- **Description:** Two concurrent `confirmDay()` calls both read `status === 'pending'`, then both write `status = 'closed'`. Second write silently overwrites first.
- **Fix:** Use `findOneAndUpdate({ date, status: 'pending' }, { status: 'closed' })` for atomic compare-and-swap.

### H9. `express.static(__dirname)` serves entire project root
- **File:** `server.js:61`
- **Description:** `express.static(path.join(__dirname))` serves ALL files in project root including `server.js`, model files, API route files, and configuration. Any file not in the `blockedFiles` list is publicly accessible.
- **Fix:** Serve only a `public/` subdirectory.
- **Exists in production:** Yes

### H10. Receipt generator always generates "sale" receipt numbers
- **File:** `utils/inv-receipt-generator.js:19`
- **Description:** Always calls `generateReceiptNumber('sale', date)`. Refunds produce "S-" prefix instead of "R-". Breaks audit traceability.
- **Fix:** Pass the actual transaction type from the transaction object.
- **Exists in production:** Yes

---

## MEDIUM

### M1. Duplicate MongoDB indexes (5 instances)
- **Files:**
  - `models/inv/Transaction.js:8+52` — receiptNumber
  - `models/inv/DailyClose.js:14+80` — date
  - `models/inv/MonthlyReport.js:35+79` — month
  - `models/inv/PosShortcut.js:4+14` — sort_no
  - `models/inv/Device.js:7+25` — serialNumber
- **Description:** `unique: true` in field definition AND explicit `schema.index()`. Mongoose creates both. Wasted disk, slower writes, startup warnings.
- **Fix:** Remove the explicit `schema.index()` calls (field-level unique:true already creates index).

### M2. Timezone mismatch — UTC vs local in daily close
- **Files:** `services/inv-daily-close-service.js:115-117` and `api/inv/transactions.js:296-308`
- **Description:** Daily close uses `new Date(dateStr + 'T00:00:00.000Z')` (UTC midnight). Transaction queries use local midnight. Transactions near midnight will be categorized on different days.
- **Fix:** Both should use the same timezone convention (preferably local).

### M3. Payment method classification lumps all non-cash into "card"
- **File:** `utils/inv-reconciliation.js:103-106`
- **Description:** `if (txn.paymentMethod === 'cash') { cashTotal += amount } else { cardTotal += amount }`. Split payments and any future payment methods are incorrectly classified.
- **Fix:** Add explicit handling for each payment method type.
- **Exists in production:** Yes

### M4. Race condition in stock reconciliation
- **File:** `utils/inv-reconciliation.js:70-80`
- **Description:** Two separate `StockMovement.aggregate()` calls fetch entry and exit totals. A movement between the calls produces inconsistent results.
- **Fix:** Combine into single pipeline or wrap in transaction/snapshot read.

### M5. Any staff can delete expenses
- **File:** `api/inv/expenses.js:115`
- **Description:** DELETE route only has staff-level auth. Any staff member can delete expense records.
- **Fix:** Require `requireRole('root', 'manager')` on this route.

### M6. Any staff can soft-delete products
- **File:** `api/inv/products.js:356`
- **Description:** PUT `/:id/disable` route only has staff-level auth. Any staff can disable products.
- **Fix:** Require manager role for product status changes.

### M7. Purchases receive not wrapped in MongoDB transaction
- **File:** `api/inv/purchases.js:272-322`
- **Description:** Multi-product stock increment loop is not in a session. If the process crashes mid-loop, some products get stock and others do not.
- **Fix:** Wrap in MongoDB session.

### M8. Manual refund duplicates VAT calculation logic
- **File:** `api/inv/transactions.js:216-232`
- **Description:** Inline VAT extraction `Math.round(i.unitPrice * rate / (1 + rate) * 100) / 100` duplicates `inv-vat-calculator.js`. Must be maintained in sync.
- **Fix:** Call VAT calculator utility function instead.

### M9. `reconcileVat()` ignores per-item VAT rates
- **File:** `utils/inv-reconciliation.js:352`
- **Description:** Uses single `DEFAULT_VAT_RATE` for all items. Items with different VAT rates (e.g., 13.5% services) will always show as discrepancies.
- **Fix:** Support per-item `vatRate` in reconciliation queries.
- **Note:** Currently dormant since no items set non-23% rates, but breaks if 13.5% is introduced.

### M10. No JWT refresh mechanism
- **File:** `auth-guard.js`
- **Description:** Expired JWT causes silent redirect to login. No refresh token flow. POS staff will be interrupted mid-workflow.
- **Fix:** Implement token refresh endpoint.

### M11. Transaction model has NO immutability for existing documents
- **File:** `models/inv/Transaction.js:62-74`
- **Description:** Pre-save hook guards only `this.isNew`. Existing documents can be modified by any code path. No `findOneAndUpdate`/`updateOne`/`deleteOne` hooks.
- **Fix:** Add full immutability hooks matching CashLedger pattern.

### M12. `invoiceGenerated` flag is unprotected (can be reverted)
- **File:** `models/inv/Transaction.js`
- **Description:** No check preventing `invoiceGenerated` from being toggled from `true` back to `false`. Invoice generation is a one-way latch.
- **Fix:** Add pre-save check: if existing doc has `invoiceGenerated === true`, block setting to `false`.

### M13. CAPTCHA cleanup interval lacks error handling
- **File:** `api/inv/auth.js:37-44`
- **Description:** `setInterval` callback has no try/catch. A corrupted captcha entry would crash the timer permanently.
- **Fix:** Wrap loop body in try/catch.

### M14. Silent error swallowing in invoice generation
- **File:** `api/inv/invoices.js:329,342,350`
- **Description:** `catch (_) {}` — audit log and PDF generation errors are silently swallowed with zero logging.
- **Fix:** Log errors before swallowing.

### M15. Duplicate auth logic across `auth-guard.js` and `inv-common.js`
- **Files:** `auth-guard.js`, `inv-common.js:22-60`
- **Description:** `getToken`, `getUser`, `isLoggedIn`, `logout`, `requireAuth` — nearly identical in both files. Risk of divergence.
- **Fix:** Unify into one module.

---

## LOW

### L1. `validateRequiredFields` does not reject NaN
- **File:** `utils/inv-validators.js:62-76`
- **Description:** `NaN !== undefined` and `NaN !== null`, so `NaN` values pass validation. Could silently propagate through financial calculations.
- **Fix:** Add `Number.isNaN(value)` check.

### L2. No collision fallback in receipt number generation
- **File:** `utils/inv-receipt-number.js:58`
- **Description:** 4 random hex bytes (32 bits) — collision probability ~0.1% at 100k transactions. No database uniqueness check or retry.
- **Fix:** Add retry-on-collision logic or use counter.

### L3. Order discount distribution has unreconciled rounding residuals
- **File:** `utils/inv-discount-calculator.js:231-262`
- **Description:** Proportional distribution rounds each item independently. Sum of `newSubtotal` values may differ 1-2 cents from `discountedTotal`.
- **Fix:** Adjust the largest item by the residual.

### L4. No error-handling middleware in Express
- **File:** `server.js`
- **Description:** No 4-argument `(err, req, res, next)` handler. Stack traces could leak in production.
- **Fix:** Add Express error-handling middleware.

### L5. `dns.setServers()` hardcoded in production code
- **File:** `server.js:2-3`
- **Description:** Overrides OS-level DNS for entire Node process. Should not be in production deployment.
- **Fix:** Gate behind `process.env.NODE_ENV === 'development'` or remove.

### L6. No rate limiting on auth endpoints
- **File:** `server.js`
- **Description:** `/api/inv/auth` login endpoint has no rate limiting. Brute force protection missing.
- **Fix:** Add `express-rate-limit`.

### L7. CORS origin typo candidate
- **File:** `server.js:37`
- **Description:** `teschcross-git-1045728849939.europe-west1.run.app` — missing 'h' in "techcross". May block legitimate Cloud Run traffic if the URL is correct.
- **Verify:** Check actual Cloud Run URL.

### L8. `closeDay()` overwrites pending snapshots without warning
- **File:** `services/inv-daily-close-service.js:196-200`
- **Description:** Second concurrent `closeDay()` silently overwrites first's pending snapshot. No error raised.
- **Fix:** Check for existing pending snapshot and block or warn.

### L9. No audit trail for transaction deletion (intentional but concerning)
- **File:** `api/inv/transactions.js:554-556`
- **Description:** Deletion is permanent and leaves NO record. Leaves orphaned CashLedger entries.
- **Note:** Comment says "DISABLED per requirement." Design decision but risky.

### L10. Public website pages log console data
- **Files:** `script.js` (13 console.log), `admin.js` (10), `announcement-admin.js` (12)
- **Description:** Production frontend code contains 23+ console.log statements, some logging form field data.
- **Fix:** Remove or gate behind `NODE_ENV === 'development'`.

### L11. `applyLang()` has dead code
- **File:** `lang.js:647-649`
- **Description:** First `toggle.textContent` assignment is immediately overwritten by hardcoded text on next line.
- **Fix:** Remove dead line.

### L12. `encryptData` copy-pasted in 4 service files
- **Files:** `services/inv-admin-service.js`, `inv-receipt-delivery-service.js`, `inv-invoice-delivery-service.js`, `inv-share-service.js`
- **Description:** Identical `encryptData` function defined 4 times instead of shared utility.
- **Fix:** Extract to `utils/`.

### L13. Missing indexes on operator fields
- **Models:** Transaction, Invoice, Expense, CashLedger
- **Description:** All have `operator` references but none index them. User-history queries are collection scans.
- **Fix:** Add `operator: 1` indexes.

### L14. `"main"` in package.json points to wrong file
- **File:** `package.json:5`
- **Description:** `"main": "admin-enhanced-core.js"` — should be `"server.js"` or removed.
- **Fix:** Update or remove field.

---

## Test Failures Summary (15 failing)

| Test File | Failed | Root Cause |
|-----------|--------|------------|
| `inv-transactions-routes.test.js` | 6 | Timeout (needs real MongoDB; tests try to connect to DB) |
| `inv-invoices-routes.test.js` | 7 | Language mismatch (expects Chinese error, gets English); status code mismatch (400 vs 404) |
| `inv-auth-routes.test.js` | 2 | Route returns 500 instead of expected 400 |
| Integration tests (3 files) | 0 run | Missing `mongodb-memory-server` dependency |

**Failing tests are test issues, not necessarily production bugs.** The transaction route tests time out because they connect to real MongoDB (not mocked) and the test DB isn't available. The invoice test failures are language/status-code mismatches.
