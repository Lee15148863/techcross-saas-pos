/**
 * whatsapp.js — WhatsApp Center API
 *
 * Communication layer only — NOT financial core.
 * Provides customer search, notes, and template management.
 */
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { jwtAuth, requireRole } = require('../../middleware/inv-auth');
const CustomerNote = require('../../models/inv/CustomerNote');
const Invoice = require('../../models/inv/Invoice');

// All routes require Staff+
router.use(jwtAuth, requireRole('root', 'manager', 'staff'));

// ─── Customer Search ──────────────────────────────────────────────────────
// Searches across Invoice customerName/customerContact and CustomerNote records.
// Returns deduplicated list of known customers.
router.get('/customers', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const qEsc = q ? q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    const results = [];

    // Gather from Invoice records
    const invoiceMatch = {};
    if (q) {
      invoiceMatch.$or = [
        { customerName: { $regex: qEsc, $options: 'i' } },
        { customerContact: { $regex: qEsc, $options: 'i' } },
      ];
    }
    const invoices = await Invoice.find(invoiceMatch)
      .select('customerName customerContact createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const seen = new Set();
    invoices.forEach(inv => {
      const key = (inv.customerContact || '') + '|' + (inv.customerName || '');
      if (seen.has(key) || (!inv.customerName && !inv.customerContact)) return;
      seen.add(key);
      results.push({
        name: inv.customerName || '',
        contact: inv.customerContact || '',
        source: 'invoice',
        lastSeen: inv.createdAt,
      });
    });

    // Gather from CustomerNote records
    const noteMatch = {};
    if (q) {
      noteMatch.$or = [
        { name: { $regex: qEsc, $options: 'i' } },
        { phone: { $regex: qEsc, $options: 'i' } },
      ];
    }
    const notes = await CustomerNote.find(noteMatch)
      .select('phone name lastContacted')
      .sort({ lastContacted: -1, updatedAt: -1 })
      .limit(50)
      .lean();

    notes.forEach(n => {
      const key = n.phone + '|';
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        name: n.name || '',
        contact: n.phone || '',
        source: 'manual',
        lastSeen: n.lastContacted,
      });
    });

    // Sort: most recent first
    results.sort((a, b) => {
      const da = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const db = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return db - da;
    });

    res.json(results.slice(0, 30));
  } catch (err) {
    res.status(500).json({ error: 'Search failed: ' + (err.message || 'Unknown') });
  }
});

// ─── Get Notes for a Phone Number ─────────────────────────────────────────
router.get('/notes/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    let doc = await CustomerNote.findOne({ phone }).lean();
    if (!doc) {
      return res.json({ phone, name: '', notes: [] });
    }
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get notes: ' + (err.message || 'Unknown') });
  }
});

// ─── Add Note ─────────────────────────────────────────────────────────────
router.post('/notes/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const { text, name } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Note text is required' });
    }

    const displayName = req.user.displayName || req.user.username || 'Staff';

    let doc = await CustomerNote.findOne({ phone });
    if (!doc) {
      doc = new CustomerNote({ phone, name: name || '', notes: [] });
    }
    if (name && !doc.name) {
      doc.name = name;
    }

    doc.notes.push({
      text: text.trim(),
      createdBy: req.user.userId,
      createdByDisplay: displayName,
      createdAt: new Date(),
    });

    await doc.save();
    res.json(await CustomerNote.findById(doc._id).lean());
  } catch (err) {
    res.status(500).json({ error: 'Failed to add note: ' + (err.message || 'Unknown') });
  }
});

// ─── Delete Note ──────────────────────────────────────────────────────────
// Delete Note — manager/root only (staff can view/add but not delete)
router.delete('/notes/:phone/:noteId', requireRole('root', 'manager'), async (req, res) => {
  try {
    const { phone, noteId } = req.params;
    const doc = await CustomerNote.findOne({ phone });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return res.status(400).json({ error: 'Invalid note ID' });
    }

    doc.notes.pull({ _id: noteId });
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note: ' + (err.message || 'Unknown') });
  }
});

// ─── Update Customer Name ─────────────────────────────────────────────────
router.patch('/notes/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const doc = await CustomerNote.findOneAndUpdate(
      { phone },
      { $set: { name: name.trim() } },
      { upsert: true, new: true }
    ).lean();
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + (err.message || 'Unknown') });
  }
});

module.exports = router;
