const express = require('express');
const router = express.Router();
const SystemSetting = require('../models/inv/SystemSetting');
const jwt = require('jsonwebtoken');

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

// GET /api/banner — public, returns banner settings (or empty)
router.get('/', async (req, res) => {
    try {
        const setting = await SystemSetting.findOne({ key: 'banner_settings' });
        res.json(setting ? setting.value : { enabled: false });
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/banner — admin, update banner settings
router.put('/', adminAuth, async (req, res) => {
    try {
        const { enabled, textEn, textGa, bgColor, textColor, fontSize, fontWeight, scrollSpeed } = req.body;
        const value = { enabled: !!enabled, textEn: textEn || '', textGa: textGa || '', bgColor: bgColor || '#000000', textColor: textColor || '#D4E157', fontSize: parseInt(fontSize) || 15, fontWeight: fontWeight || '500', scrollSpeed: parseInt(scrollSpeed) || 20 };
        await SystemSetting.findOneAndUpdate(
            { key: 'banner_settings' },
            { key: 'banner_settings', value, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
