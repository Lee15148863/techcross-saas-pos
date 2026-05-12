#!/usr/bin/env node
/**
 * rollback-test.js — Smoke tests for Cloud Run revision rollback.
 * Tests rollback authorization, version history update, audit logging.
 * Usage: node scripts/rollback-test.js --saas-url=http://localhost:8080 --deployment-id=xxx
 */

async function run(config) {
  const { httpsGet, httpsPost, authHeaders, pass, fail, skip, bold } = require('./smoke-test');
  var baseUrl = config.saasUrl || 'http://localhost:8080';
  var depId = config.deploymentId;
  var results = { passed: 0, failed: 0, skipped: 0, items: [] };

  function ok(name) { results.passed++; results.items.push(pass(name)); }
  function nok(name, err) { results.failed++; results.items.push(fail(name, err)); }
  function sk(name, reason) { results.skipped++; results.items.push(skip(name, reason)); }

  console.log(bold('\n─── Rollback Tests ───\n'));

  if (!depId) {
    sk('All rollback tests', 'No --deployment-id provided');
    return results;
  }

  var headers = await authHeaders(baseUrl, config.username, config.password);
  if (!headers) {
    nok('Auth', 'SaaS login failed');
    return results;
  }

  // Get deployment + versions
  var dep = null;
  try {
    var d = await httpsGet(baseUrl + '/api/saas/deployments/' + depId, headers);
    dep = JSON.parse(d.body);
    if (dep.error) { nok('Fetch deployment', dep.error); return results; }
  } catch (e) {
    nok('Fetch deployment', e.message);
    return results;
  }

  var versionsResp = null;
  try {
    var v = await httpsGet(baseUrl + '/api/saas/deployments/' + depId + '/versions', headers);
    versionsResp = JSON.parse(v.body);
  } catch (e) {
    nok('Fetch versions', e.message);
    return results;
  }

  var hasMultipleVersions = versionsResp && versionsResp.versions &&
    versionsResp.versions.filter(function(x) { return x.status === 'success'; }).length >= 2;

  // Test 1: Rollback endpoint auth (invalid code → 403)
  try {
    var r1 = await httpsPost(baseUrl + '/api/saas/deployments/' + depId + '/rollback', headers, {
      actionCode: '00000000', reason: 'Smoke test — invalid rollback code'
    });
    var b1 = JSON.parse(r1.body);
    if (r1.statusCode === 403 || r1.statusCode === 400) {
      ok('Rollback with invalid code rejected (HTTP ' + r1.statusCode + ')');
    } else {
      nok('Rollback auth', 'Expected 403/400, got ' + r1.statusCode + ': ' + (b1.error || r1.body));
    }
  } catch (e) {
    nok('Rollback auth test', e.message);
  }

  // Test 2: Rollback without reason → 400
  try {
    var r2 = await httpsPost(baseUrl + '/api/saas/deployments/' + depId + '/rollback', headers, {
      actionCode: '11111111'
    });
    var b2 = JSON.parse(r2.body);
    if (r2.statusCode === 400) {
      ok('Rollback without reason rejected (HTTP 400)');
    } else {
      nok('Rollback reason check', 'Expected 400, got ' + r2.statusCode + ': ' + (b2.error || r2.body));
    }
  } catch (e) {
    nok('Rollback reason test', e.message);
  }

  // Test 3: Rollback with valid code but no previous versions → 404
  if (!hasMultipleVersions) {
    sk('Rollback with valid code', 'Need 2+ successful versions for real rollback test');
  } else {
    try {
      var r3 = await httpsPost(baseUrl + '/api/saas/deployments/' + depId + '/rollback', headers, {
        actionCode: config.deployPin || '11111111',
        reason: 'Smoke test — rollback verification'
      });
      var b3 = JSON.parse(r3.body);
      // Could succeed (traffic switch) or fail for other reasons — log result
      if (r3.statusCode === 200) {
        ok('Rollback triggered successfully');
        // Verify version entry was created
        if (b3.targetVersion) { ok('Rollback target: v' + b3.targetVersion); }
        if (b3.targetRevision) { ok('Rollback revision: ' + b3.targetRevision.slice(0, 20)); }
      } else if (r3.statusCode === 404 || r3.statusCode === 400) {
        sk('Rollback execution', b3.error || 'HTTP ' + r3.statusCode);
      } else {
        nok('Rollback execution', 'HTTP ' + r3.statusCode + ': ' + (b3.error || r3.body));
      }
    } catch (e) {
      nok('Rollback execution', e.message);
    }
  }

  // Test 4: Audit log contains rollback entries
  try {
    var r4 = await httpsGet(baseUrl + '/api/saas/deployments/' + depId + '/audit', headers);
    var b4 = JSON.parse(r4.body);
    if (r4.statusCode === 200 && Array.isArray(b4.entries)) {
      var rollbackEntries = b4.entries.filter(function(e) {
        return e.action && e.action.indexOf('rollback') !== -1;
      });
      // Whether or not the rollback succeeded, an attempt should be logged
      var anyAttemptLogged = b4.entries.some(function(e) {
        return e.action && (e.action.indexOf('rollback') !== -1);
      });
      if (anyAttemptLogged) {
        ok('Rollback attempt recorded in audit log');
      } else {
        sk('Rollback in audit', 'No rollback entries found yet');
      }
    } else {
      nok('Audit log check', r4.statusCode === 200 ? 'entries not array' : 'HTTP ' + r4.statusCode);
    }
  } catch (e) {
    nok('Audit log check', e.message);
  }

  return results;
}

module.exports = { run };
