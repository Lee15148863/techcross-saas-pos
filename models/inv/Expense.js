const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  category:    { type: String, required: true, trim: true },
  // Common categories: 'Lyca Credit', '收购客人商品', '店铺杂费', '其他'
  description: { type: String, trim: true },
  amount:      { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: ['cash', 'card', 'bank_transfer'], default: 'cash' },
  operator:    { type: mongoose.Schema.Types.ObjectId, ref: 'InvUser', required: true },
  date:        { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now }
});

ExpenseSchema.index({ date: -1 });
ExpenseSchema.index({ category: 1 });

module.exports = mongoose.model('Expense', ExpenseSchema);
