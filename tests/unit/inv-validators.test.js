const {
  validateSku,
  validatePassword,
  validateRequiredFields,
} = require('../../utils/inv-validators');

// ─── validateSku ─────────────────────────────────────────────────────

describe('validateSku', () => {
  it('should accept a valid SKU like SJ-APP15-128G-2026', () => {
    expect(validateSku('SJ-APP15-128G-2026')).toEqual({ valid: true });
  });

  it('should accept a 3-letter category prefix', () => {
    expect(validateSku('PJN-X1-8G-2025')).toEqual({ valid: true });
  });

  it('should accept alphanumeric model and spec segments', () => {
    expect(validateSku('AB-Model1-Spec2-1999')).toEqual({ valid: true });
  });

  it('should reject SKU with 1-letter category (too short)', () => {
    const result = validateSku('S-APP15-128G-2026');
    expect(result.valid).toBe(false);
  });

  it('should reject SKU with 4-letter category (too long)', () => {
    const result = validateSku('ABCD-APP15-128G-2026');
    expect(result.valid).toBe(false);
  });

  it('should reject SKU with lowercase category', () => {
    const result = validateSku('sj-APP15-128G-2026');
    expect(result.valid).toBe(false);
  });

  it('should reject SKU with non-4-digit year', () => {
    const result = validateSku('SJ-APP15-128G-26');
    expect(result.valid).toBe(false);
  });

  it('should reject SKU with missing segments', () => {
    expect(validateSku('SJ-APP15-2026').valid).toBe(false);
    expect(validateSku('SJ-APP15').valid).toBe(false);
    expect(validateSku('SJ').valid).toBe(false);
  });

  it('should reject empty string', () => {
    const result = validateSku('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('SKU 不能为空');
  });

  it('should reject non-string input', () => {
    expect(validateSku(null).valid).toBe(false);
    expect(validateSku(undefined).valid).toBe(false);
    expect(validateSku(123).valid).toBe(false);
  });

  it('should reject SKU with spaces', () => {
    expect(validateSku('SJ -APP15-128G-2026').valid).toBe(false);
  });

  it('should reject SKU with special characters in model', () => {
    expect(validateSku('SJ-APP@15-128G-2026').valid).toBe(false);
  });
});

// ─── validatePassword ────────────────────────────────────────────────

describe('validatePassword', () => {
  it('should accept a valid password with letters and digits (8+ chars)', () => {
    expect(validatePassword('abcdef12')).toEqual({ valid: true });
  });

  it('should accept a longer password', () => {
    expect(validatePassword('MySecurePass123')).toEqual({ valid: true });
  });

  it('should reject password shorter than 8 characters', () => {
    const result = validatePassword('abc1234');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('8');
  });

  it('should reject password with only letters (no digits)', () => {
    const result = validatePassword('abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数字');
  });

  it('should reject password with only digits (no letters)', () => {
    const result = validatePassword('12345678');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('字母');
  });

  it('should reject empty string', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
  });

  it('should reject non-string input', () => {
    expect(validatePassword(null).valid).toBe(false);
    expect(validatePassword(undefined).valid).toBe(false);
    expect(validatePassword(12345678).valid).toBe(false);
  });

  it('should accept password with special characters as long as it has letters and digits', () => {
    expect(validatePassword('P@ss1234!')).toEqual({ valid: true });
  });

  it('should accept exactly 8 characters with letters and digits', () => {
    expect(validatePassword('abcd1234')).toEqual({ valid: true });
  });
});

// ─── validateRequiredFields ──────────────────────────────────────────

describe('validateRequiredFields', () => {
  it('should return empty array when all required fields are present', () => {
    const obj = { name: 'iPhone', sku: 'SJ-APP15-128G-2026', sellingPrice: 999 };
    const result = validateRequiredFields(obj, ['name', 'sku', 'sellingPrice']);
    expect(result).toEqual([]);
  });

  it('should return missing field names for undefined values', () => {
    const obj = { name: 'iPhone' };
    const result = validateRequiredFields(obj, ['name', 'sku', 'sellingPrice']);
    expect(result).toEqual(['sku', 'sellingPrice']);
  });

  it('should treat null values as missing', () => {
    const obj = { name: null, sku: 'SJ-APP15-128G-2026' };
    const result = validateRequiredFields(obj, ['name', 'sku']);
    expect(result).toEqual(['name']);
  });

  it('should treat empty strings (after trim) as missing', () => {
    const obj = { name: '  ', sku: 'SJ-APP15-128G-2026' };
    const result = validateRequiredFields(obj, ['name', 'sku']);
    expect(result).toEqual(['name']);
  });

  it('should accept zero as a valid value', () => {
    const obj = { name: 'Test', stock: 0 };
    const result = validateRequiredFields(obj, ['name', 'stock']);
    expect(result).toEqual([]);
  });

  it('should accept false as a valid value', () => {
    const obj = { name: 'Test', isSecondHand: false };
    const result = validateRequiredFields(obj, ['name', 'isSecondHand']);
    expect(result).toEqual([]);
  });

  it('should return all fields when object is null', () => {
    const result = validateRequiredFields(null, ['name', 'sku']);
    expect(result).toEqual(['name', 'sku']);
  });

  it('should return all fields when object is undefined', () => {
    const result = validateRequiredFields(undefined, ['name', 'sku']);
    expect(result).toEqual(['name', 'sku']);
  });

  it('should return empty array when no required fields specified', () => {
    const result = validateRequiredFields({ name: 'Test' }, []);
    expect(result).toEqual([]);
  });
});
