const https = require('https');

let authClient = null;

async function getClient() {
  if (!authClient) {
    const { GoogleAuth } = require('google-auth-library');
    authClient = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  const client = await authClient.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

function gcpRequest(method, path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const msg = parsed.error && (parsed.error.message || parsed.error.status)
              ? (parsed.error.message || parsed.error.status) : JSON.stringify(parsed);
            reject(new Error(msg));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('GCP API parse error: ' + (data.slice(0, 200) || e.message)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GCP API timeout')); });
    req.end();
  });
}

function gcpRequestWithBody(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path);
    const data = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 60000
    };
    const req = https.request(opts, (res) => {
      let resp = '';
      res.on('data', (chunk) => (resp += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(resp);
          if (res.statusCode >= 400) {
            const msg = parsed.error && (parsed.error.message || parsed.error.status)
              ? (parsed.error.message || parsed.error.status) : JSON.stringify(parsed);
            reject(new Error(msg));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('GCP API parse error: ' + (resp.slice(0, 200) || e.message)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GCP API timeout')); });
    req.write(data);
    req.end();
  });
}

/**
 * Escape a string value for safe inclusion in a YAML double-quoted string.
 * Handles escaped backslashes, double-quotes, newlines, and control chars.
 */
function yamlQuote(val) {
  var s = String(val);
  s = s.replace(/\\/g, '\\\\');
  s = s.replace(/"/g, '\\"');
  s = s.replace(/\n/g, '\\n');
  s = s.replace(/\r/g, '\\r');
  s = s.replace(/\t/g, '\\t');
  return '"' + s + '"';
}

/**
 * Determine if a YAML scalar value needs quoting.
 */
function needsQuoting(val) {
  if (val === '') return true;
  return /[:\{\}\[\],&\*\?!|>'"%@`#\s]/.test(val) || /^(true|false|yes|no|on|off|null|undefined|\d+\.?\d*)$/i.test(val);
}

/**
 * Build a heredoc-safe YAML string from a key-value map.
 */
function buildYamlEnv(vars) {
  var lines = [];
  for (var i = 0; i < vars.length; i++) {
    var key = vars[i].key;
    var val = String(vars[i].value == null ? '' : vars[i].value);
    if (needsQuoting(val)) {
      lines.push(key + ': ' + yamlQuote(val));
    } else {
      lines.push(key + ': ' + val);
    }
  }
  return lines.join('\n');
}

/**
 * Trigger a Cloud Build job to build and deploy a store service.
 * Uses --env-vars-file to safely pass all environment variables.
 * Returns { buildId, imageTag } on success.
 *
 * @param {string} gitCommit  — optional SHA. Passed into env for runtime tracking.
 */
async function triggerDeployBuild(projectId, region, serviceName, storeName, mongoUri, envOverrides, gitCommit) {
  const token = await getClient();

  // ── Enforce pinned tags — never deploy 'latest' ──────────────────────
  if (/latest/i.test(serviceName)) {
    throw new Error('Service name contains "latest" — floating tags are forbidden');
  }

  const buildId = (gitCommit || serviceName + '-' + Date.now()).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 63);
  const imageTag = region + '-docker.pkg.dev/' + projectId + '/cloud-run-source-deploy/' + serviceName + ':' + buildId;

  if (/latest/i.test(imageTag)) {
    throw new Error('Generated image tag contains "latest" — floating tags are forbidden');
  }

  var envVars = [
    { key: 'NODE_ENV', value: 'production' },
    { key: 'PORT', value: '8080' },
    { key: 'STORE_NAME', value: storeName },
    { key: 'MONGO_URI', value: mongoUri },
    { key: 'DBCon', value: mongoUri },
    { key: 'DOMAIN', value: serviceName },
    { key: 'COMPANY_NAME', value: storeName },
    { key: 'GOOGLE_ANALYTICS_ID', value: '' },
    { key: 'PRINT_AGENT_URL', value: 'http://localhost:9100' },
    { key: 'GIT_COMMIT', value: gitCommit || '' },
    { key: 'APP_VERSION', value: buildId }
  ];

  if (envOverrides) {
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v != null) envVars.push({ key: k, value: String(v) });
    }
  }

  var yamlContent = buildYamlEnv(envVars);

  // Write YAML env file, then deploy using it
  var writeEnvStep = {
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
    entrypoint: 'bash',
    args: [
      '-c',
      'cat > /workspace/env.yaml << \'YAMLEOF\'\n' + yamlContent + '\nYAMLEOF'
    ]
  };

  var deployStep = {
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
    entrypoint: 'gcloud',
    args: [
      'run', 'deploy', serviceName,
      '--image', imageTag,
      '--region', region,
      '--platform', 'managed',
      '--allow-unauthenticated',
      '--port', '8080',
      '--memory', '512Mi',
      '--cpu', '1',
      '--max-instances', '10',
      '--min-instances', '0',
      '--timeout', '300',
      '--env-vars-file', '/workspace/env.yaml'
    ]
  };

  var urlStep = {
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
    entrypoint: 'bash',
    args: [
      '-c',
      'gcloud run services describe ' + serviceName + ' --region=' + region + ' --format="value(status.url)" > /workspace/url.txt'
    ]
  };

  const buildBody = {
    steps: [writeEnvStep, deployStep, urlStep],
    images: [imageTag],
    timeout: '900s',
    options: {
      logging: 'CLOUD_LOGGING_ONLY',
      machineType: 'E2_HIGHCPU_8'
    }
  };

  const result = await gcpRequestWithBody(
    'POST',
    'https://cloudbuild.googleapis.com/v1/projects/' + projectId + '/builds',
    token,
    buildBody
  );

  return { buildId: result.id || buildId, imageTag: imageTag };
}

/**
 * Poll Cloud Build status for a given build ID.
 */
async function getBuildStatus(projectId, buildId) {
  const token = await getClient();
  return gcpRequest(
    'GET',
    'https://cloudbuild.googleapis.com/v1/projects/' + projectId + '/builds/' + buildId,
    token
  );
}

/**
 * Get Cloud Run service details.
 */
async function getCloudRunService(projectId, region, serviceName) {
  const token = await getClient();
  return gcpRequest(
    'GET',
    'https://run.googleapis.com/v1/projects/' + projectId + '/locations/' + region + '/services/' + serviceName,
    token
  );
}

/**
 * Update a Cloud Run service (used for restart, suspend, activate).
 */
async function updateCloudRunService(projectId, region, serviceName, updateMask, patchBody) {
  const token = await getClient();
  return gcpRequestWithBody(
    'PATCH',
    'https://run.googleapis.com/v1/projects/' + projectId + '/locations/' + region + '/services/' + serviceName + '?updateMask=' + encodeURIComponent(updateMask),
    token,
    patchBody
  );
}

/**
 * Fetch Cloud Run service URL for a deployed service.
 */
async function getServiceUrl(projectId, region, serviceName) {
  try {
    const svc = await getCloudRunService(projectId, region, serviceName);
    return svc.status && svc.status.url ? svc.status.url : '';
  } catch (e) {
    return '';
  }
}

/**
 * List all revisions for a Cloud Run service, newest first.
 */
async function listRevisions(projectId, region, serviceName) {
  const token = await getClient();
  return gcpRequest(
    'GET',
    'https://run.googleapis.com/v1/projects/' + projectId + '/locations/' + region + '/revisions?labelSelector=serving.knative.dev/service=' + serviceName,
    token
  );
}

/**
 * Get the latest ready revision name from a Cloud Run service description.
 * Returns the revision name string, or empty string if not found.
 */
async function getLatestReadyRevision(projectId, region, serviceName) {
  try {
    const svc = await getCloudRunService(projectId, region, serviceName);
    return svc.status && svc.status.latestReadyRevisionName ? svc.status.latestReadyRevisionName : '';
  } catch (e) {
    return '';
  }
}

/**
 * Switch traffic percentage to a specific Cloud Run revision.
 * Typically used for rollback — send 100% traffic to an old revision.
 */
async function switchTraffic(projectId, region, serviceName, revisionName, percent) {
  const token = await getClient();
  const pct = percent == null ? 100 : percent;
  const patchBody = {
    spec: {
      traffic: [
        { revisionName: revisionName, percent: pct }
      ]
    }
  };
  return gcpRequestWithBody(
    'PATCH',
    'https://run.googleapis.com/v1/projects/' + projectId + '/locations/' + region + '/services/' + serviceName + '?updateMask=spec.traffic',
    token,
    patchBody
  );
}

/**
 * Set/remove environment variables on a deployed Cloud Run service.
 * Reads current service spec, merges env vars, patches.
 * Pass null as value to remove an env var.
 */
async function updateServiceEnv(projectId, region, serviceName, envMap) {
  const token = await getClient();

  // Read current env vars
  var currentEnv = [];
  try {
    const svc = await getCloudRunService(projectId, region, serviceName);
    if (svc && svc.spec && svc.spec.template && svc.spec.template.spec
        && svc.spec.template.spec.containers && svc.spec.template.spec.containers.length > 0
        && svc.spec.template.spec.containers[0].env) {
      currentEnv = svc.spec.template.spec.containers[0].env;
    }
  } catch (e) {
    // Service not found — can't update
    throw new Error('Cannot read current service env: ' + e.message);
  }

  // Build set of keys to remove
  var removeKeys = {};
  var setKeys = {};
  for (var key in envMap) {
    if (envMap.hasOwnProperty(key)) {
      if (envMap[key] === null) {
        removeKeys[key] = true;
      } else {
        setKeys[key] = String(envMap[key]);
      }
    }
  }

  // Merge: keep existing vars not being removed or overridden
  var merged = [];
  for (var i = 0; i < currentEnv.length; i++) {
    var name = currentEnv[i].name;
    if (removeKeys[name]) continue;     // remove requested
    if (setKeys[name] !== undefined) continue; // will be replaced
    merged.push(currentEnv[i]);
  }

  // Add new/updated vars
  for (var key in setKeys) {
    if (setKeys.hasOwnProperty(key)) {
      merged.push({ name: key, value: setKeys[key] });
    }
  }

  const patchBody = {
    spec: {
      template: {
        spec: {
          containers: [{ env: merged }]
        }
      }
    }
  };

  return gcpRequestWithBody(
    'PATCH',
    'https://run.googleapis.com/v1/projects/' + projectId + '/locations/' + region + '/services/' + serviceName + '?updateMask=spec.template.spec.containers.0.env',
    token,
    patchBody
  );
}

module.exports = {
  triggerDeployBuild,
  getBuildStatus,
  getCloudRunService,
  updateCloudRunService,
  getServiceUrl,
  listRevisions,
  getLatestReadyRevision,
  switchTraffic,
  updateServiceEnv
};
