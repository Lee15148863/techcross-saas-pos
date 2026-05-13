const crypto = require('crypto');

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const SECRET = process.env.CAPTCHA_SECRET || (process.env.SAAS_JWT_SECRET + '_captcha');

function generate() {
  const a = Math.floor(Math.random() * 50) + 1;
  const b = Math.floor(Math.random() * 50) + 1;
  const ops = ['+', '-'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let answer;
  if (op === '+') answer = a + b;
  else answer = a - b;

  const question = a + ' ' + op + ' ' + b;
  const expiresAt = Date.now() + CAPTCHA_TTL_MS;
  const payload = answer + '|' + expiresAt;
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const token = Buffer.from(expiresAt + '|' + hmac).toString('base64url');

  return { question, token };
}

function verify(token, userAnswer) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('|');
    if (parts.length !== 2) return false;
    const expiresAt = parseInt(parts[0], 10);
    const hmac = parts[1];

    if (Date.now() > expiresAt) return false;

    const userNum = parseInt(userAnswer, 10);
    if (isNaN(userNum)) return false;

    const expectedPayload = userNum + '|' + expiresAt;
    const expectedHmac = crypto.createHmac('sha256', SECRET).update(expectedPayload).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(hmac));
  } catch {
    return false;
  }
}

module.exports = { generate, verify };
