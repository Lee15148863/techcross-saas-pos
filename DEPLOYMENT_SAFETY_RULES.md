# Deployment & Safety Rules

## CRITICAL DEPLOYMENT RULE

Claude/AI assistant is NEVER allowed to:
- Push directly to production server
- Deploy automatically
- Overwrite live production files
- Restart production services without permission

---

# Required Deployment Workflow

## BEFORE ANY LARGE CHANGE

MANDATORY:

Create backup first.

Examples:
- Git commit snapshot
- Zip backup
- Database dump
- Full project backup
- Config backup

Large changes include:
- Database schema changes
- Authentication changes
- POS flow changes
- VAT logic changes
- Financial system changes
- Deployment changes
- Major UI refactor
- Multi-file architecture changes

---

# Backup Rules

Before major modification:

```txt
1. Create backup
2. Explain planned changes
3. Wait for approval
4. Execute changes
5. Test changes
6. Ask before deployment
```

---

# Production Server Rules

## Deployment Permission Required

IMPORTANT:

Even if all work is completed successfully:

Claude/AI assistant MUST:
- Ask for confirmation first
- Explain what will be deployed
- Explain affected areas
- Wait for explicit approval

Before:
- Git push
- SCP upload
- Docker deploy
- PM2 restart
- Nginx reload
- Production database migration

---

# Forbidden Actions

NEVER:
- Auto-deploy to production
- Force overwrite production files
- Delete production database
- Run destructive migrations automatically
- Modify live financial data
- Deploy untested code

---

# Recommended Deployment Workflow

```txt
Development
→ Local testing
→ Backup
→ Approval
→ Deploy
→ Verify
→ Production confirmation
```

---

# Git Rules

Before major edits:

```bash
git add .
git commit -m "backup before major changes"
```

---

# Database Rules

Before:
- Schema changes
- Financial logic changes
- VAT changes
- Device lifecycle changes

MUST:
- Export MongoDB backup
- Preserve rollback capability

---

# AI Assistant Behavior

The AI assistant should:
- Be conservative with production
- Prioritize data safety
- Prioritize rollback capability
- Never assume deployment approval

Always ask:

```txt
The changes are complete.
Would you like me to deploy/push them now?
```

---

# TechCross Philosophy

Production safety is more important than:
- Speed
- Automation
- Convenience

Financial and customer data integrity is critical.

---

# CRITICAL TAX & INVOICE PROTECTION RULES

## ABSOLUTELY CRITICAL

The VAT system, accounting logic, invoice system, and financial workflow are considered:

```txt
NEARLY PRODUCTION COMPLETE
```

These systems are now highly sensitive.

---

# STRICT PROTECTION RULE

WITHOUT EXPLICIT PERMISSION:

Claude/AI assistant MUST NEVER:
- Modify VAT logic
- Modify invoice calculations
- Modify tax formulas
- Modify financial workflows
- Modify accounting structure
- Modify margin VAT logic
- Modify Irish VAT handling
- Modify invoice numbering logic
- Modify payment reconciliation logic
- Modify report generation logic

---

# TRIPLE CONFIRMATION RULE

If ANY change may affect:
- VAT
- invoices
- accounting
- reports
- financial calculations
- reconciliation
- supplier invoices
- tax handling

Claude MUST:

```txt
1. Warn clearly
2. Explain exact impact
3. Ask for confirmation
4. Reconfirm again
5. Confirm one final time
6. Only then proceed
```

Minimum:
```txt
THREE EXPLICIT CONFIRMATIONS REQUIRED
```

---

# Examples Of Protected Systems

Protected areas include:

## VAT Engine
- 23% VAT
- 13.5% VAT
- Margin VAT
- Input/output VAT
- VAT reports

---

## Invoice System
- Invoice numbering
- Totals
- VAT display
- Tax calculations
- Supplier invoice handling
- Receipt generation
- Refund invoice logic

---

## Financial Logic
- Daily close
- Monthly reports
- Cash reconciliation
- Device profit calculations
- Margin calculations

---

# REQUIRED AI RESPONSE

Before touching protected systems:

Claude MUST say something similar to:

```txt
WARNING:
This change affects protected financial/tax systems.

The current VAT/invoice/accounting logic is considered production-stable.

This modification may impact:
- VAT reporting
- invoice totals
- accounting consistency
- financial reports

Triple confirmation is required before proceeding.
```

---

# SAFE DEVELOPMENT RULE

Preferred workflow:

```txt
Create backup
→ Explain impact
→ Triple confirmation
→ Apply changes
→ Re-test calculations
→ Verify reports
→ Ask before deployment
```

---

# PRIORITY ORDER

Priority is:

```txt
Financial correctness
> Tax compliance
> Data safety
> Stability
> Features
> UI improvements
```

---

# IMPORTANT PHILOSOPHY

This is NOT a toy POS system.

This is a REAL Irish retail financial system.

Incorrect VAT or invoice behavior can:
- break accounting
- break compliance
- create Revenue issues
- create customer disputes
- corrupt reports

Therefore:

```txt
Financial systems must be treated as HIGH RISK infrastructure.
```
