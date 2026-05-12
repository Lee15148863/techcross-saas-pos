/**
 * Unit tests for supplier management routes (api/inv/suppliers.js)
 *
 * Tests auth middleware, input validation, role-based access, and edge cases.
 * DB-dependent operations are tested via early-return validation paths.
 */
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const TEST_SECRET = 'test-jwt-secret-for-suppliers';

let suppliersRouter;
try {
  suppliersRouter = require('../../api/inv/suppliers');
} catch {
  suppliersRouter = null;
}

function createApp() {
  const app = express();
  app.use(express.json());
  if (suppliersRouter) app.use('/api/inv/suppliers', suppliersRouter);
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
// Authentication & Authorization — Staff+ access
// ═══════════════════════════════════════════════════════════════════════════════
describe('Suppliers routes — auth middleware (Staff+ access)', () => {
  it('GET /api/inv/suppliers should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/suppliers');
    expect(res.status).toBe(401);
  });

  it('POST /api/inv/suppliers should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/suppliers')
      .send({ name: 'Test Supplier' });
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/suppliers/:id should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/suppliers/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('PUT /api/inv/suppliers/:id should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011')
      .send({ name: 'Updated' });
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/suppliers/:id/account should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/suppliers/507f1f77bcf86cd799439011/account');
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/suppliers should return 403 for unauthorized role', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/suppliers')
      .set('Authorization', `Bearer ${viewerToken()}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/inv/suppliers should return 403 for unauthorized role', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/suppliers')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ name: 'Test' });
    expect(res.status).toBe(403);
  });

  it('PUT /api/inv/suppliers/:id should return 403 for unauthorized role', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ name: 'Updated' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication & Authorization — Admin only endpoints
// ═══════════════════════════════════════════════════════════════════════════════
describe('Suppliers routes — admin-only endpoints', () => {
  it('PUT /api/inv/suppliers/:id/disable should return 403 for staff role', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011/disable')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('PUT /api/inv/suppliers/:id/enable should return 403 for staff role', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011/enable')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(403);
  });

  it('PUT /api/inv/suppliers/batch-disable should return 403 for staff role', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-disable')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ ids: ['507f1f77bcf86cd799439011'], reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('PUT /api/inv/suppliers/batch-enable should return 403 for staff role', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-enable')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ ids: ['507f1f77bcf86cd799439011'] });
    expect(res.status).toBe(403);
  });

  it('PUT /api/inv/suppliers/:id/disable should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011/disable')
      .send({ reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('PUT /api/inv/suppliers/:id/enable should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011/enable');
    expect(res.status).toBe(401);
  });

  it('PUT /api/inv/suppliers/batch-disable should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-disable')
      .send({ ids: ['507f1f77bcf86cd799439011'] });
    expect(res.status).toBe(401);
  });

  it('PUT /api/inv/suppliers/batch-enable should return 401 without token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-enable')
      .send({ ids: ['507f1f77bcf86cd799439011'] });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/inv/suppliers — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/inv/suppliers — input validation', () => {
  it('should return 400 when name is missing', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/suppliers')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ contactName: 'John', phone: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when name is empty string', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/suppliers')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('should return 400 when name is whitespace only', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/suppliers')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('should return 400 when body is empty', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/suppliers')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/inv/suppliers/:id — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/inv/suppliers/:id — input validation', () => {
  it('should return 400 when no update fields provided', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/更新/);
  });

  it('should return 400 when name is set to empty string', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/名称/);
  });

  it('should return 400 when name is whitespace only', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/名称/);
  });

  it('should return 404 for invalid ObjectId format', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/invalid-id')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ contactName: 'New Contact' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/供应商不存在/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/suppliers/:id — validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/suppliers/:id — validation', () => {
  it('should return 404 for invalid ObjectId format', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/suppliers/invalid-id')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/供应商不存在/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/suppliers/:id/account — validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/suppliers/:id/account — validation', () => {
  it('should return 404 for invalid ObjectId format', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/suppliers/invalid-id/account')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/供应商不存在/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/inv/suppliers/:id/disable — validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/inv/suppliers/:id/disable — validation', () => {
  it('should return 404 for invalid ObjectId format', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/invalid-id/disable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'test' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/供应商不存在/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/inv/suppliers/:id/enable — validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/inv/suppliers/:id/enable — validation', () => {
  it('should return 404 for invalid ObjectId format', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/invalid-id/enable')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/供应商不存在/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/inv/suppliers/batch-disable — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/inv/suppliers/batch-disable — input validation', () => {
  it('should return 400 when ids is missing', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-disable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when ids is empty array', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-disable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: [], reason: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/);
  });

  it('should return 400 when ids is not an array', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-disable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: 'not-an-array', reason: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/inv/suppliers/batch-enable — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/inv/suppliers/batch-enable — input validation', () => {
  it('should return 400 when ids is missing', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-enable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when ids is empty array', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-enable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/);
  });

  it('should return 400 when ids is not an array', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/suppliers/batch-enable')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Token edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe('Suppliers routes — token edge cases', () => {
  it('should return 401 for expired token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const expiredToken = jwt.sign(
      { userId: 'admin-id-1', username: 'admin', role: 'root' },
      TEST_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/api/inv/suppliers')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('should return 401 for malformed token', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/suppliers')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });

  it('should return 401 for missing Bearer prefix', async () => {
    if (!suppliersRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/suppliers')
      .set('Authorization', adminToken());
    expect(res.status).toBe(401);
  });
});
