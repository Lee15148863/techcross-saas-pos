# Context Transfer — Remaining Tasks

## How to Continue
Copy this entire section into a new Kiro chat to resume work.

---

## Project Info
- **Repo**: `https://github.com/Lee15148863/teschcross`
- **Local path**: `~/Documents/workspace/techcross/teschcross/`
- **Branch**: `main`, auto-deploys to `techcross.ie` via Cloud Run
- **Admin login**: username `Lee087`
- **Git rules**: Don't push without permission. Commit first, push when user says "push".
- **Security**: Don't display credentials in chat.

---

## Remaining Tasks (Priority Order)

### Task 1: POS UI — Remove inline styles/onclick (HIGH)
- File: `teschcross/inv-pos.html`
- Move all inline `onclick="..."` to JS event listeners
- Move all inline `style="..."` to CSS classes
- Keep all existing functionality intact
- Test: all buttons, shortcuts, cart, checkout, receipt still work

### Task 2: All inv-* pages — Sidebar permission hiding (HIGH)
- Files: `inv-products.html`, `inv-stock.html`, `inv-suppliers.html`, `inv-purchases.html`, `inv-reports.html`, `inv-invoices.html`, `inv-settings.html`, `inv-users.html`
- Each page has a sidebar with nav links
- Add `data-perm="xxx"` to each nav link
- In JS: read `user.permissions` from localStorage, hide links where permission is false
- Admin sees all. Staff sees only permitted modules.
- Reference: `inv-transactions.html` already has this implemented

### Task 3: All inv-* pages — Bilingual labels (MEDIUM)
- All 14 inv-*.html pages need Chinese + English labels
- Format: `Chinese / English` (e.g. "商品管理 / Products")
- Sidebar nav, page titles, table headers, button labels, form labels
- Output (receipts, reports) stays English only
- POS page already has i18n system — other pages need similar

### Task 4: inv-expenses.html — Complete frontend (MEDIUM)
- API exists at `/api/inv/expenses`
- Need a proper frontend page with:
  - Add expense form (category, amount, payment method, date, description)
  - Expense list with date filter
  - Category summary
  - Delete button (admin only)
- Categories: Lyca Credit, 收购客人商品, 店铺杂费, 其他

### Task 5: Local Till version — Sync latest code (LOW)
- Desktop app at `~/Desktop/Till/`
- Copy updated HTML files from teschcross/public to Till/public
- Update Till server routes to match latest teschcross API changes
- Rebuild: `cd ~/Desktop/Till && npx electron-builder --win --dir`

---

## Key Architecture Notes

### Permission System
- User model: `models/inv/User.js` has `permissions` field with 13 boolean keys
- Admin always has all permissions (via `getPermissions()` method)
- Login API returns `user.permissions` object
- Frontend stores in `localStorage('inv_user')`
- Check: `var perms = user.permissions || {}; if (perms.products) { show(); }`

### POS Page Structure (inv-pos.html)
- Left panel (35%): search + inline Sale/Repair/Used panels
- Right panel (65%): action bar (dark) + cart table + checkout area
- Keyboard: F1=Search, F2=Discount, F3=Card/Cash, F4=Print, F5=New, F6=Orders
- Cart state: `cart[]` array, `selectedCartIndex`, `orderDiscount`, `paymentMethod`
- i18n: `lang` variable, `i18n.zh` / `i18n.en` objects, `t(key)` function, `updateLang()`

### Receipt System
- POS: `buildReceiptPreviewHtml(r)` generates HTML
- Transactions page: inline HTML in `reprintReceipt()`
- Print: tries localhost:9100 Print Agent first, falls back to browser print
- Size: 68mm width, font-weight:600, @page size:68mm auto

### Reports API
- `/api/inv/reports/daily?date=YYYY-MM-DD`
- `/api/inv/reports/weekly?startDate=YYYY-MM-DD`
- `/api/inv/reports/monthly?month=YYYY-MM`
- 4 VAT categories: standard23, margin, reduced135, lycaCredit
- Includes expenses from Expense table
- netCash = cash income - cash expenses
- cashWarning when netCash < 0
