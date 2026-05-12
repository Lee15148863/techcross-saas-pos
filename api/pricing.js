const express = require('express');
const router = express.Router();
const Pricing = require('../models/Pricing');
const jwt = require('jsonwebtoken');

// Admin auth: JWT only
function adminAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const decoded = jwt.verify(authHeader.slice(7), process.env.INV_JWT_SECRET);
            if (decoded.role === 'root') { req.user = decoded; return next(); }
        } catch (e) { /* fall through */ }
    }
    return res.status(401).json({ error: 'Unauthorized' });
}

// GET /api/pricing/:brand — public, used by frontend pages
router.get('/:brand', async (req, res) => {
    try {
        const doc = await Pricing.findOne({ brand: req.params.brand });
        if (!doc) return res.status(404).json({ error: 'Brand not found' });
        res.json(doc.data);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/pricing — list all brands (for admin)
router.get('/', async (req, res) => {
    try {
        const docs = await Pricing.find({}, 'brand updatedAt');
        res.json(docs);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/pricing/:brand — admin only, save full pricing data
router.put('/:brand', adminAuth, async (req, res) => {
    try {
        const doc = await Pricing.findOneAndUpdate(
            { brand: req.params.brand },
            { data: req.body, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true, updatedAt: doc.updatedAt });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
