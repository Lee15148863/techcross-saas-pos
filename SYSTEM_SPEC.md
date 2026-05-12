# AI POS / ERP SYSTEM SPEC (ULTRA VERSION v2.1)

---

# 0. AI EXECUTION DIRECTIVE (CRITICAL)

You are developing a production-grade POS + ERP system.

You MUST:

* Follow ALL rules defined in this document
* NEVER assume missing logic
* NEVER simplify VAT or financial logic
* NEVER merge unrelated systems (inventory ≠ devices ≠ cash)

If a request conflicts with this spec:
→ REJECT the request and explain why

---

# 0.1 GIT & DEPLOYMENT RESTRICTIONS (CRITICAL)

The system is in LOCAL DEVELOPMENT mode.

STRICT RULES:

* DO NOT push any code to GitHub or any remote repository
* DO NOT create or modify git remotes
* DO NOT run git push, git commit, or git sync automatically
* DO NOT deploy to any server
* DO NOT connect to CI/CD systems

ONLY allowed if explicitly instructed by the user:

* git init
* git add
* git commit (manual, user-approved)

REQUIREMENT:

If any operation involves:

* GitHub
* remote repository
* deployment

→ You MUST ask for explicit user approval BEFORE proceeding

Violation of this rule is considered a critical error.

---

# 0.2 DATA & PRIVACY PROTECTION

* DO NOT upload any business data

* DO NOT expose:

  * pricing logic
  * VAT logic
  * device data
  * transaction data

* All data must remain LOCAL unless explicitly approved

---

# 1. SYSTEM CORE PRINCIPLES (NON-NEGOTIABLE)

1. Transactions are mutable (root only)
2. Cash ledger is IMMUTABLE (never edited or deleted)
3. Daily snapshots are IMMUTABLE (financial truth)
4. Monthly reports are IMMUTABLE (tax reporting)
5. Devices are IMMUTABLE ASSETS (never deleted)
6. Inventory is NOT a financial truth (reference only)

---

# 2. SYSTEM LAYERS (STRICT SEPARATION)

## 2.1 TRANSACTION LAYER

Handles:

* sales
* refunds
* quick sales
* services
* device sales

Mutable: YES (root only)

---

## 2.2 CASH LAYER (SOURCE OF TRUTH)

Handles ALL money movement.

Immutable: YES

---

## 2.3 INVENTORY LAYER

Operational only — NOT a financial truth (reference only).

### Inventory Scenarios

| Scenario | Creates Product? | Stock Impact | Tracking |
|----------|-----------------|-------------|----------|
| **Quick Sale** (`+ Sale`) | Yes, stock=0 | None — sale is a record only | No stock tracking |
| **Repair** (`+ 🔧 Repair`) | Yes, stock=0 | None — service only | No stock tracking |
| **Second-hand / Used** (`+ 📱 Used`) | Yes, stock=0 | None — emergency sale, item may not be in system yet | Individual IMEI/SN per item |
| **Buy In** (`+ 🛒 Buy`) | Yes | Enters second-hand inventory (positive stock) | IMEI/SN + stock qty |

### Quick Sale / Repair / Used

* Created on-the-fly via POS inline panel
* Product stock is always 0
* Checkout does NOT decrement stock (stock already 0 → skip)
* Transaction is recorded for cash ledger / financial reporting
* Used items tracked individually by IMEI/SN for warranty & audit

### Buy In

* Requires manager/root approval for stock entry
* Staff → creates pending approval request
* Manager/root → direct entry into second-hand inventory
* After approval: product in stock with quantity > 0, ready for future Used sale
* Also records expense (buy cost) and cash ledger entry

---

## 2.4 DEVICE ASSET LAYER

Separate from inventory.

Tracks:

* buy price
* lifecycle
* margin VAT

Immutable chain: YES

---

## 2.5 FINANCIAL SNAPSHOT LAYER

* daily snapshot
* monthly report

Immutable: YES

---

# 3. USER ROLES (HIERARCHY)

Hierarchy: **ROOT > MANAGER > STAFF**

Each level inherits all permissions of levels below it.

## STAFF

### Allowed
* POS checkout (sale, quick sale, refund)
* Quick add products (`+ Sale` inline panel)
* Repair service (`+ 🔧 Repair`)
* Second-hand emergency sale (`+ 📱 Used`)
* Buy In submission (`+ 🛒 Buy`) → creates pending stock request
* Search products, view catalog
* Basic refund

### Forbidden
* Manual stock entry/exit (creates pending request only)
* Modify product stock quantity
* Delete transactions
* Override VAT
* Override pricing (except manager-approved discounts)
* User management
* System settings
* View cost prices (hidden in UI)
* Delete products/users

---

## MANAGER

### Allowed (inherits all Staff permissions)
* Direct stock entry (no approval needed)
* Buy In: direct stock entry (skip pending)
* Modify product stock quantity
* Approve staff discount/refund requests
* View cost prices
* Configure POS shortcut keys

### Forbidden
* Delete transactions
* Modify VAT rates
* Change historical data
* User management (create/delete users)
* System settings
* Website management
* Invoice/VAT management

---

## ROOT (OWNER)

FULL CONTROL — all operations allowed:

* Delete / edit transactions (any time, subject to business rules)
* Modify any value (cost, price, VAT, stock)
* Override rules and constraints
* User management (create, edit, delete)
* System settings & audit log
* Export data
* Monthly report generation
* Daily close confirm
* Invoice management
* Website management

---

# 4. TRANSACTION SYSTEM

## TYPES

* sale
* quick_sale
* service (repair)
* device_sale
* refund

## SOURCES

* POS checkout (cart-based)
* POS inline panel (`+ Sale`, `+ 🔧 Repair`, `+ 📱 Used`)
* Buy In (`+ 🛒 Buy` — separate flow with stock entry + expense)

---

## RULES

MUST:

* create transaction record
* include VAT calculation
* include payment breakdown

MUST NOT:

* allow manual VAT override (except root)
* skip cash ledger entry

---

## PAYMENT

Supports:

* cash
* card
* split

MUST match total

---

# 5. VAT RULES (CRITICAL)

## STANDARD

* 23% → products
* 13.5% → services

---

## DEVICE (MARGIN VAT)

margin = sellPrice - buyPrice

IF margin > 0:
VAT = margin × rate

IF margin ≤ 0:
VAT = 0

---

## RULES

MUST:

* compute automatically
* store result in transaction

MUST NOT:

* accept manual VAT input

---

# 6. INVENTORY RULES

## Principles

* Inventory is **reference only** — never blocks a sale
* Quick sale / repair / used emergency sale: **no stock movement** (stock=0, skipped at checkout)
* Buy In: adds to second-hand inventory (positive stock)

## Rules

MUST:

* record stock movement (for inventory-tracked items)

ALLOWED:

* negative stock (for reference-tracked items)
* selling without stock

MUST NOT:

* block sale due to insufficient stock

## Stock Movement Behavior

| Context | Stock Change | Condition |
|---------|-------------|-----------|
| Normal checkout | `stock -= qty` | Only if product.stock > 0 |
| Quick sale / Repair / Used | **Skipped** | Product stock is 0 |
| Buy In (direct) | `stock += qty` | Manager/root |
| Buy In (pending) | No change | Staff — waits for approval |
| Manual stock entry | `stock += qty` | Manager/root direct; staff → pending |
| Stock exit (manual) | `stock -= qty` | Root/manager only |

---

# 7. DEVICE SYSTEM (STRICT)

## LIFECYCLE

BUY_IN → PENDING → TESTED → SOLD

---

## RULES

MUST:

* store buy price
* track status

ALLOWED:

* sell before tested (flag risk)

MUST NOT:

* delete device
* merge with inventory

---

## COST CHANGE

ONLY ROOT allowed
NO reason required

---

# 8. CASH LEDGER (STRICTEST)

## PURPOSE

ONLY source of financial truth

---

## ENTRY TYPES

* sale
* refund
* supplier
* expense
* device_buy
* bank_in
* bank_out

---

## RULES

MUST:

* create entry for EVERY money movement

MUST NOT:

* edit
* delete

---

# 9. REFUND SYSTEM

## NORMAL

* manual input allowed

---

## DEVICE

* MUST use original transaction

---

## RULES

MUST:

* create negative transaction
* create negative cash entry

---

# 10. DAILY CLOSE

## STATES

OPEN → PENDING → CLOSED

---

## FLOW

1. **OPEN** — Day is active, transactions are being recorded
2. **Run daily close** → generates snapshot with status **PENDING**
   - All transactions for the day are captured
   - Validation runs (transaction/ledger match, cash reconciliation)
   - Transactions become LOCKED (cannot be deleted while PENDING or CLOSED)
3. **Root reviews** the PENDING snapshot via status endpoint
   - Can re-generate the snapshot if needed (re-runs close, overwrites PENDING)
4. **Root confirms** → status changes to **CLOSED** (immutable)
   - Final validation re-runs before confirmation
   - Once CLOSED, the snapshot can never be modified

---

## RULES

CLOSED:

* immutable
* required for monthly reporting

PENDING:

* does NOT block transaction deletion (boss may edit during review)
* blocks monthly report generation (only CLOSED days are aggregated)
* can be re-generated (overwritten)
* can be confirmed → CLOSED (via POST /close/confirm, ROOT only)

---

# 11. DAILY SNAPSHOT

MUST include:

* total sales
* VAT output
* VAT input
* cash
* card

---

## RULES

MUST:

* be immutable

MUST NOT:

* be affected by transaction deletion

---

# 12. MONTHLY REPORT

## DATA SOURCE

Reads remaining Transactions at report generation time (NOT daily snapshots).

Rationale: Root may delete unwanted Transactions before monthly tax reporting.
Daily snapshots serve cash management; monthly reports serve tax filing.

---

## RULES

MUST:

* lock after generation
* reflect only Transactions that exist at report generation time

MUST NOT:

* be retroactively affected by Transaction deletion after generation

---

# 13. TRANSACTION DELETION

## ACCESS

ONLY ROOT (owner/boss)

---

## TIMING CONSTRAINT (CRITICAL)

### Layer 1 — Invoice Lock

Deletion is ONLY allowed BEFORE invoice snapshot generation.

Once an Invoice has been generated from a Transaction (`invoiceGenerated === true`):
→ Deletion is BLOCKED (409 conflict)

Rationale: The Invoice is a legal tax document. Its snapshot data is the financial
truth for tax reporting. Destroying the source Transaction after invoicing would
break the audit trail.

### Layer 2 — Daily Close Lock

Deletion is BLOCKED once the day's DailyClose snapshot has status **CLOSED** (confirmed by root).

**PENDING** status does NOT block deletion — the boss may delete unwanted
transactions during the review period before confirming the close.

Exception: If a MonthlyReport has been generated for that month, deletion is
allowed even for CLOSED days — the MonthlyReport becomes the immutable tax
record and underlying Transactions are no longer needed.

Rule:
* DailyClose is CLOSED AND MonthlyReport does NOT exist → BLOCK deletion
* DailyClose is CLOSED AND MonthlyReport exists → ALLOW deletion
* DailyClose is PENDING → ALLOW deletion (review period, boss may edit)
* DailyClose does NOT exist → ALLOW deletion (day still open)

---

## RULES

MUST:

* check `invoiceGenerated` flag before allowing deletion
* block deletion if `invoiceGenerated === true`
* check DailyClose existence for the transaction date (PENDING or CLOSED)
* check MonthlyReport existence for the transaction month
* block deletion if DailyClose exists but month is not yet reported
* restore product stock for each item
* remove associated StockMovement records

MUST NOT:

* affect:

  * cash ledger
  * daily snapshots
  * monthly reports
  * Invoice records

---

## 13.1 INVOICE SNAPSHOT & TAX REPORTING

### Principle

All tax reporting logic is based on the Transactions that REMAIN
at the time of invoice / tax snapshot generation.

Flow:

1. Transactions accumulate during business operations
2. Daily close runs → creates PENDING DailyClose snapshot → day's Transactions LOCKED
3. Root reviews PENDING snapshot (via GET /close/status)
4. Root confirms → CLOSED (immutable) OR re-generates snapshot if corrections needed
5. Root generates Invoices from remaining Transactions (must be from non-deleted transactions)
6. Root generates MonthlyReport → aggregates CLOSED DailyClose snapshots → becomes tax record
7. After MonthlyReport generation: Transactions for that month are UNLOCKED for cleanup
8. MonthlyReport is the SOLE tax record — immutable, stored in DB

### Lock/Unlock Summary

| State | Can Delete? |
|---|---|
| Day open | YES |
| Day PENDING (closed but unconfirmed) | YES (review period, boss may delete) |
| Day CLOSED (confirmed), month NOT reported | NO |
| Day CLOSED (confirmed), month reported | YES (monthly report is tax record) |
| Invoice generated | NO (invoice is legal document) |

### Guarantees

* Deleted Transactions never appear in tax reports
* Invoice records are immutable once created
* Daily close snapshots are immutable — for cash reconciliation
* MonthlyReport is immutable — SOLE tax record after generation
* Without MonthlyReport, transactions are protected by daily close lock

---

# 14. APPROVAL SYSTEM

## TYPES

* discount
* refund
* device

---

## FLOW

pending → approved/rejected

---

# 15. AUDIT LOG

MUST log:

* delete
* refund
* price change
* cost change

---

# 16. PRINT SYSTEM

## CHANNELS

* Print Agent (localhost:9100)
* Browser fallback

---

## RULES

MUST:

* not affect transaction
* log print result

---

# 17. ERROR HANDLING

System MUST detect:

* cash mismatch
* VAT mismatch
* unclosed days
* orphan transactions
* invalid device states

---

# 18. EDGE CASES (REAL BUSINESS)

MUST HANDLE:

* selling without stock
* selling untested device
* refund without receipt
* negative margin device sale
* manual quick sale

---

# 19. OWNER MOBILE PANEL

## PURPOSE

Remote monitoring

---

## FEATURES

* daily sales
* cash overview
* VAT summary
* pending approvals
* device status

---

## RULE

Read-only + approval only

---

# 20. AI DEVELOPMENT RULES

When generating code:

MUST:

* follow this spec strictly
* separate layers clearly
* ensure financial correctness

MUST NOT:

* simplify VAT logic
* merge systems
* ignore constraints

---

# 21. BACKUP & DATA EXPORT POLICY (HARD RULES)

## 21.1 NO AUTOMATIC BACKUP

The system does NOT provide automatic backup or restore functionality under any circumstances.

## 21.2 BACKUP IS MANUAL

Backup is handled manually by ROOT admin via export functions only.

## 21.3 EXPORT SCOPE

ROOT can export the following datasets at any time:

* transactions
* cash ledger entries
* audit log entries
* daily close reports

Each export supports:

* JSON format (full fidelity, includes all fields)
* CSV format (flat structure, suitable for spreadsheet import)

## 21.4 ADMIN RESPONSIBILITY

ROOT admin is solely responsible for:

* reviewing exported data for correctness before archiving
* deleting incorrect records directly in the system (ROOT only)
* archiving exported data to external storage (e.g. cloud storage, NAS, S3, local backup)
* maintaining external data retention in compliance with local tax laws

## 21.5 SYSTEM DISCLAIMER

The system:

* provides raw data as stored — no transformation, no aggregation
* does NOT guarantee external data retention
* is NOT responsible for data once exported
* does NOT encrypt export files (admin must secure them externally)
* does NOT provide scheduled or automated exports

## 21.6 EXPORT FORMAT RULES

JSON export MUST:

* include ALL fields from the source collection
* wrap in `{ "exportType": "...", "exportedAt": "...", "count": N, "data": [...] }`
* use ISO 8601 date strings

CSV export MUST:

* flatten nested objects to dot-notation columns (e.g. `items.name`)
* include a header row
* quote all string fields
* use comma as delimiter

---

# END OF SPEC
