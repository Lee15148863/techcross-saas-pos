#!/usr/bin/env node
/**
 * health-test.js — Smoke tests for SaaS deployment health endpoint.
 * Tests /api/health reachability, mongo state, revision, version.
 * Usage: node scripts/health-test.js --saas-url=http://localhost:8080
 */

async function run(config) {
  const { httpsGet, pass, fail, skip, bold } = require('./smoke-test');
  var baseUrl = config.saasUrl || 'http://localhost:8080';
  var results = { passed: 0, failed: 0, skipped: 0, items: [] };

  function ok(name) { results.passed++; results.items.push(pass(name)); }
  function nok(name, err) { results.failed++; results.items.push(fail(name, err)); }
  function sk(name, reason) { results.skipped++; results.items.push(skip(name, reason)); }

  console.log(bold('\n─── Health Tests ───\n'));

  // Test 1: Health endpoint reachable
  try {
    var resp = await httpsGet(baseUrl + '/api/health');
    var body = JSON.parse(resp.body);

    if (resp.statusCode !== 200) { nok('Health endpoint', 'HTTP ' + resp.statusCode); }
    else { ok('Health endpoint reachable (HTTP 200)'); }

    // Test 2: status = ok
    if (body.status === 'ok') { ok('Health status is "ok"'); }
    else { nok('Health status', 'Expected "ok", got "' + body.status + '"'); }

    // Test 3: mongo field present
    if (body.mongo !== undefined && body.mongo !== null) {
      var mongoOk = body.mongo === 1;
      if (mongoOk) { ok('Mongo connected (readyState=1)'); }
      else { nok('Mongo state', 'Expected readyState 1, got ' + body.mongo +
        ' (try seeding the database first: npm run seed)'); }
    } else {
      nok('Mongo field', 'body.mongo missing from /api/health response');
    }

    // Test 4: revision returned
    if (body.revision !== undefined) {
      ok('Revision field present' + (body.revision ? ' (' + body.revision.slice(0, 12) + ')' : ''));
    } else {
      nok('Revision field', 'Missing from response');
    }

    // Test 5: version returned
    if (body.version !== undefined) {
      ok('Version field present' + (body.version ? ' (' + body.version + ')' : ''));
    } else {
      nok('Version field', 'Missing from response');
    }

    // Test 6: uptime returned
    if (body.uptime !== undefined && typeof body.uptime === 'number') {
      ok('Uptime field present (' + Math.floor(body.uptime / 60) + 'm)');
    } else {
      nok('Uptime field', 'Missing or not a number');
    }

    // Test 7: readonlyFrozen flag
    if (body.readonlyFrozen !== undefined) {
      ok('readonlyFrozen flag present (' + body.readonlyFrozen + ')');
    } else {
      nok('readonlyFrozen flag', 'Missing from response');
    }
  } catch (e) {
    nok('Health endpoint', 'Connection failed: ' + e.message);
  }

  return results;
}

module.exports = { run };
