#!/usr/bin/env node
/**
 * deploy-test.js — Smoke tests for deploy, lock, and dangerous action verification.
 * Tests action code validation, deploy lock, version history, audit log.
 * Usage: node scripts/deploy-test.js --saas-url=http://localhost:8080 --deployment-id=xxx
 */

async function run(config) {
  const { httpsGet, httpsPost, httpsPut, httpsDel, authHeaders, pass, fail, skip, bold } = require('./smoke-test');
  var baseUrl = config.saasUrl || 'http://localhost:8080';
  var depId = config.deploymentId;
  var results = { passed: 0, failed: 0, skipped: 0, items: [] };

  function ok(name) { results.passed++; results.items.push(pass(name)); }
  function nok(name, err) { results.failed++; results.items.push(fail(name, err)); }
  function sk(name, reason) { results.skipped++; results.items.push(skip(name, reason)); }

  console.log(bold('\n─── Deploy Tests ───\n'));

  if (!depId) {
    sk('All deploy tests', 'No --deployment-id provided. Use: --deployment-id=xxx');
    return results;
  }

  var headers = await authHeaders(baseUrl, config.username, config.password);
  if (!headers) {
    nok('Auth', 'SaaS login failed — cannot run deploy tests');
    return results;
  }

  // Fetch deployment to check current status
  var dep = null;
  try {
    var d = await httpsGet(baseUrl + '/api/saas/deployments/' + depId, headers);
    dep = JSON.parse(d.body);
    if (dep.error) { nok('Fetch deployment', dep.error); return results; }
  } catch (e) {
    nok('Fetch deployment', e.message);
    return results;
  }

  var status = dep.status;
  var deployUrl = baseUrl + '/api/saas/deployments/' + depId + '/deploy';

  // Test 1: Deploy with invalid action code → 403
  if (status !== 'pending') {
    try {
      var r1 = await httpsPost(deployUrl, headers, {
        actionCode: '00000000', reason: 'Smoke test — invalid code verification'
      });
      var b1 = JSON.parse(r1.body);
      if (r1.statusCode === 403 || r1.statusCode === 400) {
        ok('Invalid action code rejected (HTTP ' + r1.statusCode + ')');
      } else {
        nok('Invalid action code', 'Expected 403/400, got ' + r1.statusCode + ': ' + (b1.error || r1.body));
      }
    } catch (e) {
      nok('Invalid action code test', e.message);
    }
  } else {
    sk('Invalid action code', 'Deployment is pending — no PIN required for first deploy');
  }

  // Test 2: Deploy lock — try deploying while already deploying
  if (status === 'deploying') {
    try {
      var r2 = await httpsPost(deployUrl, headers, {
        actionCode: config.deployPin || '11111111',
        reason: 'Smoke test — deploy lock verification'
      });
      var b2 = JSON.parse(r2.body);
      if (r2.statusCode === 409) {
        ok('Concurrent deploy rejected (HTTP 409 — deploy lock active)');
      } else {
        nok('Deploy lock', 'Expected 409, got ' + r2.statusCode + ': ' + (b2.message || r2.body));
      }
    } catch (e) {
      nok('Deploy lock test', e.message);
    }
  } else {
    sk('Deploy lock', 'Deployment is not currently deploying (status=' + status + ')');
  }

  // Test 3: Version history endpoint
  try {
    var r3 = await httpsGet(baseUrl + '/api/saas/deployments/' + depId + '/versions', headers);
    var b3 = JSON.parse(r3.body);
    if (r3.statusCode === 200) {
      ok('Version history endpoint reachable');
      if (b3.total !== undefined && b3.total >= 0) {
        ok('Version count: ' + b3.total);
      } else {
        nok('Version count', 'Missing total field');
      }
      if (Array.isArray(b3.versions)) {
        ok('Versions is an array (' + b3.versions.length + ' entries)');
      } else {
        nok('Versions type', 'Expected array, got ' + typeof b3.versions);
      }
    } else {
      nok('Version history', 'HTTP ' + r3.statusCode + ': ' + (b3.error || r3.body));
    }
  } catch (e) {
    nok('Version history', e.message);
  }

  // Test 4: Audit log endpoint
  try {
    var r4 = await httpsGet(baseUrl + '/api/saas/deployments/' + depId + '/audit', headers);
    var b4 = JSON.parse(r4.body);
    if (r4.statusCode === 200) {
      ok('Audit log endpoint reachable');
      if (Array.isArray(b4.entries)) {
        ok('Audit entries array (' + b4.entries.length + ' entries)');
        // Verify entry structure
        if (b4.entries.length > 0) {
          var e = b4.entries[0];
          if (e.action) { ok('Audit entry has action field: ' + e.action); }
          else { nok('Audit entry', 'Missing action field'); }
        } else {
          sk('Audit entry content', 'No audit entries to validate');
        }
      } else {
        nok('Audit entries', 'Expected array, got ' + typeof b4.entries);
      }
    } else {
      nok('Audit log', 'HTTP ' + r4.statusCode + ': ' + (b4.error || r4.body));
    }
  } catch (e) {
    nok('Audit log', e.message);
  }

  // Test 5: Rate limiting — send rapid requests
  try {
    var rapidOk = 0;
    for (var i = 0; i < 3; i++) {
      var r5 = await httpsPost(deployUrl, headers, {
        actionCode: '00000000', reason: 'Smoke test — rate limit check'
      });
      if (r5.statusCode === 429) { rapidOk++; }
    }
    if (rapidOk > 0) {
      ok('Rate limiting engaged (got ' + rapidOk + 'x 429)');
    } else {
      sk('Rate limiting', 'No 429 responses — limit may be higher than 3 rapid requests');
    }
  } catch (e) {
    sk('Rate limiting', 'Request error: ' + e.message);
  }

  return results;
}

module.exports = { run };
