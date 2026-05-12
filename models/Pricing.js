const mongoose = require('mongoose');

const PricingSchema = new mongoose.Schema({
    brand: { type: String, required: true, unique: true }, // 'apple', 'samsung', 'xiaomi', etc.
    data: { type: mongoose.Schema.Types.Mixed, required: true }, // full pricing object
    updatedAt: { type: Date, default: Date.now }
});

PricingSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Pricing', PricingSchema);
