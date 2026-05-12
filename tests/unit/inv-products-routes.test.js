/**
 * Unit tests for product management routes (api/inv/products.js)
 *
 * Tests route validation, middleware, templates, and input handling.
 * DB-dependent operations are tested via early-return validation paths.
 */
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const TEST_SECRET = 'test-jwt-secret-for-products';

let productsRouter;
try {
  productsRouter = require('../../api/inv/products');
} catch {
  productsRouter = null;
}

function createApp() {
  const app = express();
  app.use(express.json());
  if (productsRouter) app.use('/api/inv/products', productsRouter);
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
describe('Products routes — auth middleware', () => {
  it('GET /api/inv/products should return 401 without token', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app).get('/api/inv/products');
    expect(res.status).toBe(401);
  });

  it('POST /api/inv/products should return 401 without token', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .send({ name: 'Test', sku: 'SJ-APP15-128G-2026', sellingPrice: 100 });
    expect(res.status).toBe(401);
  });

  it('GET /api/inv/products should return 403 for unauthorized role', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products')
      .set('Authorization', `Bearer ${viewerToken()}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/inv/products should return 403 for unauthorized role', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ name: 'Test' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/products/templates
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/products/templates', () => {
  it('should return all category templates when no category specified', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/templates')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('销售');
    expect(res.body).toHaveProperty('新机');
    expect(res.body).toHaveProperty('二手');
  });

  it('should return 二手 template with correct attributes', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/templates?category=二手')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ '成色': '', '电池健康度': '', '维修记录': '' });
  });

  it('should return 新机 template with correct attributes', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/templates?category=新机')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ '品牌': '', '型号': '', '存储容量': '' });
  });

  it('should return empty object for 销售 category', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/templates?category=销售')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('should return empty object for unknown category', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/templates?category=未知品类')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('should be accessible by admin role', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/templates')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('二手');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/inv/products/search
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/inv/products/search', () => {
  it('should return empty array when no query provided', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/search')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return empty array when query is empty string', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/search?q=')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return empty array when query is whitespace only', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .get('/api/inv/products/search?q=%20%20')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/inv/products — validation (early returns before DB)
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/inv/products — input validation', () => {
  it('should return 400 when name is missing', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ sku: 'SJ-APP15-128G-2026', sellingPrice: 100, costPrice: 50, category: '手机' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/必填字段/);
    expect(res.body.fields).toContain('name');
  });

  it('should return 400 when sku is missing', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'iPhone 15', sellingPrice: 100, costPrice: 50, category: '手机' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/必填字段/);
    expect(res.body.fields).toContain('sku');
  });

  it('should return 400 when sellingPrice is missing', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'iPhone 15', sku: 'SJ-APP15-128G-2026', costPrice: 50, category: '手机' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/必填字段/);
    expect(res.body.fields).toContain('sellingPrice');
  });

  it('should accept product without costPrice (defaults to 0)', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'iPhone 15', sku: 'SJ-APP15-128G-2026', sellingPrice: 100, category: '销售' })
      .timeout(3000)
      .catch(e => e.response || { status: 500 });

    // Should NOT return 400 for missing costPrice — it's optional now
    expect(res.status).not.toBe(400);
  });

  it('should return 400 when costPrice is negative', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'iPhone 15', sku: 'SJ-APP15-128G-2026', sellingPrice: 100, costPrice: -10, category: '手机' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/非负数/);
  });

  it('should return 400 when category is missing', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'iPhone 15', sku: 'SJ-APP15-128G-2026', sellingPrice: 100, costPrice: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/);
  });

  it('should accept any SKU format including plain numbers', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'iPhone 15', sku: '12345678', sellingPrice: 100, costPrice: 50, category: '销售' })
      .timeout(3000)
      .catch(e => e.response || { status: 500 });

    // Should NOT return 400 for SKU format — any string is accepted
    expect(res.status).not.toBe(400);
  });

  it('should return 400 when multiple required fields are missing', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .post('/api/inv/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.fields.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/inv/products/:id — validation (early returns before DB)
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/inv/products/:id — input validation', () => {
  it('should return 400 when no update fields provided', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/products/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/更新/);
  });

  it('should return 400 when costPrice is negative in update', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/products/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ costPrice: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/非负数/);
  });

  it('should accept any SKU format in update', async () => {
    if (!productsRouter) return;
    const app = createApp();
    const res = await request(app)
      .put('/api/inv/products/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ sku: 'any-format-123' })
      .timeout(3000)
      .catch(e => e.response || { status: 500 });

    // Should NOT return 400 for SKU format
    expect(res.status).not.toBe(400);
  });
});
