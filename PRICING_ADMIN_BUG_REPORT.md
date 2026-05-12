# Pricing Admin Bug Report — May 2026

## Bug #1: Google admin page completely broken
- **Severity:** CRITICAL — page does not render
- **File:** `admin-google.html:124`
- **Root cause:** `apiBrand: 'multi'` fetches `/api/pricing/multi` which returns multi-brand wrapper `{apple:{}, google:{}, samsung:{}, ...}`. `hasDeviceTypes: false` means `getCurrentData()` returns the wrapper directly. `data.models` is `undefined` because `models` is nested under `data.google.models`.
- **Fix:** Changed `apiBrand: 'multi'` → `apiBrand: 'google'`

## Bug #2: Modal closes before save completes
- **Severity:** CRITICAL — user sees no error on save failure
- **Files:** 8 admin pages (samsung, google, xiaomi, huawei, honor, oneplus, oppo, other)
- **Root cause:** `admin.addNewModel()` and `admin.addNewService()` are `async` (return Promise). `function addModel()` is synchronous, and `if (admin.addNewModel(...))` checks a Promise (always truthy). Modal closes immediately regardless of save outcome.
- **Fix:** Made `addModel()`/`addService()` async, added `await`

## Bug #3: Google fallback data crashes page
- **Severity:** HIGH — page breaks when API unavailable
- **File:** `pricing-data-google.js`
- **Root cause:** `loadGooglePricingData()` returns `{phone: {models, serviceTypes}, tablet: {models, serviceTypes}}` but Google page uses `hasDeviceTypes: false` (flat structure expected)
- **Fix:** Changed return to `{serviceTypes: {}, models: {}}`

## Bug #4: No save fallback on API failure
- **Severity:** HIGH — data loss risk
- **File:** `admin-enhanced-core.js:_saveToAPI()`
- **Root cause:** `saveDataFunc` stored but never called. API failure silently loses data.
- **Fix:** Added `saveDataFunc(this.pricingData)` fallback call

## Bug #5: showModal/closeModal crashes on missing element
- **Severity:** MEDIUM — crash on malformed page
- **File:** `admin-enhanced-core.js`
- **Root cause:** No null guard before `classList.add/remove`
- **Fix:** Added null checks
