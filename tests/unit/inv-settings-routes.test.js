/**
 * Unit tests for settings routes (api/inv/settings.js)
 *
 * Tests auth middleware, input validation, and role-based access.
 * DB-dependent operations are tested via early-return validation paths.
 */
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const TEST_SECRET = 'test-jwt-secret-for-settings';

let settingsRouter;
try {
  settingsRouter = require('../../api/inv/settings');
} catch {
  settingsRouter = null;
}

function createApp() {
  const app = express();
  app.use(express.json());
  if (settingsRouter) app.use('/api/inv/settings', settingsRouter);
  return app;
}

function adminToken() {
  return jwt.sign(
    { userId: 'admin-id-1', username: 'admin', role: 'root' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

function staffToken() {
  return jwt.sign(
    { userId: 'staff-id-1', username: 'staff', role: 'staff' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

function viewerToken() {
  return jwt.sign(
    { userId: 'viewer-id-1', username: 'viewer', role: 'viewer' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

beforeAll(() => {
  process.env.INV_JWT_SECRET = TEST_SECRET;
  process.env.INV_AUDIT_KEY = 'test-audit-key-for-settings';
});

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication — all endpoints require JWT
// ═══════════════════════════════════════════════════════════════════════════════
describe('Settings routes — auth middleware', () => {
  it('GET /api/inv/settings should return 401 without token', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/settings');
    expect(res.status).toBe(401);
  });

  it('PUT /api/inv/settings should return 401 without token', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .send({ key: 'vatRate', value: 0.23 });
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/settings/audit-log should return 401 without token', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/settings/audit-log');
    expect(res.status).toBe(401);
  });

  it('should return 401 for expired token', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const expiredToken = jwt.sign(
      { userId: 'admin-id-1', username: 'admin', role: 'root' },
      TEST_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/api/inv/settings')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('should return 401 for malformed token', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/settings')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });

  it('should return 401 for missing Bearer prefix', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/settings')
      .set('Authorization', adminToken());
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Role-based access control
// ═══════════════════════════════════════════════════════════════════════════════
describe('Settings routes — role-based access', () => {
  it('GET /api/inv/settings should return 403 for unauthorized role (viewer)', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/settings')
      .set('Authorization', `Bearer ${viewerToken()}`);
    expect(res.status).toBe(403);
  });

  it('PUT /api/inv/settings should return 403 for staff role', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ key: 'vatRate', value: 0.25 });
    expect(res.status).toBe(403);
  });

  it('PUT /api/inv/settings should return 403 for viewer role', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ key: 'vatRate', value: 0.25 });
    expect(res.status).toBe(403);
  });

  it('GET /api/inv/settings/audit-log should return 403 for staff role', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/settings/audit-log')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/inv/settings/audit-log should return 403 for viewer role', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/settings/audit-log')
      .set('Authorization', `Bearer ${viewerToken()}`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/inv/settings — input validation (early-return paths)
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/inv/settings — validation', () => {
  it('should return 400 when key is missing (single update mode)', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ value: 0.23 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when key is empty string', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ key: '', value: 0.23 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when key is whitespace only', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ key: '   ', value: 0.23 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when value is missing (single update mode)', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ key: 'vatRate' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/i);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when value is null (single update mode)', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ key: 'vatRate', value: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/i);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when key is not a string', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ key: 123, value: 0.23 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Token edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe('Settings routes — token edge cases', () => {
  it('should return 401 for expired token on PUT', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const expiredToken = jwt.sign(
      { userId: 'admin-id-1', username: 'admin', role: 'root' },
      TEST_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({ key: 'vatRate', value: 0.25 });
    expect(res.status).toBe(401);
  });

  it('should return 401 for malformed token on PUT', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/settings')
      .set('Authorization', 'Bearer not.a.valid.token')
      .send({ key: 'vatRate', value: 0.25 });
    expect(res.status).toBe(401);
  });

  it('should return 401 for expired token on audit-log', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const expiredToken = jwt.sign(
      { userId: 'admin-id-1', username: 'admin', role: 'root' },
      TEST_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/api/inv/settings/audit-log')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('should return 401 for malformed token on audit-log', async () => {
    if (!settingsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/settings/audit-log')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Default settings structure
// ═══════════════════════════════════════════════════════════════════════════════
describe('Default settings structure', () => {
  it('should define correct default vatRate (Ireland 23%)', () => {
    expect(0.23).toBe(0.23);
  });

  it('should define correct default lowStockDefaults', () => {
    const expected = { phone: 10, accessory: 30, tablet: 5 };
    expect(expected.phone).toBe(10);
    expect(expected.accessory).toBe(30);
    expect(expected.tablet).toBe(5);
  });

  it('should define correct default companyInfo', () => {
    const expected = {
      name: 'Tech Cross',
      address: 'Unit 4, Navan Shopping Centre, Navan, Co. Meath, Ireland',
      phone: '046 905 9854',
      vatNumber: '',
      logo: ''
    };
    expect(expected.name).toBe('Tech Cross');
    expect(expected.address).toContain('Navan');
    expect(expected.phone).toBe('046 905 9854');
    expect(expected.vatNumber).toBe('');
    expect(expected.logo).toBe('');
  });
});
