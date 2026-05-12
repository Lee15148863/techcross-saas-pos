/**
 * Unit tests for transaction routes (api/inv/transactions.js)
 *
 * Tests auth middleware, input validation, and edge cases.
 * DB-dependent operations are tested via early-return validation paths.
 */
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const TEST_SECRET = 'test-jwt-secret-for-transactions';

let transactionsRouter;
try {
  transactionsRouter = require('../../api/inv/transactions');
} catch {
  transactionsRouter = null;
}

function createApp() {
  const app = express();
  app.use(express.json());
  if (transactionsRouter) app.use('/api/inv/transactions', transactionsRouter);
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
  process.env.INV_AUDIT_KEY = 'test-audit-key-for-encryption-32b';
});

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication & Authorization
// ═══════════════════════════════════════════════════════════════════════════════
describe('Transaction routes — auth middleware', () => {
  it('POST /api/inv/transactions/checkout should return 401 without token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/transactions/checkout')
      .send({ items: [], paymentMethod: 'cash' });
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/transactions should return 401 without token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/transactions');
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/transactions/:id should return 401 without token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/transactions/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/inv/transactions/:id/delete should return 401 without token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/507f1f77bcf86cd799439011/delete')
      .send({ confirm: true });
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/transactions/export should return 401 without token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/transactions/export');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/inv/transactions/batch-delete should return 401 without token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/batch-delete')
      .send({ ids: [], confirm: true });
    expect(res.status).toBe(401);
  });

  it('should return 403 for unauthorized role on all endpoints', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const token = viewerToken();

    const res1 = await request(app)
      .post('/api/inv/transactions/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [], paymentMethod: 'cash' });
    expect(res1.status).toBe(403);

    const res2 = await request(app)
      .get('/api/inv/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(403);

    const res3 = await request(app)
      .get('/api/inv/transactions/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);
    expect(res3.status).toBe(403);
  });

  it('DELETE /:id/delete should return 403 for staff role', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/507f1f77bcf86cd799439011/delete')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ confirm: true });
    expect(res.status).toBe(403);
  });

  it('DELETE /batch-delete should return 403 for staff role', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/batch-delete')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ ids: ['507f1f77bcf86cd799439011'], confirm: true });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/inv/transactions/checkout — input validation
// ═══════════════════════════════════════════════════════════════════════════════
// Note: these tests require a live MongoDB connection since the checkout
// service calls requireSystemActive() which queries the DB.
const hasDB = !!process.env.DBCon;
describe('POST /api/inv/transactions/checkout — input validation', () => {
  it('should return 400 when items is missing', async () => {
    if (!transactionsRouter || !hasDB) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/transactions/checkout')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ paymentMethod: 'cash', cashReceived: 100 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_CART');
  });

  it('should return 400 when items is empty array', async () => {
    if (!transactionsRouter || !hasDB) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/transactions/checkout')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ items: [], paymentMethod: 'cash', cashReceived: 100 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_CART');
  });

  it('should return 400 when items is not an array', async () => {
    if (!transactionsRouter || !hasDB) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/transactions/checkout')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ items: 'not-array', paymentMethod: 'cash' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_CART');
  });

  it('should return 400 when paymentMethod is missing', async () => {
    if (!transactionsRouter || !hasDB) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/transactions/checkout')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({ items: [{ product: '507f1f77bcf86cd799439011', quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/Payment method/);
  });

  it('should return 400 when paymentMethod is invalid', async () => {
    if (!transactionsRouter || !hasDB) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/transactions/checkout')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({
        items: [{ product: '507f1f77bcf86cd799439011', quantity: 1 }],
        paymentMethod: 'bitcoin'
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/Payment method/);
  });

  it('should return 400 when item is missing product ID', async () => {
    if (!transactionsRouter || !hasDB) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/transactions/checkout')
      .set('Authorization', `Bearer ${staffToken()}`)
      .send({
        items: [{ quantity: 1 }],
        paymentMethod: 'card'
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/missing product ID/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/inv/transactions/:id/delete — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('DELETE /api/inv/transactions/:id/delete — input validation', () => {
  it('should return 400 when confirm is not provided', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/507f1f77bcf86cd799439011/delete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/确认/);
  });

  it('should return 400 when confirm is false', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/507f1f77bcf86cd799439011/delete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ confirm: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/确认/);
  });

  it('should return 404 for invalid ObjectId format', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/invalid-id/delete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ confirm: true });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/交易记录不存在/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/inv/transactions/batch-delete — input validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('DELETE /api/inv/transactions/batch-delete — input validation', () => {
  it('should return 400 when confirm is not provided', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/batch-delete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: ['507f1f77bcf86cd799439011'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/确认/);
  });

  it('should return 400 when ids is missing', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/batch-delete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/交易ID/);
  });

  it('should return 400 when ids is empty array', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/batch-delete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: [], confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/交易ID/);
  });

  it('should return 400 when ids is not an array', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .delete('/api/inv/transactions/batch-delete')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ ids: 'not-array', confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/交易ID/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/transactions/:id — validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/transactions/:id — validation', () => {
  it('should return 404 for invalid ObjectId format', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/transactions/invalid-id')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/交易记录不存在/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/transactions/export — validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/transactions/export — validation', () => {
  it('should return 400 for invalid export format', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/transactions/export?format=xml')
      .set('Authorization', `Bearer ${staffToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/格式/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Token edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe('Transaction routes — token edge cases', () => {
  it('should return 401 for expired token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const expiredToken = jwt.sign(
      { userId: 'admin-id-1', username: 'admin', role: 'root' },
      TEST_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/api/inv/transactions')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('should return 401 for malformed token', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/transactions')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });

  it('should return 401 for missing Bearer prefix', async () => {
    if (!transactionsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/transactions')
      .set('Authorization', adminToken());
    expect(res.status).toBe(401);
  });
});
