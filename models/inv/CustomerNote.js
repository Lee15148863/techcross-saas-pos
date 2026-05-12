/**
 * CustomerNote.js — Internal Customer Notes Model
 *
 * Stores internal staff notes about customers.
 * NOTES ARE INTERNAL ONLY — never exposed to customers.
 * Communication layer only — NOT financial core.
 */
const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser' },
  createdByDisplay: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const customerNoteSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true, trim: true },
  name: { type: String, default: '', trim: true },
  notes: [noteSchema],
  lastContacted: { type: Date },
}, { timestamps: true });

customerNoteSchema.index({ name: 'text', phone: 'text' });

module.exports = mongoose.model('CustomerNote', customerNoteSchema);
