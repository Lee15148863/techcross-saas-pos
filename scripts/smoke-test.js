#!/usr/bin/env node
/**
 * smoke-test.js — Production validation smoke-test suite for TechCross SaaS.
 *
 * Orchestrates health, deploy, rollback, and freeze tests.
 * Each test is a standalone module in scripts/*-test.js
 *
 * Usage:
 *   node scripts/smoke-test.js
 *   node scripts/smoke-test.js --saas-url=http://localhost:8080
 *   node scripts/smoke-test.js --saas-url=https://saas.techcross.ie --deployment-id=xxx
 *   node scripts/smoke-test.js --store-url=http://localhost:8080 --store-password=changeme
 *
 * Environment variables (fallback):
 *   SAAS_URL, SAAS_USERNAME, SAAS_PASSWORD, STORE_URL, STORE_USERNAME, STORE_PASSWORD
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — some tests failed
 *   2 — configuration error
 */

// ─── Color output ─────────────────────────────────────────────────────────

var RED     = '\x1b[31m';
var GREEN   = '\x1b[32m';
var YELLOW  = '\x1b[33m';
var CYAN    = '\x1b[36m';
var BOLD    = '\x1b[1m';
var DIM     = '\x1b[2m';
var RESET   = '\x1b[0m';

function pass(name) { return '  ' + GREEN + '✓' + RESET + ' ' + name; }
function fail(name, err) { return '  ' + RED + '✗' + RESET + ' ' + name + DIM + ' — ' + (err || 'failed') + RESET; }
function skip(name, reason) { return '  ' + YELLOW + '—' + RESET + ' ' + name + DIM + ' (skipped: ' + reason + ')' + RESET; }
function bold(s) { return BOLD + s + RESET; }
function dim(s) { return DIM + s + RESET; }

// ─── HTTP helpers (native https/http, no deps) ────────────────────────────

function httpReq(method, urlStr, headers, body, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var http = require('http');
    var https = require('https');
    var parsedUrl = new URL(urlStr);
    var transport = parsedUrl.protocol === 'https:' ? https : http;

    var opts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: method,
      timeout: timeoutMs || 15000,
      headers: { 'Accept': 'application/json' }
    };

    if (headers) {
      Object.keys(headers).forEach(function(k) { opts.headers[k] = headers[k]; });
    }

    if (body) {
      var bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    var req = transport.request(opts, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve({ statusCode: res.statusCode, headers: res.headers, body: data }); });
    });

    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout after ' + (timeoutMs || 15000) + 'ms')); });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function httpsGet(urlStr, headers) { return httpReq('GET', urlStr, headers, null); }
function httpsPost(urlStr, headers, body) { return httpReq('POST', urlStr, headers, body); }
function httpsPut(urlStr, headers, body) { return httpReq('PUT', urlStr, headers, body); }
function httpsDel(urlStr, headers) { return httpReq('DELETE', urlStr, headers, null); }

// ─── Auth helper ──────────────────────────────────────────────────────────

async function authHeaders(baseUrl, username, password) {
  if (!username || !password) return null;
  try {
    var resp = await httpsPost(baseUrl + '/api/saas/auth/login', null, { username: username, password: password });
    var data = JSON.parse(resp.body);
    if (resp.statusCode === 200 && data.token) {
      return { 'Authorization': 'Bearer ' + data.token, 'Content-Type': 'application/json' };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ─── CLI argument parsing ─────────────────────────────────────────────────

function parseArgs() {
  var args = {};
  process.argv.slice(2).forEach(function(arg) {
    if (arg.indexOf('=') !== -1) {
      var parts = arg.split('=');
      var key = parts[0].replace(/^--/, '');
      args[key] = parts.slice(1).join('=');
    } else if (arg.indexOf('--') === 0) {
      args[arg.replace(/^--/, '')] = true;
    }
  });
  return args;
}

// ─── Summary reporter ─────────────────────────────────────────────────────

function printSummary(results) {
  var totalPassed = 0, totalFailed = 0, totalSkipped = 0;
  results.forEach(function(r) {
    totalPassed += r.passed;
    totalFailed += r.failed;
    totalSkipped += r.skipped;
    r.items.forEach(function(item) { console.log(item); });
  });

  console.log(bold('\n═══════════════════════════════════════════'));
  console.log(bold('  RESULTS SUMMARY'));
  console.log('═══════════════════════════════════════════');
  if (totalPassed > 0)  console.log('  ' + GREEN + '✓ ' + totalPassed + ' passed' + RESET);
  if (totalFailed > 0)  console.log('  ' + RED + '✗ ' + totalFailed + ' failed' + RESET);
  if (totalSkipped > 0) console.log('  ' + YELLOW + '— ' + totalSkipped + ' skipped' + RESET);
  console.log('───────────────────────────────────────────');

  if (totalFailed > 0) {
    console.log('  ' + RED + 'RESULT: FAILED (' + totalFailed + ' test(s) failed)' + RESET);
  } else if (totalPassed > 0) {
    console.log('  ' + GREEN + 'RESULT: ALL PASSED' + RESET);
  } else {
    console.log('  ' + YELLOW + 'RESULT: NO TESTS RAN (all skipped)' + RESET);
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  var args = parseArgs();

  var config = {
    saasUrl:       args['saas-url']       || process.env.SAAS_URL       || 'http://localhost:8080',
    storeUrl:      args['store-url']      || process.env.STORE_URL      || '',
    username:      args['username']       || process.env.SAAS_USERNAME  || 'admin',
    password:      args['password']       || process.env.SAAS_PASSWORD  || '',
    deploymentId:  args['deployment-id']  || process.env.DEPLOYMENT_ID  || '',
    storeUsername: args['store-username'] || process.env.STORE_USERNAME || 'Lee087',
    storePassword: args['store-password'] || process.env.STORE_PASSWORD || '',
    deployPin:     args['deploy-pin']     || process.env.DEPLOY_PIN     || '11111111'
  };

  if (args['help'] || args['h']) {
    console.log(bold('\nTechCross SaaS Smoke Tests'));
    console.log('');
    console.log('  node scripts/smoke-test.js [options]');
    console.log('');
    console.log('  Options:');
    console.log('    --saas-url=<url>        SaaS manager URL (default: http://localhost:8080)');
    console.log('    --store-url=<url>       POS store URL for freeze tests');
    console.log('    --username=<user>       SaaS admin username (default: admin)');
    console.log('    --password=<pass>       SaaS admin password');
    console.log('    --deployment-id=<id>    Deployment ID to test against');
    console.log('    --deploy-pin=<pin>      Deployment PIN for dangerous actions');
    console.log('    --store-username=<user> POS store username (default: Lee087)');
    console.log('    --store-password=<pass> POS store password');
    console.log('    --help                  Show this help');
    console.log('');
    console.log('  Environment variables:');
    console.log('    SAAS_URL, SAAS_USERNAME, SAAS_PASSWORD, STORE_URL,');
    console.log('    STORE_USERNAME, STORE_PASSWORD, DEPLOYMENT_ID, DEPLOY_PIN');
    console.log('');
    process.exit(0);
  }

  console.log(bold('\n╔═══════════════════════════════════════════════╗'));
  console.log(bold('║     TechCross SaaS Smoke Tests               '));
  console.log(bold('╚═══════════════════════════════════════════════╝'));
  console.log(dim('  Target: ' + config.saasUrl));
  if (config.deploymentId) console.log(dim('  Deployment: ' + config.deploymentId));
  if (config.storeUrl) console.log(dim('  Store: ' + config.storeUrl));
  console.log('');

  // Verify minimum config
  if (!config.password) {
    console.log(RED + 'ERROR: --password or SAAS_PASSWORD required' + RESET);
    console.log('  Pass --password=<password> or set SAAS_PASSWORD env var');
    console.log('  Use --help for full options\n');
    process.exit(2);
  }

  var allResults = [];

  // Run test suites sequentially
  var suites = [
    { name: 'Health',  mod: './health-test' },
    { name: 'Deploy',  mod: './deploy-test' },
    { name: 'Rollback', mod: './rollback-test' },
    { name: 'Freeze',  mod: './freeze-test' }
  ];

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    try {
      var testMod = require(s.mod);
      var result = await testMod.run(config);
      allResults.push(result);
    } catch (e) {
      console.error(RED + 'ERROR loading ' + s.name + ' tests: ' + e.message + RESET);
      allResults.push({ passed: 0, failed: 1, skipped: 0, items: [fail(s.name + ' suite', e.message)] });
    }
  }

  printSummary(allResults);

  var totalFailed = allResults.reduce(function(sum, r) { return sum + r.failed; }, 0);
  process.exit(totalFailed > 0 ? 1 : 0);
}

// Export for sub-test use
module.exports = { httpsGet, httpsPost, httpsPut, httpsDel, authHeaders, pass, fail, skip, bold, dim };

// Run if called directly
if (require.main === module) { main(); }
