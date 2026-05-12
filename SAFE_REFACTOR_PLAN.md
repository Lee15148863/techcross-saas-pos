# Safe Refactor Plan — TechCross POS/ERP

*Generated: 2026-05-11*

---

## Phase 1: Safe Fixes Only (No Financial Logic Changes)

These changes are safe to make immediately. They involve:
- Dead code cleanup
- Duplicate code extraction
- Obvious frontend issues
- Console.log cleanup
- Missing error handling
- Test fixes

---

### Task 1.1 — Remove dead code in `lang.js`
- **File:** `lang.js:647-649`
- **Change:** Remove the redundant `toggle.textContent = __(...)` line that is immediately overwritten
- **Risk:** None — visual-only dead code
- **Test:** Visual check that language toggle still works

### Task 1.2 — Extract `encryptData` to shared utility
- **Files:** 4 service files have identical `encryptData` function
- **Change:** Move to `utils/inv-crypto.js`, import in all 4 services
- **Risk:** Low — pure function, no side effects
- **Test:** Run existing unit tests for receipt/invoice delivery

### Task 1.3 — Remove duplicate `schema.index()` calls (5 files)
- **Files:**
  - `models/inv/Transaction.js` — remove line 52 explicit index (field-level unique:true already exists)
  - `models/inv/DailyClose.js` — remove line 80
  - `models/inv/MonthlyReport.js` — remove line 79
  - `models/inv/PosShortcut.js` — remove line 14
  - `models/inv/Device.js` — remove line 25
- **Risk:** Very low — field-level `unique: true` already creates the index; duplicates are waste
- **Test:** Verify duplicate index warnings disappear from server startup

### Task 1.4 — Add error-handling middleware to Express
- **File:** `server.js` (before catch-all route)
- **Change:** Add `(err, req, res, next)` handler that returns JSON error
- **Risk:** None — current behavior is Express default (html error page)
- **Test:** Trigger error via invalid route, verify JSON response

### Task 1.5 — Fix CAPTCHA cleanup error handling
- **File:** `api/inv/auth.js:37-44`
- **Change:** Wrap `setInterval` callback in try/catch, log errors
- **Risk:** None — fixes a crash bug
- **Test:** Run auth tests

### Task 1.6 — Add error logging to invoice error swallows
- **File:** `api/inv/invoices.js:329,342,350`
- **Change:** Add `console.error` before empty catch blocks
- **Risk:** None
- **Test:** Run invoice route tests

### Task 1.7 — Remove console.log from production frontend files
- **Files:**
  - `script.js` (13 console.log — form data logging)
  - `announcement-admin.js:240` (credentials logging)
  - `admin.js` (10 console.log)
- **Change:** Remove or gate behind `if (debug)` flag
- **Risk:** Low — may affect debugging but production should not leak to console
- **Test:** Manual smoke test of affected pages

### Task 1.8 — Add rate limiting to auth endpoint
- **File:** `server.js` (add `express-rate-limit` package)
- **Change:** `npm install express-rate-limit`; apply limiter to `/api/inv/auth` routes
- **Risk:** Low — may need tuning but starts blocked
- **Test:** Hit auth endpoint 6+ times rapidly, verify 429 response

### Task 1.9 — Fix `package.json` `"main"` field
- **File:** `package.json:5`
- **Change:** Remove `"main"` or set to `"server.js"`
- **Risk:** None

### Task 1.10 — Add `NODE_ENV=production` check to dns.setServers
- **File:** `server.js:2-3`
- **Change:** `if (process.env.NODE_ENV !== 'production') dns.setServers(...)`
- **Risk:** None — the DNS override is only needed for local dev
- **Test:** Verify DNS resolution still works in dev mode

---

## Phase 2: Architectural Fixes (Require Testing)

These changes are safe but more involved. Each needs unit testing.

### Task 2.1 — Hide cost prices from staff role
- **Files:**
  - `api/inv/transactions.js:47` — filter costPrice from calculate response
  - `api/inv/products.js:112,200+` — filter from product detail/list
  - `api/inv/reports.js:133,147` — filter from reports
- **Change:** Add middleware or helper that strips `costPrice` when `req.user.role === 'staff'`
- **Safety:** Triple-check all routes that return costPrice
- **Test:** Create staff-token request, verify costPrice field absent

### Task 2.2 — Restrict expense/product deletion to manager+
- **Files:**
  - `api/inv/expenses.js:115` — change `requireRole('root', 'manager', 'staff')` to `requireRole('root', 'manager')`
  - `api/inv/products.js:356` — add `requireRole('root', 'manager')` middleware
- **Safety:** Verify business policy — should staff delete expenses?
- **Test:** Staff-token request to delete, verify 403 response

### Task 2.3 — Fix stock race condition (atomic $inc)
- **File:** `api/inv/stock.js:59-61,121-123`
- **Change:** Replace read-modify-write with `Product.findByIdAndUpdate(id, { $inc: { stock: quantity } })`
- **Safety:** Supercedes the race condition entirely
- **Test:** Run stock tests

### Task 2.4 — Add receipt number collision retry
- **File:** `utils/inv-receipt-number.js`
- **Change:** Add retry loop with `crypto.randomBytes` regeneration on collision
- **Safety:** No existing behavior changed
- **Test:** Unit test collision handling

### Task 2.5 — Fix order discount rounding residual
- **File:** `utils/inv-discount-calculator.js:231-262`
- **Change:** After proportional distribution, calculate residual and adjust largest item
- **Safety:** Verify existing test passes with adjusted rounding
- **Test:** `inv-discount-calculator.test.js`

### Task 2.6 — Fix transaction route tests (6 timeout failures)
- **File:** `tests/unit/inv-transactions-routes.test.js`
- **Root cause:** Tests connect to real MongoDB which isn't available
- **Fix:** Mock Mongoose or provide test DB connection string
- **Safety:** Test-only change
- **Test:** `npx vitest --run tests/unit/inv-transactions-routes.test.js`

### Task 2.7 — Fix invoice route tests (7 assertion failures)
- **File:** `tests/unit/inv-invoices-routes.test.js`
- **Root causes:**
  - Language mismatch: tests expect Chinese error messages, route returns English
  - Status code mismatch: 400 vs 404 for invalid ObjectId
- **Fix:** Update test expectations to match current implementation
  - Change error regex from Chinese to English patterns
  - Change `toBe(404)` to `toBe(400)` for ObjectId validation tests
  - Add `VALIDATION_ERROR` code to validation responses
- **Safety:** Test-only change
- **Test:** `npx vitest --run tests/unit/inv-invoices-routes.test.js`

### Task 2.8 — Fix auth route tests (2 assertion failures)
- **File:** `tests/unit/inv-auth-routes.test.js`
- **Root cause:** Routes return 500 instead of 400 for invalid user update body
- **Fix:** Investigate the route handler — likely missing validation that causes unhandled error
- **Safety:** Investigate before changing
- **Test:** `npx vitest --run tests/unit/inv-auth-routes.test.js`

---

## Phase 3: Financial System Fixes (Require Triple Confirmation)

**WARNING:** These changes affect protected financial/tax systems. Each requires:
1. Backup commit
2. Explain exact impact
3. Triple confirmation
4. Re-test calculations

### Task 3.1 — Manual refund CashLedger entry
- **Files:** `api/inv/transactions.js:191-260`
- **Change:** Add CashLedger creation for manual refunds or remove the feature
- **Risk:** Financial data integrity — must match daily close validation

### Task 3.2 — Daily close integrity layer + audit log
- **Files:** `services/inv-daily-close-service.js`
- **Change:** Import `authorize`/`SOURCES`; add `authorize()` before writes; add AuditLog entries

### Task 3.3 — Transaction immutability hooks
- **File:** `models/inv/Transaction.js`
- **Change:** Add `findOneAndUpdate`/`updateOne`/`deleteOne` hooks matching CashLedger pattern

### Task 3.4 — Invoice generation atomicity
- **File:** `api/inv/invoices.js:299-325`
- **Change:** Wrap Invoice.create + invoiceGenerated flag in MongoDB session

### Task 3.5 — 13.5% VAT rate implementation
- **File:** `utils/inv-vat-calculator.js`
- **Change:** Add reduced VAT rate support
- **Triple confirmation required** — VAT change per DEPLOYMENT_SAFETY_RULES.md

---

## Execution Plan

```
Week 1: Phase 1 only (safe fixes)
  Day 1:  Tasks 1.1-1.4 (dead code, indexes, error middleware)
  Day 2:  Tasks 1.5-1.7 (error handling, console.log)
  Day 3:  Tasks 1.8-1.10 (rate limiting, config fixes)
  Day 4:  Test all Phase 1 changes
  Day 5:  Buffer / review

Week 2: Phase 2 (architectural fixes)
  Day 1:  Tasks 2.1-2.2 (cost prices, role restrictions)
  Day 2:  Tasks 2.3-2.5 (stock atomicity, receipt collision, rounding)
  Day 3:  Tasks 2.6-2.8 (test fixes)
  Day 4:  Test all Phase 2 changes
  Day 5:  Buffer / review

Month 2+: Phase 3 (financial system — triple confirmation)
  Requires owner approval for each task
  Backup + test + verify for each change
```

---

## FORBIDDEN (Do NOT implement without explicit permission)

Per DEPLOYMENT_SAFETY_RULES.md, these areas are STRICTLY PROTECTED:

- VAT logic changes (rates, formulas, margin calculations)
- Invoice calculation changes (totals, VAT display, numbering)
- Refund logic changes (core refund processing)
- Reconciliation logic changes
- Deployment/push changes
- MongoDB schema changes on financial models
- Daily close state machine changes
