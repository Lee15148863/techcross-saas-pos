# RUNBOOK — POS + ERP + VAT Financial System

This file is NOT documentation.
It is a **STRICT EXECUTION PROTOCOL** for any AI working on this project.

---

## 1. SYSTEM LEVEL CLASSIFICATION

This system has 3 execution layers:

**L1 — UI Layer (Frontend Only)**
- Rendering only
- No business logic
- No calculations
- No VAT logic
- No pricing logic

**L2 — Service Layer (Business Logic Layer)**
- All VAT calculations
- Transaction creation
- Refund logic
- Device lifecycle logic
- Cash ledger writes
- MUST be the ONLY place where business logic exists

**L3 — Financial Core Layer (HIGHEST SECURITY)**
- Transaction integrity rules
- CashLedger immutability enforcement
- Device financial integrity
- DailyClose locking rules
- Audit logging enforcement

ONLY L2 + L3 may touch financial data.

---

## 2. PERMISSION HIERARCHY

**STAFF:**
- POS usage only
- No access to reports
- No refunds beyond simple allowed cases

**MANAGER:**
- Reports access (read-only)
- View transactions
- No system modifications
- No user management

**ROOT (BOSS):**
- FULL SYSTEM CONTROL
- User management
- Transaction deletion
- Price modification
- Refund override
- Daily close override
- System emergency controls

IMPORTANT: All ROOT actions MUST still pass L3 integrity checks.

---

## 3. EXECUTION RULES (MANDATORY)

**Rule A — No frontend logic:**
Frontend must NEVER:
- calculate VAT
- calculate totals
- determine pricing
- validate financial rules

**Rule B — Single source of truth:**
All financial truth comes from:
- Transaction collection
- CashLedger collection
- Device collection
- DailyClose snapshot

**Rule C — No duplicate logic:**
If logic exists in Service Layer, it MUST NOT exist elsewhere.

**Rule D — Atomicity:**
All financial operations must be:
- atomic (MongoDB session)
- rollback-safe
- consistent across Transaction + Ledger + Device

**Rule E — Audit requirement:**
Every ROOT or MANAGER action must:
- generate AuditLog entry
- include user, action, timestamp, target

---

## 4. SYSTEM SAFETY RULES

- CashLedger is IMMUTABLE (append-only)
- DailyClose is IMMUTABLE after CLOSED state
- Device financial fields require explicit permission source
- Transactions cannot be silently modified after creation
- Refunds must reference original transaction

---

## 5. AI DEVELOPMENT PROTOCOL

When modifying this system, AI MUST:

1. **Read SYSTEM_SPEC.md first**
2. **Read RUNBOOK.md**
3. **Identify layer** (L1 / L2 / L3)
4. **Never mix layers**
5. **Output ONLY minimal necessary code changes**
6. **Always preserve financial integrity rules**

---

## 6. FORBIDDEN ACTIONS

AI MUST NEVER:
- Recalculate VAT in frontend
- Modify CashLedger directly outside service layer
- Bypass integrity checks
- Create duplicate financial logic
- Skip audit logging for ROOT actions
- Modify closed DailyClose records

---

## 7. SYSTEM DESIGN PRINCIPLE

This system is:

> **"A financial-grade POS + ERP system with immutable accounting rules"**

Not a web app.
Not a dashboard.
It is a financial system.

---

**END OF RUNBOOK**
