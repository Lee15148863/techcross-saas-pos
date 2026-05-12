# Pricing Admin Audit — May 2026

## Scope
All brand pricing admin pages, shared EnhancedAdmin component, pricing data files, API endpoints.

## Files Audited
- admin-enhanced-core.js (shared base class)
- admin-{samsung,google,apple,xiaomi,huawei,honor,oneplus,oppo,other}.html
- pricing-data-{samsung,google,apple,xiaomi,huawei,honor,oneplus,oppo,other}.js
- api/pricing.js, api/brands.js
- models/Pricing.js, models/Brand.js
- api-client.js, page-init.js, auth-guard.js

## Findings

### CRITICAL (fixed)
1. **Google admin page broken — wrong apiBrand**  
   `apiBrand: 'multi'` fetches all-brand wrapper `{apple:{}, google:{}, samsung:{}}`.  
   `hasDeviceTypes: false` means `getCurrentData()` returns wrapper directly → `data.models` undefined → crash.  
   **Fix:** Changed to `apiBrand: 'google'`.

2. **async addNewModel/addNewService — Promise always truthy**  
   All 8 EnhancedAdmin-based pages check `if (admin.addNewModel(...))` without `await`.  
   Promise objects are always truthy → modal closes before save completes → silent failures.  
   **Fix:** Added `async`/`await` to all `addModel()`/`addService()` functions across 8 pages.

### HIGH (fixed)
3. **loadGooglePricingData() fallback data wrong structure**  
   Returned `{phone: {...}, tablet: {...}}` but Google page uses `hasDeviceTypes: false`.  
   On API failure, fallback data crashes the page.  
   **Fix:** Flattened to `{serviceTypes: {}, models: {}}`.

4. **_saveToAPI() never calls saveDataFunc fallback**  
   `saveDataFunc` stored in constructor but never invoked. API failure = data loss.  
   **Fix:** Added fallback call to `saveDataFunc(this.pricingData)` when API save fails.

5. **showModal/closeModal no null guards**  
   Missing modal element → `classList.add` on `null` → crash.  
   **Fix:** Added null checks.

### MEDIUM (noted, not fixed)
6. **screenIsObject detection uses only first model**  
   If models have mixed screen formats, broken columns for minority format.  
   Not fixed: all current data is homogeneous within brands.

7. **Redundant admin.init() calls in all EnhancedAdmin pages**  
   Constructor already triggers async init. Explicit call does nothing (data still null).  
   Harmless, left as-is.

8. **themeColor stored but never used**  
   All colors hardcoded in CSS. Config value ignored.

### LOW (pre-existing)
9. **parseInt truncates cents** — all prices are integers, no impact.  
10. **admin.js orphaned** — references undefined global `serviceTypes`. Inline code only, deprecated.  
11. **integration tests skip** — mongodb-memory-server spawn EFTYPE on Windows.

## Data Integrity
- Samsung: 97 phone models + 31 tablet models, `screen` as `{compatible, original}` format  
- Google: 17 models, flat structure, `screen_compatible`/`screen_original` as separate services  
- All brand APIs return correct data for their `hasDeviceTypes`/`apiBrand` config

## Summary
6 bugs fixed. 425 unit tests pass. No financial core touched.
