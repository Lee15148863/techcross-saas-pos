const jwt = require('jsonwebtoken');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

// Set the env var before tests run
beforeAll(() => {
  process.env.INV_JWT_SECRET = TEST_SECRET;
});

/**
 * Helper: create a mock request with optional Authorization header
 */
function mockReq(authHeader) {
  return { headers: authHeader != null ? { authorization: authHeader } : {} };
}

/**
 * Helper: create a mock response that captures status and json body
 */
function mockRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

// ─── jwtAuth middleware ──────────────────────────────────────────────

describe('jwtAuth middleware', () => {
  it('should return 401 when no Authorization header is present', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    jwtAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('未提供认证令牌');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when Authorization header does not start with Bearer', () => {
    const req = mockReq('Basic abc123');
    const res = mockRes();
    const next = vi.fn();

    jwtAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when token is empty after Bearer prefix', () => {
    const req = mockReq('Bearer ');
    const res = mockRes();
    const next = vi.fn();

    jwtAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when token is invalid', () => {
    const req = mockReq('Bearer invalid.token.here');
    const res = mockRes();
    const next = vi.fn();

    jwtAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('无效的认证令牌');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 with expiry message when token is expired', () => {
    const token = jwt.sign(
      { userId: '123', username: 'admin', role: 'root' },
      TEST_SECRET,
      { expiresIn: -1 } // already expired
    );
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    jwtAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('令牌已过期');
    expect(next).not.toHaveBeenCalled();
  });

  it('should mount decoded payload to req.user and call next for valid token', () => {
    const payload = { userId: 'abc123', username: 'testuser', role: 'staff' };
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    jwtAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe('abc123');
    expect(req.user.username).toBe('testuser');
    expect(req.user.role).toBe('staff');
  });

  it('should include iat and exp in req.user', () => {
    const payload = { userId: '1', username: 'u', role: 'root' };
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '2h' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    jwtAuth(req, res, next);

    expect(req.user.iat).toBeDefined();
    expect(req.user.exp).toBeDefined();
  });
});

// ─── requireRole middleware ──────────────────────────────────────────

describe('requireRole middleware', () => {
  it('should return 403 when req.user is not set', () => {
    const req = {};
    const res = mockRes();
    const next = vi.fn();

    requireRole('root')(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('权限不足');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when user role is not in allowed roles', () => {
    const req = { user: { role: 'staff' } };
    const res = mockRes();
    const next = vi.fn();

    requireRole('root')(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('权限不足');
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next when user role matches a single allowed role', () => {
    const req = { user: { role: 'root' } };
    const res = mockRes();
    const next = vi.fn();

    requireRole('root')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('should call next when user role matches one of multiple allowed roles', () => {
    const req = { user: { role: 'staff' } };
    const res = mockRes();
    const next = vi.fn();

    requireRole('root', 'staff')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should return 403 when user role does not match any of multiple allowed roles', () => {
    const req = { user: { role: 'guest' } };
    const res = mockRes();
    const next = vi.fn();

    requireRole('root', 'staff')(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
