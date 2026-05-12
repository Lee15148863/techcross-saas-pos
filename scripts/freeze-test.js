#!/usr/bin/env node
/**
 * freeze-test.js — Smoke tests for readonly freeze/unfreeze lifecycle.
 * Tests SaaS freeze API, then POS behavior (login, exports, writes blocked).
 * Usage: node scripts/freeze-test.js --saas-url=http://localhost:8080 --deployment-id=xxx
 *        --store-url=http://localhost:8080 --store-password=changeme
 */

async function run(config) {
  const { httpsGet, httpsPost, authHeaders, pass, fail, skip, bold } = require('./smoke-test');
  var baseUrl = config.saasUrl || 'http://localhost:8080';
  var storeUrl = config.storeUrl;
  var depId = config.deploymentId;
  var results = { passed: 0, failed: 0, skipped: 0, items: [] };

  function ok(name) { results.passed++; results.items.push(pass(name)); }
  function nok(name, err) { results.failed++; results.items.push(fail(name, err)); }
  function sk(name, reason) { results.skipped++; results.items.push(skip(name, reason)); }

  console.log(bold('\n─── Freeze Tests ───\n'));

  if (!depId) {
    sk('All freeze tests', 'No --deployment-id provided');
    return results;
  }

  var headers = await authHeaders(baseUrl, config.username, config.password);
  if (!headers) {
    nok('Auth', 'SaaS login failed');
    return results;
  }

  // Get current deployment state
  var dep = null;
  try {
    var d = await httpsGet(baseUrl + '/api/saas/deployments/' + depId, headers);
    dep = JSON.parse(d.body);
    if (dep.error) { nok('Fetch deployment', dep.error); return results; }
  } catch (e) {
    nok('Fetch deployment', e.message);
    return results;
  }

  var originalStatus = dep.status;
  var wasFrozen = originalStatus === 'readonly_frozen';

  // Test 1: Freeze with invalid code → 403
  try {
    var r1 = await httpsPost(baseUrl + '/api/saas/deployments/' + depId + '/freeze', headers, {
      actionCode: '00000000', reason: 'Smoke test — invalid freeze code'
    });
    var b1 = JSON.parse(r1.body);
    if (r1.statusCode === 403 || r1.statusCode === 400) {
      ok('Freeze with invalid code rejected (HTTP ' + r1.statusCode + ')');
    } else {
      nok('Freeze auth', 'Expected 403/400, got ' + r1.statusCode + ': ' + (b1.error || r1.body));
    }
  } catch (e) {
    nok('Freeze auth test', e.message);
  }

  // Test 2: Freeze with valid code (skip if already frozen)
  if (wasFrozen) {
    sk('Freeze execution', 'Already frozen — unfreeze first then skip');
  } else if (dep.status === 'suspended') {
    sk('Freeze execution', 'Cannot freeze suspended deployment');
  } else {
    try {
      var r2 = await httpsPost(baseUrl + '/api/saas/deployments/' + depId + '/freeze', headers, {
        actionCode: config.deployPin || '11111111',
        reason: 'Smoke test — freeze verification'
      });
      var b2 = JSON.parse(r2.body);
      if (r2.statusCode === 200) {
        ok('Freeze executed (status → readonly_frozen)');
      } else {
        nok('Freeze execution', 'HTTP ' + r2.statusCode + ': ' + (b2.error || r2.body));
      }
    } catch (e) {
      nok('Freeze execution', e.message);
    }
  }

  // Test 3: Verify deployment status changed to readonly_frozen
  try {
    var d3 = await httpsGet(baseUrl + '/api/saas/deployments/' + depId, headers);
    var dep3 = JSON.parse(d3.body);
    if (dep3.status === 'readonly_frozen') {
      ok('Deployment status is readonly_frozen after freeze');
    } else {
      nok('Status after freeze', 'Expected readonly_frozen, got ' + dep3.status);
    }
  } catch (e) {
    nok('Status check after freeze', e.message);
    // If freeze didn't actually work, skip POS tests
    sk('POS freeze tests', 'Deployment not frozen — cannot test POS behavior');
    return results;
  }

  // ─── POS Store Tests (conditional — need store URL) ──────────────

  if (storeUrl) {
    console.log(bold('\n  ── POS Store Behavior (frozen) ──\n'));

    // Test 4: POS health still works
    try {
      var r4 = await httpsGet(storeUrl + '/api/health');
      var b4 = JSON.parse(r4.body);
      if (r4.statusCode === 200) {
        ok('POS /api/health reachable (HTTP 200)');
        if (b4.readonlyFrozen === true) {
          ok('POS readonlyFrozen flag is true');
        } else {
          nok('POS readonlyFrozen flag', 'Expected true, got ' + b4.readonlyFrozen +
            ' (note: freeze on local dev may not set env var)');
        }
      } else {
        nok('POS health', 'HTTP ' + r4.statusCode);
      }
    } catch (e) {
      nok('POS health', 'Connection failed: ' + e.message);
    }

    // Test 5: POS login still works
    try {
      var r5 = await httpsPost(storeUrl + '/api/inv/auth/login', null, {
        username: config.storeUsername || 'Lee087',
        password: config.storePassword || ''
      });
      var b5 = JSON.parse(r5.body);
      if (r5.statusCode === 200 && b5.token) {
        ok('POS login works while frozen (token received)');
      } else {
        nok('POS login while frozen', 'HTTP ' + r5.statusCode + ': ' + (b5.error || 'no token'));
      }
    } catch (e) {
      nok('POS login while frozen', e.message);
    }

    // Test 6: POS POST blocked
    try {
      var r6 = await httpsPost(storeUrl + '/api/inv/products', { 'Authorization': 'Bearer test' }, {});
      var b6 = JSON.parse(r6.body);
      // On frozen store, the POS middleware blocks with 403
      if (r6.statusCode === 403 || (b6.error && b6.error === 'STORE_FROZEN_READONLY')) {
        ok('POS POST blocked with 403/STORE_FROZEN_READONLY');
      } else {
        nok('POS POST blocked', 'Expected 403, got ' + r6.statusCode + ': ' + (b6.error || r6.body) +
          ' (note: freeze on local dev may not block writes)');
      }
    } catch (e) {
      nok('POS POST blocked', e.message);
    }

    // Test 7: POS GET still works
    try {
      var storeHeaders = await authHeaders(storeUrl, config.storeUsername || 'Lee087', config.storePassword || '');
      if (storeHeaders) {
        var r7 = await httpsGet(storeUrl + '/api/inv/products?limit=1', storeHeaders);
        if (r7.statusCode === 200) {
          ok('POS GET still works while frozen (HTTP 200)');
        } else {
          nok('POS GET while frozen', 'HTTP ' + r7.statusCode);
        }
      } else {
        sk('POS GET while frozen', 'Store login failed — cannot test GET');
      }
    } catch (e) {
      nok('POS GET while frozen', e.message);
    }
  } else {
    sk('POS store tests', 'No --store-url provided. Use --store-url=<pos-url> to test POS read-only behavior.');
    sk('POS login while frozen', 'No --store-url provided');
    sk('POS POST blocked', 'No --store-url provided');
  }

  // ─── Unfreeze ───────────────────────────────────────────────────

  console.log(bold('\n  ── Unfreeze ──\n'));

  // Test 8: Unfreeze with invalid code → 403
  try {
    var r8 = await httpsPost(baseUrl + '/api/saas/deployments/' + depId + '/unfreeze', headers, {
      actionCode: '00000000', reason: 'Smoke test — invalid unfreeze code'
    });
    var b8 = JSON.parse(r8.body);
    if (r8.statusCode === 403 || r8.statusCode === 400) {
      ok('Unfreeze with invalid code rejected (HTTP ' + r8.statusCode + ')');
    } else {
      nok('Unfreeze auth', 'Expected 403/400, got ' + r8.statusCode + ': ' + (b8.error || r8.body));
    }
  } catch (e) {
    nok('Unfreeze auth test', e.message);
  }

  // Test 9: Unfreeze with valid code
  try {
    var r9 = await httpsPost(baseUrl + '/api/saas/deployments/' + depId + '/unfreeze', headers, {
      actionCode: config.deployPin || '11111111',
      reason: 'Smoke test — unfreeze verification'
    });
    var b9 = JSON.parse(r9.body);
    if (r9.statusCode === 200) {
      ok('Unfreeze executed (status → running)');
    } else {
      nok('Unfreeze execution', 'HTTP ' + r9.statusCode + ': ' + (b9.error || r9.body));
    }
  } catch (e) {
    nok('Unfreeze execution', e.message);
  }

  // Test 10: Verify deployment unfrozen
  try {
    var d10 = await httpsGet(baseUrl + '/api/saas/deployments/' + depId, headers);
    var dep10 = JSON.parse(d10.body);
    if (dep10.status === 'running') {
      ok('Deployment restored to running after unfreeze');
    } else {
      nok('Status after unfreeze', 'Expected running, got ' + dep10.status);
    }
  } catch (e) {
    nok('Status check after unfreeze', e.message);
  }

  return results;
}

module.exports = { run };
