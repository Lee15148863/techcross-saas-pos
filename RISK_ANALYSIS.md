# Risk Analysis — TechCross POS/ERP

*Generated: 2026-05-11*

---

## Risk Matrix

| Risk ID | Description | Likelihood | Impact | Risk Level |
|---------|------------|------------|--------|------------|
| R01 | Daily close snapshot misses transactions | Medium | HIGH — incomplete financial records | **HIGH** |
| R02 | Invoice atomicity gap (crash between writes) | Low | HIGH — inconsistent invoice state | **MEDIUM** |
| R03 | Manual refunds create ledger mismatch | Medium | HIGH — daily close validation fails | **HIGH** |
| R04 | Hardcoded announcement admin credentials | High | MEDIUM — unauthorized access to announcements | **HIGH** |
| R05 | Cost prices visible to staff | High | MEDIUM — staff see profit margins | **MEDIUM** |
| R06 | Express.static serves source code | Low | HIGH — source code exposure | **HIGH** |
| R07 | No rate limiting on auth | Medium | HIGH — brute force attack | **HIGH** |
| R08 | Race condition in stock entry/exit | Medium | LOW — inventory drift (not financial) | **LOW** |
| R09 | Lost update in confirmDay | Low | HIGH — duplicate confirmations | **MEDIUM** |
| R10 | Integrity bypass in daily close service | Low | HIGH — financial snapshots unverified | **HIGH** |
| R11 | No audit log for daily close operations | Low | MEDIUM — no trail for ROOT close actions | **MEDIUM** |
| R12 | Receipt numbers lack collision fallback | Low | MEDIUM — duplicate receipt numbers | **LOW** |
| R13 | Transaction model has no immutability | Medium | HIGH — financial records can be altered | **HIGH** |
| R14 | 13.5% VAT rate not implemented | Low | MEDIUM — service items over-taxed at 23% | **MEDIUM** |
| R15 | Duplicate indexes waste DB resources | High | LOW — performance degradation | **LOW** |
| R16 | No error-handling middleware (stack leak) | Low | MEDIUM — information disclosure | **MEDIUM** |
| R17 | JWT in localStorage (XSS leakage) | Medium | HIGH — token theft | **HIGH** |
| R18 | Refund integrity checks skipped for non-CHECKOUT | Low | MEDIUM — refund VAT errors undetected | **MEDIUM** |
| R19 | Payment method misclassification (split→card) | Low | LOW — misreported card totals | **LOW** |
| R20 | Timezone mismatch in daily close vs queries | Medium | MEDIUM — transactions miscategorized near midnight | **MEDIUM** |

---

## Critical Risk Details

### R01: Daily Close Snapshot Incompleteness
- **Mechanism:** `closeDay()` fetches transactions → outside code creates new transaction → snapshot is created without the new transaction
- **Impact:** Daily financial totals are wrong. Undercounting sales means cash reconciliation fails, VAT reports are incomplete.
- **Mitigation:** Add timestamp-based cutoff (record "close started at" timestamp, include only transactions created before that)
- **Detection:** Manual spot-check of daily totals vs end-of-day POS display

### R06: Source Code Exposure
- **Mechanism:** `express.static(__dirname)` serves project root. Routes like `/middleware/inv-auth.js` or `/models/inv/Transaction.js` return source code
- **Impact:** Attackers learn JWT verification logic, schema structure, business rules. Can craft targeted attacks
- **Mitigation:** Serve only `public/` subdirectory. BlockedFiles list is incomplete — any new file is exposed by default
- **Detection:** Visit `https://techcross.ie/middleware/inv-auth.js` in browser

### R07: No Rate Limiting on Auth
- **Mechanism:** POST `/api/inv/auth/login` has no rate limiting. Brute force possible
- **Impact:** Account compromise. This is a POS system — compromised staff/manager account can process fake refunds, view cost prices
- **Mitigation:** Add `express-rate-limit` with 5 attempts/minute per IP
- **Note:** LoginLog model tracks attempts but does not block

### R10 + R11: Daily Close Integrity + Audit Gap
- **Mechanism:** `inv-daily-close-service.js` neither calls `authorize()` from L3 integrity layer, nor creates AuditLog entries
- **Impact:** Daily financial snapshots are the basis for monthly tax reporting. If these snapshots are tampered with (bypassing integrity checks), the resulting tax reports are unreliable. No audit trail means root cannot verify who closed which day
- **Mitigation:** Import `authorize`/`SOURCES` from integrity layer; add AuditLog.create calls

### R13: Transaction Immutability Gap
- **Mechanism:** Transaction pre-save hook only guards `this.isNew`. No `findOneAndUpdate`/`updateOne`/`deleteOne` hooks. Any code path can modify any transaction at any time
- **Impact:** The core financial record of the system has no protection against unintended modification. A bug in any route handler that calls transaction.save() can silently corrupt financial data
- **Note:** CashLedger (the financial truth) IS properly protected. The gap is in Transaction records themselves

### R17: JWT in localStorage
- **Mechanism:** JWT stored in `localStorage` — any XSS vulnerability leaks the token
- **Impact:** Attacker with stolen JWT can impersonate any user up to ROOT level. Full system compromise
- **Mitigation:** Use HttpOnly cookies (requires session management on backend) or implement short JWT expiry + refresh tokens

---

## Compliance Risks

### Irish VAT Compliance
- **13.5% rate not implemented** (R14) — service items charged 23% VAT when they should be 13.5%. Overcharging customers. Understating correct VAT by charging wrong rate (though Revenue gets the right amount if 23% > 13.5%)
- **Manual refunds skip CashLedger** (R03) — accounting trail is incomplete. Not compliant with proper accounting practices
- **Invoice generation not atomic** (R02) — in a crash scenario, could produce inconsistent invoice records

### Data Protection (GDPR)
- **Cost prices exposed to staff** (R05) — not a GDPR issue per se, but exposes business-sensitive data
- **Console.log in production** — form data being logged to browser console could include personal data
- **`./bash_history` in git status** — ensure .gitignore covers all sensitive files

---

## Mitigation Priority

### Immediate (Week 1)
1. R04 — Remove hardcoded credentials; implement server-side auth for announcements
2. R01 — Add timestamp cutoff to daily close to prevent missed transactions
3. R06 — Restrict express.static to a `public/` directory
4. R07 — Add rate limiting to auth endpoint

### Short-term (Week 2-3)
5. R10+R11 — Add integrity layer + audit logging to daily close service
6. R02 — Make invoice generation atomic (MongoDB session)
7. R03 — Implement CashLedger for manual refunds or remove the feature
8. R13 — Add full immutability hooks to Transaction model
9. R05 — Filter cost prices from staff-role responses

### Medium-term (Month 2)
10. R17 — Migrate from localStorage JWT to HttpOnly cookies or refresh tokens
11. R14 — Implement 13.5% reduced VAT rate for service items
12. R16 — Add Express error-handling middleware
13. R09 — Fix confirmDay lost-update race
14. R12 — Add receipt number collision retry

### Low priority
15. R08, R15, R19, R20 — Address remaining medium/low issues
