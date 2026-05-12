/**
 * ShareToken Model — Secure temporary sharing tokens
 *
 * Used for both receipt and invoice sharing via WhatsApp/email.
 * Tokens are 64-char crypto random hex strings.
 * Expire automatically after 14 days.
 * AccessCount tracks how many times the link was opened.
 *
 * No raw database IDs are exposed in shared URLs.
 */

const mongoose = require('mongoose');

const ShareTokenSchema = new mongoose.Schema({
  token:         { type: String, required: true, unique: true },
  // 64-char crypto random hex — used in shared URL instead of DB ID

  type:          { type: String, enum: ['receipt', 'invoice'], required: true },
  // 'receipt' → share a Transaction receipt
  // 'invoice' → share an Invoice

  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  // Populated for type='receipt'

  invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  // Populated for type='invoice'

  expiresAt:     { type: Date, required: true },
  // Set to 14 days from creation

  accessCount:   { type: Number, default: 0 },
  // Incremented on each successful access

  createdAt:     { type: Date, default: Date.now },

  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
});

ShareTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// TTL index — MongoDB auto-deletes expired documents

ShareTokenSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('ShareToken', ShareTokenSchema);
