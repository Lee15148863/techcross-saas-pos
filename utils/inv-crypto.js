/**
 * inv-crypto.js — Shared AES-256 encryption & SMTP transporter
 *
 * Consolidates encryptData (8 copies) and createTransporter (3 copies)
 * that were duplicated across api/ and services/ files.
 */

const crypto = require('crypto');
const nodemailer = require('nodemailer');

/**
 * AES-256-CBC encrypt data using INV_AUDIT_KEY.
 *
 * @param {*} data - Data to encrypt (JSON.stringify'd before encrypting)
 * @param {boolean} [throwOnMissingKey=true] - If false, returns JSON string when key is absent
 * @returns {string} iv:encrypted hex string, or JSON string if key absent + throwOnMissingKey=false
 */
function encryptData(data, throwOnMissingKey = true) {
  const key = process.env.INV_AUDIT_KEY;
  if (!key) {
    if (throwOnMissingKey) throw new Error('INV_AUDIT_KEY not configured');
    return JSON.stringify(data);
  }
  const derivedKey = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Create an SMTP transporter from environment variables.
 */
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: (parseInt(process.env.SMTP_PORT) || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

module.exports = { encryptData, createTransporter };
