const jwt = require('jsonwebtoken');
const InvUser = require('../models/inv/User');

/**
 * JWT 认证中间件
 * 从 Authorization: Bearer <token> 提取并验证 JWT，
 * 将 decoded payload 挂载到 req.user
 */
function jwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = authHeader.slice(7);
  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  try {
    const decoded = jwt.verify(token, process.env.INV_JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '令牌已过期' });
    }
    return res.status(401).json({ error: '无效的认证令牌' });
  }
}

/**
 * 角色权限中间件
 * 检查 req.user.role 是否在允许角色列表中，不在则返回 403
 * @param  {...string} roles - 允许的角色列表
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

/**
 * 细粒度权限中间件
 * 检查用户是否拥有指定模块的访问权限。
 * 从数据库加载用户以获取最新权限配置（而非仅依赖 JWT 中的角色）。
 * 适用于需要比角色更细粒度控制的场景。
 *
 * @param {string} permissionKey - 权限键名（如 'settings', 'users', 'website'）
 */
function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: '未认证' });
      }

      const user = await InvUser.findById(req.user.userId).select('role permissions');
      if (!user) {
        return res.status(401).json({ error: '用户不存在' });
      }

      const perms = user.getPermissions();
      if (!perms[permissionKey]) {
        return res.status(403).json({ error: '权限不足' });
      }

      // Attach resolved permissions for downstream use
      req.userPermissions = perms;
      next();
    } catch (err) {
      console.error('Permission check error:', err.message);
      res.status(500).json({ error: '服务器错误' });
    }
  };
}

module.exports = { jwtAuth, requireRole, requirePermission };
