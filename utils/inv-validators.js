/**
 * 请求校验工具函数
 * 提供 SKU 格式校验、密码复杂度校验和通用必填字段校验
 */

/**
 * SKU 格式正则：品类缩写-型号-规格-年份
 * - 品类缩写：2-3 个大写字母
 * - 型号：1+ 个字母或数字
 * - 规格：1+ 个字母或数字
 * - 年份：4 位数字
 * 示例：SJ-APP15-128G-2026
 */
const SKU_PATTERN = /^[A-Z]{2,3}-[A-Za-z0-9]+-[A-Za-z0-9]+-\d{4}$/;

/**
 * 校验 SKU 格式是否符合"品类缩写-型号-规格-年份"规则
 * @param {string} sku - 待校验的 SKU 字符串
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSku(sku) {
  if (typeof sku !== 'string' || sku.trim() === '') {
    return { valid: false, error: 'SKU 不能为空' };
  }
  if (!SKU_PATTERN.test(sku)) {
    return {
      valid: false,
      error: 'SKU 格式无效，应为"品类缩写-型号-规格-年份"（如 SJ-APP15-128G-2026）',
    };
  }
  return { valid: true };
}

/**
 * 校验密码复杂度：至少 8 位，且同时包含字母和数字
 * @param {string} password - 待校验的密码
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePassword(password) {
  if (typeof password !== 'string') {
    return { valid: false, error: '密码不能为空' };
  }
  if (password.length < 8) {
    return { valid: false, error: '密码长度不能少于 8 位' };
  }
  if (!/[A-Za-z]/.test(password)) {
    return { valid: false, error: '密码必须包含至少一个字母' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: '密码必须包含至少一个数字' };
  }
  return { valid: true };
}

/**
 * 通用必填字段校验：检查对象中是否缺少指定的必填字段
 * 字段值为 undefined、null 或空字符串（trim 后）视为缺失
 * @param {Object} obj - 待校验的对象
 * @param {string[]} requiredFields - 必填字段名数组
 * @returns {string[]} 缺失的字段名数组（空数组表示全部通过）
 */
function validateRequiredFields(obj, requiredFields) {
  if (!obj || typeof obj !== 'object') {
    return [...requiredFields];
  }
  const missing = [];
  for (const field of requiredFields) {
    const value = obj[field];
    if (value === undefined || value === null) {
      missing.push(field);
    } else if (typeof value === 'string' && value.trim() === '') {
      missing.push(field);
    }
  }
  return missing;
}

module.exports = { validateSku, validatePassword, validateRequiredFields, SKU_PATTERN };
