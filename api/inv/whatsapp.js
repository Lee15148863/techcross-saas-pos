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

// ─── All Customers (paginated, no search required) ─────────────────────────
router.get('/customers/all', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    // Gather unique customers from Invoice records
    const invoiceCustomers = await Invoice.aggregate([
      { $match: { customerContact: { $ne: '', $exists: true } } },
      { $group: {
          _id: '$customerContact',
          name: { $first: '$customerName' },
          contact: { $first: '$customerContact' },
          lastSeen: { $max: '$createdAt' },
          invoiceCount: { $sum: 1 },
        }
      },
      { $sort: { lastSeen: -1 } },
    ]);

    // Gather from CustomerNote records
    const noteCustomers = await CustomerNote.find({ phone: { $ne: '' } })
      .select('phone name lastContacted')
      .sort({ lastContacted: -1 })
      .lean();

    // Merge & deduplicate by phone
    const customerMap = new Map();
    invoiceCustomers.forEach(c => {
      const phone = c.contact || '';
      if (!phone) return;
      customerMap.set(phone, {
        name: c.name || '',
        contact: phone,
        source: 'invoice',
        lastSeen: c.lastSeen,
        invoiceCount: c.invoiceCount || 0,
      });
    });
    noteCustomers.forEach(n => {
      const phone = n.phone || '';
      if (!phone) return;
      if (customerMap.has(phone)) {
        const existing = customerMap.get(phone);
        if (!existing.name && n.name) existing.name = n.name;
        if (n.lastContacted && (!existing.lastSeen || new Date(n.lastContacted) > new Date(existing.lastSeen))) {
          existing.lastSeen = n.lastContacted;
        }
      } else {
        customerMap.set(phone, {
          name: n.name || '',
          contact: phone,
          source: 'manual',
          lastSeen: n.lastContacted,
          invoiceCount: 0,
        });
      }
    });

    // Convert to array and sort
    let allCustomers = Array.from(customerMap.values());
    allCustomers.sort((a, b) => {
      const da = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const db = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return db - da;
    });

    const total = allCustomers.length;
    const totalPages = Math.ceil(total / limit);
    const pageCustomers = allCustomers.slice(skip, skip + limit);

    res.json({
      customers: pageCustomers,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list customers: ' + (err.message || 'Unknown') });
  }
});

// ─── Customer Profile ─────────────────────────────────────────────────────
router.get('/profile/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    // Basic info from CustomerNote or first Invoice
    let basic = await CustomerNote.findOne({ phone }).select('phone name lastContacted').lean();
    let invoiceCount = 0;
    if (!basic) {
      const firstInv = await Invoice.findOne({ customerContact: phone })
        .select('customerName customerContact createdAt')
        .sort({ createdAt: -1 })
        .lean();
      if (firstInv) {
        basic = {
          phone: firstInv.customerContact,
          name: firstInv.customerName || '',
          lastContacted: firstInv.createdAt,
        };
      }
    }

    // Invoice history
    const invoices = await Invoice.find({ customerContact: phone })
      .select('invoiceNumber createdAt grossTotal paymentMethod items operatorName')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    invoiceCount = invoices.length;

    // Count total invoices for this customer
    const totalInvoices = await Invoice.countDocuments({ customerContact: phone });

    res.json({
      customer: {
        name: basic?.name || '',
        contact: phone,
        lastSeen: basic?.lastContacted || null,
        invoiceCount: totalInvoices,
      },
      invoices: invoices.map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        date: inv.createdAt,
        total: inv.grossTotal,
        paymentMethod: inv.paymentMethod,
        items: (inv.items || []).map(i => ({ name: i.name, quantity: i.quantity })),
        operatorName: inv.operatorName || '',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile: ' + (err.message || 'Unknown') });
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
