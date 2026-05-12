const mongoose = require('mongoose');

const BrandSchema = new mongoose.Schema({
    brandId:  { type: String, required: true, unique: true },
    name:     { type: String, required: true },
    // types: { typeId: { name, models: { modelId: { name, issues: { issueId: { name, price } } } } } }
    types:    { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Brand', BrandSchema);
