const crypto = require('crypto');

/**
 * Receipt Number Generator
 *
 * Format: [TYPE]-YYYYMMDDHHmmss-RANDOM
 *
 *   TYPE      Transaction type
 *   Timestamp Second-precision timestamp (YYYYMMDDHHmmss)
 *   RANDOM    8-char hex from crypto.randomBytes(4)
 *
 * Uniqueness is guaranteed by the combination of:
 *   - TYPE prefix separates sequences
 *   - Second-precision timestamp provides ordering
 *   - cryptographically random 8-char hex suffix provides ~4B values per second per type
 *
 * No database counters are used — uniqueness is probabilistic via the random suffix.
 * The collision probability within the same type and second is 1 in 2^32 (~4 billion).
 */

const TYPE_PREFIX = {
  sale:       'S',
  refund:     'R',
  device_sale:'DS',
  device_buy: 'DB',
  quick_sale: 'Q',
};

const VALID_TYPES = Object.keys(TYPE_PREFIX);

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Generate a receipt number.
 *
 * @param {'sale'|'refund'|'device_sale'|'device_buy'|'quick_sale'} type - Transaction type
 * @param {Date|number} [date] - Optional Date object or timestamp. Defaults to now.
 * @returns {string} Receipt number in format TYPE-YYYYMMDDHHmmss-XXXXXXXX
 */
function generateReceiptNumber(type, date) {
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid receipt type "${type}". Valid types: ${VALID_TYPES.join(', ')}`);
  }

  const now = date instanceof Date ? date : (typeof date === 'number' ? new Date(date) : new Date());

  const ts = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('');

  const random = crypto.randomBytes(4).toString('hex').toUpperCase();

  return `${TYPE_PREFIX[type]}-${ts}-${random}`;
}

module.exports = {
  generateReceiptNumber,
  TYPE_PREFIX,
  VALID_TYPES,
};
