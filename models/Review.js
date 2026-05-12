const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
    name:      { type: String, required: true, trim: true },
    rating:    { type: Number, required: true, min: 1, max: 5 },
    message:   { type: String, required: true, trim: true },
    approved:  { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Review', ReviewSchema);
