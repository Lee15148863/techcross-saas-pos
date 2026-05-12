# Architecture Map — TechCross POS/ERP

## System Topology

```
┌──────────────────────────────────────────────────────────┐
│                    L1 — UI LAYER                          │
│  (HTML/CSS/JS — NO business logic, NO VAT, NO totals)    │
│                                                          │
│  inv-pos.html       POS till (cart, checkout, refund)     │
│  inv-*.html         Products, stock, suppliers, reports   │
│  admin*.html        Website pricing admin pages           │
│  admin-brands.html  Multi-brand pricing UI                │
│  admin-{brand}.html Per-brand pricing (apple, samsung...) │
│  boss.html          Root control panel                    │
│  boss-audit.html    Audit log viewer                      │
│  whatsapp-center.*  WhatsApp customer comms               │
│  pricing.html       Public pricing page                   │
│  announcement-admin.* Announcement management             │
│  find-model.html    Model lookup                          │
│  auth-guard.js      Frontend auth module (JWT)            │
│  inv-common.js      Common API fetch, auth helpers        │
│  page-init.js       Async pricing page loader             │
│  admin-enhanced-core.js  Base brand admin class           │
│  api-client.js      PricingAPI frontend client            │
│  lang.js            EN/ZH bilingual system                │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP (fetch)
                       ▼
┌──────────────────────────────────────────────────────────┐
│                 L2 — SERVICE LAYER                         │
│  (Business logic, VAT, transactions, ledger writes)       │
│                                                          │
│  services/inv-checkout-service.js     Checkout atomic     │
│  services/inv-refund-service.js       Refund processing   │
│  services/inv-daily-close-service.js  Daily close         │
│  services/inv-query-service.js        Transaction queries │
│  services/inv-receipt-delivery-service.js  Email receipt  │
│  services/inv-invoice-delivery-service.js Email invoice   │
│  services/inv-invoice-pdf.js          PDF generation      │
│  services/inv-admin-service.js        Admin audit log     │
│  services/inv-share-service.js        Public share tokens │
└──────────────────────┬───────────────────────────────────┘
                       │ MongoDB operations (atomic sessions)
                       ▼
┌──────────────────────────────────────────────────────────┐
│         L3 — FINANCIAL CORE LAYER                         │
│  (Immutability, integrity, audit enforcement)             │
│                                                          │
│  utils/inv-integrity-layer.js    authorize(), VAT check   │
│  utils/inv-vat-calculator.js     23%/13.5%/margin VAT     │
│  utils/inv-discount-calculator.js Discount distribution   │
│  utils/inv-receipt-generator.js   Receipt data structure  │
│  utils/inv-receipt-number.js      TYPE-YYYYMMDDHHmmss-XXX │
│  utils/inv-reconciliation.js      Transaction/ledger match│
│  utils/inv-system-lock.js         Emergency pause/lock    │
│  utils/inv-validators.js          Input validation        │
└──────────────────────┬───────────────────────────────────┘
                       │ Mongoose
                       ▼
┌──────────────────────────────────────────────────────────┐
│                  MODELS (MongoDB)                          │
│                                                          │
│  FINANCIAL IMMUTABLE:                                     │
│    CashLedger       Append-only money movement            │
│    DailyClose       PENDING→CLOSED (immutable)            │
│    MonthlyReport    Tax snapshot (immutable)              │
│    Invoice          Invoice snapshot (immutable fields)   │
│                                                          │
│  FINANCIAL MUTABLE (root only):                           │
│    Transaction      Sales, refunds, services              │
│    Device           Second-hand lifecycle (immutable)     │
│    Expense          Business expenses                     │
│                                                          │
│  OPERATIONAL:                                             │
│    Product, StockMovement, StockRequest                   │
│    Supplier, PurchaseOrder                                │
│    User, AuditLog, LoginLog, TrustedDevice                │
│    CustomerNote, SystemState, SystemSetting               │
│    PosShortcut, ShareToken                                │
│                                                          │
│  WEBSITE:                                                 │
│    Brand, Pricing, Review                                 │
└──────────────────────────────────────────────────────────┘
```

## Data Flow: Checkout

```
inv-pos.html
  │ POST /api/inv/transactions/calculate (server-side totals)
  │ POST /api/inv/transactions/checkout
  ▼
api/inv/transactions.js → inv-checkout-service.checkout()
  │ 1. Validate input, check system lock
  │ 2. Start MongoDB session → startTransaction()
  │ 3. Transaction.create(items, payment, VAT from server calc)
  │ 4. CashLedger.create(entryType:'sale', direction:'in')
  │ 5. Device lifecycle (if device items)
  │ 6. commitTransaction()
  │ 7. Best-effort stock movement (outside session)
  ▼
Response: { receiptNumber, totalAmount, ... }
```

## Data Flow: Invoice Generation

```
boss.html → POST /api/inv/invoices/:transactionId/generate
  ▼
api/inv/invoices.js
  │ 1. Find transaction, check invoiceGenerated flag
  │ 2. Snapshot company info + transaction data
  │ 3. Invoice.create() — NO SESSION
  │ 4. transaction.invoiceGenerated = true — NO SESSION
  │ 5. Generate PDF (async)
  ▼
Response: { invoiceUrl, pdfPath }
```

## Data Flow: Daily Close

```
boss.html → POST /api/inv/close/run
  ▼
api/inv/close.js → inv-daily-close-service.closeDay()
  │ 1. Check system active
  │ 2. Fetch ALL transactions for date range (no lock)
  │ 3. Validate transaction/ledger match
  │ 4. Create DailyClose snapshot (status: 'pending')
  │   ⚠ GAP: Transaction created between (2) and (4) is MISSED
  │
  Later: POST /api/inv/close/confirm → confirmDay()
  │ 1. findOne({date, status:'pending'}) — RACE WINDOW
  │ 2. Re-validate
  │ 3. save({status:'closed'}) — LAST WRITE WINS
  ▼
DailyClose is now CLOSED (immutable)
```

## Key Architectural Decisions

1. **Inventory is NOT financial truth** — stock can go negative, sales never block on stock
2. **CashLedger is ONLY financial truth** — append-only, immutable
3. **Transactions are mutable by ROOT** — but must maintain referential integrity
4. **DailyClose locks transactions** — but only after CLOSED state
5. **MonthlyReport is ultimate tax record** — generated from remaining transactions
6. **3-layer separation** — L1 never calculates, L2 is single source of truth, L3 enforces rules
