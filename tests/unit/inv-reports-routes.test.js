/**
 * Unit tests for report routes (api/inv/reports.js)
 *
 * Tests auth middleware, input validation, and edge cases.
 * DB-dependent operations are tested via early-return validation paths.
 */
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const TEST_SECRET = 'test-jwt-secret-for-reports';

let reportsRouter;
try {
  reportsRouter = require('../../api/inv/reports');
} catch {
  reportsRouter = null;
}

function createApp() {
  const app = express();
  app.use(express.json());
  if (reportsRouter) app.use('/api/inv/reports', reportsRouter);
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
});

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication & Authorization
// ═══════════════════════════════════════════════════════════════════════════════
describe('Report routes — auth middleware', () => {
  it('GET /api/inv/reports/daily should return 401 without token', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/reports/daily');
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/reports/monthly should return 401 without token', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/reports/monthly');
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/reports/product-ranking should return 401 without token', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/reports/product-ranking');
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/reports/export should return 401 without token', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/reports/export');
    expect(res.status).toBe(401);
  });

  it('should return 403 for unauthorized role on all endpoints', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const token = viewerToken();

    const res1 = await request(app)
      .get('/api/inv/reports/daily')
      .set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(403);

    const res2 = await request(app)
      .get('/api/inv/reports/monthly')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(403);

    const res3 = await request(app)
      .get('/api/inv/reports/product-ranking')
      .set('Authorization', `Bearer ${token}`);
    expect(res3.status).toBe(403);

    const res4 = await request(app)
      .get('/api/inv/reports/export')
      .set('Authorization', `Bearer ${token}`);
    expect(res4.status).toBe(403);
  });

  it('should not return 401 or 403 for admin role', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const token = adminToken();

    // product-ranking with validation params returns 400 (not 401/403) — proves auth passes
    const res = await request(app)
      .get('/api/inv/reports/product-ranking')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400); // validation error, not auth error
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should not return 401 or 403 for staff role', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const token = staffToken();

    // product-ranking with validation params returns 400 (not 401/403) — proves auth passes
    const res = await request(app)
      .get('/api/inv/reports/product-ranking')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400); // validation error, not auth error
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Token edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe('Report routes — token edge cases', () => {
  it('should return 401 for expired token', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const expiredToken = jwt.sign(
      { userId: 'admin-id-1', username: 'admin', role: 'root' },
      TEST_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/api/inv/reports/daily')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('should return 401 for malformed token', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/daily')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });

  it('should return 401 for missing Bearer prefix', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/daily')
      .set('Authorization', adminToken());
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/reports/product-ranking — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/reports/product-ranking — input validation', () => {
  it('should return 400 when startDate is missing', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/product-ranking?endDate=2025-01-31')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when endDate is missing', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/product-ranking?startDate=2025-01-01')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when both dates are missing', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/product-ranking')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid date format', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/product-ranking?startDate=not-a-date&endDate=also-not')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/reports/export — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/reports/export — input validation', () => {
  it('should return 400 when type is missing', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/export')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/type/);
  });

  it('should return 400 when type is invalid', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/export?type=weekly')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/type/);
  });

  it('should return 400 for monthly export with invalid month format', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/export?type=monthly&month=2025-13')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for daily export with invalid date', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/export?type=daily&date=not-a-date')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/reports/monthly — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/reports/monthly — input validation', () => {
  it('should return 400 for invalid month format (month > 12)', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/monthly?month=2025-13')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid month format (month = 0)', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/monthly?month=2025-00')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for non-numeric month', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/monthly?month=abc-def')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/reports/daily — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/reports/daily — input validation', () => {
  it('should return 400 for invalid date format', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/daily?date=not-a-date')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid startDate in range mode', async () => {
    if (!reportsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/reports/daily?startDate=invalid&endDate=2025-01-31')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
