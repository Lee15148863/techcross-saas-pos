# SOFT FREEZE POLICY

> Effective: 2026-05-07
> The financial architecture is considered stable. No further redesign or heavy refactoring of financial core systems is permitted.

---

## 1. PURPOSE

The project has moved from architecture-building to **operational hardening**.

Objective: **ensure the system survives real store operations safely.**

All work must fall under one of:
- operational testing
- real-world workflow testing
- edge-case stabilization
- UI/UX improvements
- printer stability
- mobile admin improvements

---

## 2. FROZEN SYSTEMS (FINANCIAL CORE)

The following systems are **frozen** — no redesign, no schema changes, no architectural rewrites:

| System | Scope |
|--------|-------|
| Checkout engine | Transaction creation, atomic flow, payment handling |
| Refund engine | Full/partial refund, duplicate prevention, VAT reversal |
| VAT engine | Standard VAT, margin VAT, rate application |
| CashLedger | Entry creation, immutability hooks, ledger integrity |
| DailyClose | Close/open lifecycle, snapshot immutability |
| Integrity layer | Symbol-based authorization, pre-save validation |
| Transaction atomic flow | MongoDB session/transaction pattern |
| Device financial lifecycle | BUY_IN→PENDING→TESTED→SOLD, financial field protection |

### What is NOT allowed on frozen systems

- Schema redesign
- Transaction flow rewrite
- VAT architecture rewrite
- Refund architecture rewrite
- Ledger logic replacement
- Moving financial logic to frontend
- Removing integrity validation
- Changing atomic transaction structure

---

## 3. ALLOWED CHANGES

Changes that do not touch financial core architecture are permitted:

| Category | Examples |
|----------|----------|
| Bug fixes | Incorrect calculation, null reference, race condition |
| Validation improvements | Stricter input checks, edge-case handling |
| Operational edge-case handling | Negative margins, partial refunds, device-less sales |
| UI/UX improvements | Layout, feedback, error messages, confirmation dialogs |
| Mobile optimization | Boss dashboard, responsive views, touch-friendly UI |
| Printer optimization | Connection retry, fallback channels, status feedback |
| Report/export improvements | Additional fields, format fixes, filtering |
| Performance | Query optimization, caching (no architecture rewrite) |

When in doubt: a change that **adds a safety check** is usually safe.  
A change that **rewrites how a frozen system works** is not.

---

## 4. CURRENT DEVELOPMENT PRIORITIES

Ranked by impact on real store operations:

1. **Real-world operational simulation** — Multi-step store workflows
2. **POS workflow stability** — Continuous checkout, refund edge cases
3. **Printer reliability** — Connection, fallback, recovery
4. **Boss mobile dashboard** — Remote monitoring, approvals
5. **Daily operation usability** — Smooth handover between staff
6. **Error handling and recovery** — Graceful failure, clear messaging

---

## 5. TESTING GOAL

No longer: *"build more financial architecture"*

Now: *"ensure the system survives real store operations safely"*

Prioritize testing of:
- continuous checkout operations under load
- refund edge cases (concurrent, partial, device)
- multi-user concurrent usage
- daily close reliability across scenarios
- mobile admin workflow completeness
- printer fallback reliability
- ledger consistency under stress

---

## 6. VIOLATIONS

Any proposed change that:
- Modifies a frozen system's core logic
- Redesigns a schema on the frozen list
- Rewrites financial logic rather than fixing it

Must be **rejected** unless explicitly approved by the project owner.

If a request conflicts with this policy:
→ REJECT the request and explain which section it violates.
