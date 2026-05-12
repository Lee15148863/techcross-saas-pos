const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Review = require('../models/Review');
const jwt = require('jsonwebtoken');

function sanitizeText(value) {
    return String(value || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

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

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const reviewSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many reviews submitted, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/reviews — public, only approved reviews
router.get('/', publicLimiter, async (req, res) => {
    try {
        const reviews = await Review.find({ approved: true }).sort({ createdAt: -1 }).limit(50);
        res.json(reviews);
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/reviews/all — admin, all reviews
router.get('/all', adminAuth, async (req, res) => {
    try {
        const reviews = await Review.find({}).sort({ createdAt: -1 });
        res.json(reviews);
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/reviews — public, submit a review
router.post('/', reviewSubmitLimiter, async (req, res) => {
    try {
        const { name, rating, message } = req.body;
        if (!name || !rating || !message) return res.status(400).json({ error: 'All fields required' });
        if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
        const review = await Review.create({
            name: sanitizeText(name),
            rating,
            message: sanitizeText(message)
        });
        res.json({ success: true, message: 'Thank you! Your review will appear after approval.' });
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/reviews/:id/approve — admin, approve a review
router.put('/:id/approve', adminAuth, async (req, res) => {
    try {
        await Review.findByIdAndUpdate(req.params.id, { approved: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/reviews/:id/reject — admin, unapprove a review
router.put('/:id/reject', adminAuth, async (req, res) => {
    try {
        await Review.findByIdAndUpdate(req.params.id, { approved: false });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/reviews/:id — admin, delete a review
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        await Review.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
