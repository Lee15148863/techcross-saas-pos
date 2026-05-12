/**
 * VAT 计算引擎
 * 支持标准 VAT 和 Margin Scheme VAT（二手商品差价税）计算
 * 默认税率为爱尔兰标准税率 23%
 */

const DEFAULT_VAT_RATE = 0.23;

/**
 * 计算标准 VAT（适用于非二手商品）
 * 公式：VAT = sellingPrice × vatRate / (1 + vatRate)
 *
 * @param {number} sellingPrice - 含税售价
 * @param {number} [vatRate=0.23] - VAT 税率，默认 0.23（23%）
 * @returns {number} VAT 金额，保留 2 位小数
 */
function calculateStandardVat(sellingPrice, vatRate = DEFAULT_VAT_RATE) {
  if (typeof sellingPrice !== 'number' || isNaN(sellingPrice) || sellingPrice < 0) {
    return 0;
  }
  if (typeof vatRate !== 'number' || isNaN(vatRate) || vatRate < 0) {
    return 0;
  }
  const vat = sellingPrice * vatRate / (1 + vatRate);
  return Math.round(vat * 100) / 100;
}

/**
 * 计算 Margin Scheme VAT（适用于二手商品）
 * 公式：VAT = max(0, (sellingPrice - costPrice) × vatRate / (1 + vatRate))
 * 当差价为负（亏损）时，VAT 自动设为 0
 *
 * @param {number} sellingPrice - 含税售价
 * @param {number} costPrice - 成本价
 * @param {number} [vatRate=0.23] - VAT 税率，默认 0.23（23%）
 * @returns {number} Margin VAT 金额，保留 2 位小数
 */
function calculateMarginVat(sellingPrice, costPrice, vatRate = DEFAULT_VAT_RATE) {
  if (typeof sellingPrice !== 'number' || isNaN(sellingPrice) || sellingPrice < 0) {
    return 0;
  }
  if (typeof costPrice !== 'number' || isNaN(costPrice) || costPrice < 0) {
    return 0;
  }
  if (typeof vatRate !== 'number' || isNaN(vatRate) || vatRate < 0) {
    return 0;
  }
  const margin = sellingPrice - costPrice;
  if (margin <= 0) {
    return 0;
  }
  const vat = margin * vatRate / (1 + vatRate);
  return Math.round(vat * 100) / 100;
}

module.exports = { calculateStandardVat, calculateMarginVat, DEFAULT_VAT_RATE };
