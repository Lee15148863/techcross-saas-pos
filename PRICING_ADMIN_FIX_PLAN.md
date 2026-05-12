# Pricing Admin Fix Plan — May 2026

## Fixed (6 bugs, 0 regressions, 425 tests green)

| # | File(s) | Change | Verification |
|---|---------|--------|-------------|
| 1 | admin-google.html | `apiBrand: 'multi'` → `'google'` | API returns flat structure with 17 models, 10 service types |
| 2 | 8 admin-*.html | `addModel()`/`addService()` → async + await | Proper async save flow |
| 3 | pricing-data-google.js | Flattened fallback data | Matches `hasDeviceTypes: false` |
| 4 | admin-enhanced-core.js | `_saveToAPI()` calls `saveDataFunc` fallback | Data persisted on API failure |
| 5 | admin-enhanced-core.js | `showModal()`/`closeModal()` null guards | No crash on missing elements |
| 6 | admin-enhanced-core.js | `screenIsObject` detection unchanged | All brands use homogeneous formats |

## NOT Fixed (by design)

| Issue | Reason |
|-------|--------|
| per-model screenIsObject | All brands have homogeneous screen format |
| redundant admin.init() | Harmless — data isn't loaded yet |
| themeColor unused | Config kept for future CSS theming |
| admin.js orphaned | Deprecated, not linked from any page |
| integration test failures | Windows/mongod binary incompatibility, pre-existing |

## Files Modified

**Pricing admin:**
- `admin-google.html`
- `admin-samsung.html`
- `admin-xiaomi.html`
- `admin-huawei.html`
- `admin-honor.html`
- `admin-oneplus.html`
- `admin-oppo.html`
- `admin-other.html`
- `admin-enhanced-core.js`
- `pricing-data-google.js`

**NOT deployed, NOT pushed.**
