/**
 * 折扣计算引擎
 * 支持单品折扣（百分比/固定金额）、整单折扣、折扣优先级和价格下限校验
 * 折扣后自动触发 VAT 重算
 */

const { calculateStandardVat, calculateMarginVat, DEFAULT_VAT_RATE } = require('./inv-vat-calculator');

/**
 * 对单个商品应用折扣
 *
 * @param {number} unitPrice - 商品原始单价（含税）
 * @param {{ type: 'percentage'|'fixed', value: number }} discount - 折扣信息
 * @returns {{ discountedPrice: number, discountAmount: number }}
 */
function applyItemDiscount(unitPrice, discount) {
  if (typeof unitPrice !== 'number' || isNaN(unitPrice) || unitPrice < 0) {
    return { discountedPrice: 0, discountAmount: 0 };
  }

  if (!discount || typeof discount !== 'object') {
    return { discountedPrice: unitPrice, discountAmount: 0 };
  }

  const { type, value } = discount;

  if (typeof value !== 'number' || isNaN(value) || value < 0) {
    return { discountedPrice: unitPrice, discountAmount: 0 };
  }

  let discountAmount = 0;

  if (type === 'percentage') {
    // 百分比折扣：value 为 0-100 的百分比值
    const rate = Math.min(value, 100) / 100;
    discountAmount = unitPrice * rate;
  } else if (type === 'fixed') {
    // 固定金额折扣：直接减去固定金额，不超过原价
    discountAmount = Math.min(value, unitPrice);
  } else {
    return { discountedPrice: unitPrice, discountAmount: 0 };
  }

  discountAmount = Math.round(discountAmount * 100) / 100;
  const discountedPrice = Math.round((unitPrice - discountAmount) * 100) / 100;

  return {
    discountedPrice: Math.max(0, discountedPrice),
    discountAmount,
  };
}

/**
 * 对整单应用折扣
 *
 * @param {number} subtotal - 整单小计（所有商品折后价之和）
 * @param {{ type: 'percentage'|'fixed', value: number }} discount - 整单折扣信息
 * @returns {{ discountedTotal: number, discountAmount: number }}
 */
function applyOrderDiscount(subtotal, discount) {
  if (typeof subtotal !== 'number' || isNaN(subtotal) || subtotal < 0) {
    return { discountedTotal: 0, discountAmount: 0 };
  }

  if (!discount || typeof discount !== 'object') {
    return { discountedTotal: subtotal, discountAmount: 0 };
  }

  const { type, value } = discount;

  if (typeof value !== 'number' || isNaN(value) || value < 0) {
    return { discountedTotal: subtotal, discountAmount: 0 };
  }

  let discountAmount = 0;

  if (type === 'percentage') {
    const rate = Math.min(value, 100) / 100;
    discountAmount = subtotal * rate;
  } else if (type === 'fixed') {
    discountAmount = Math.min(value, subtotal);
  } else {
    return { discountedTotal: subtotal, discountAmount: 0 };
  }

  discountAmount = Math.round(discountAmount * 100) / 100;
  const discountedTotal = Math.round((subtotal - discountAmount) * 100) / 100;

  return {
    discountedTotal: Math.max(0, discountedTotal),
    discountAmount,
  };
}

/**
 * 校验折扣价格下限
 * 折后含税售价不应低于不含税进价：costPrice / (1 + vatRate)
 *
 * @param {number} discountedPrice - 折扣后含税售价
 * @param {number} costPrice - 成本价（含税）
 * @param {number} [vatRate=0.23] - VAT 税率
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDiscountFloor(discountedPrice, costPrice, vatRate = DEFAULT_VAT_RATE) {
  if (typeof discountedPrice !== 'number' || isNaN(discountedPrice)) {
    return { valid: false, error: '折扣后价格无效' };
  }
  if (typeof costPrice !== 'number' || isNaN(costPrice) || costPrice < 0) {
    return { valid: false, error: '成本价无效' };
  }
  if (typeof vatRate !== 'number' || isNaN(vatRate) || vatRate < 0) {
    return { valid: false, error: 'VAT 税率无效' };
  }

  const exVatCost = costPrice / (1 + vatRate);
  const floorPrice = Math.round(exVatCost * 100) / 100;

  if (discountedPrice < floorPrice) {
    return {
      valid: false,
      error: `折扣后售价 ${discountedPrice} 低于不含税进价 ${floorPrice}`,
    };
  }

  return { valid: true };
}

/**
 * 计算折扣后购物车（含 VAT 重算）
 * 折扣优先级：先单品折扣，再整单折扣
 *
 * @param {Array<{
 *   unitPrice: number,
 *   costPrice: number,
 *   quantity: number,
 *   isSecondHand?: boolean,
 *   discount?: { type: 'percentage'|'fixed', value: number }
 * }>} items - 购物车商品列表
 * @param {{ type: 'percentage'|'fixed', value: number }|null} orderDiscount - 整单折扣
 * @param {number} [vatRate=0.23] - VAT 税率
 * @returns {{
 *   items: Array<{
 *     unitPrice: number,
 *     costPrice: number,
 *     quantity: number,
 *     isSecondHand: boolean,
 *     discount: object|null,
 *     discountedPrice: number,
 *     itemDiscountAmount: number,
 *     subtotal: number,
 *     vatAmount: number,
 *     marginVat: number
 *   }>,
 *   subtotalBeforeOrderDiscount: number,
 *   orderDiscountAmount: number,
 *   totalAmount: number,
 *   standardVatTotal: number,
 *   marginVatTotal: number
 * }}
 */
function calculateDiscountedCart(items, orderDiscount, vatRate = DEFAULT_VAT_RATE) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      items: [],
      subtotalBeforeOrderDiscount: 0,
      orderDiscountAmount: 0,
      totalAmount: 0,
      standardVatTotal: 0,
      marginVatTotal: 0,
    };
  }

  // Step 1: Apply item-level discounts
  const processedItems = items.map((item) => {
    const unitPrice = item.unitPrice || 0;
    const costPrice = item.costPrice || 0;
    const quantity = item.quantity || 1;
    const isSecondHand = item.isSecondHand || false;
    const itemVatRate = item.vatRate || vatRate;

    const { discountedPrice, discountAmount: itemDiscountAmount } = applyItemDiscount(
      unitPrice,
      item.discount || null
    );

    const subtotal = Math.round(discountedPrice * quantity * 100) / 100;

    // Calculate VAT based on discounted price and per-item vatRate
    let vatAmount = 0;
    let marginVat = 0;

    if (isSecondHand) {
      marginVat = calculateMarginVat(discountedPrice, costPrice, itemVatRate) * quantity;
      marginVat = Math.round(marginVat * 100) / 100;
    } else {
      vatAmount = calculateStandardVat(discountedPrice, itemVatRate) * quantity;
      vatAmount = Math.round(vatAmount * 100) / 100;
    }

    return {
      unitPrice,
      costPrice,
      quantity,
      isSecondHand,
      vatRate: itemVatRate,
      discount: item.discount || null,
      discountedPrice,
      itemDiscountAmount,
      subtotal,
      vatAmount,
      marginVat,
    };
  });

  // Step 2: Calculate subtotal before order discount
  const subtotalBeforeOrderDiscount = Math.round(
    processedItems.reduce((sum, item) => sum + item.subtotal, 0) * 100
  ) / 100;

  // Step 3: Apply order-level discount
  const { discountedTotal, discountAmount: orderDiscountAmount } = applyOrderDiscount(
    subtotalBeforeOrderDiscount,
    orderDiscount
  );

  // Step 4: If order discount applied, proportionally distribute and recalculate VAT
  let finalItems = processedItems;
  let standardVatTotal = 0;
  let marginVatTotal = 0;

  if (orderDiscountAmount > 0 && subtotalBeforeOrderDiscount > 0) {
    // Proportionally distribute order discount across items
    const orderDiscountRate = orderDiscountAmount / subtotalBeforeOrderDiscount;

    finalItems = processedItems.map((item) => {
      const itemOrderDiscount = Math.round(item.subtotal * orderDiscountRate * 100) / 100;
      const newSubtotal = Math.round((item.subtotal - itemOrderDiscount) * 100) / 100;
      // Per-unit discounted price after order discount
      const newDiscountedPrice = item.quantity > 0
        ? Math.round((newSubtotal / item.quantity) * 100) / 100
        : 0;

      let vatAmount = 0;
      let marginVat = 0;
      const itemVatRate = item.vatRate || vatRate;

      if (item.isSecondHand) {
        marginVat = calculateMarginVat(newDiscountedPrice, item.costPrice, itemVatRate) * item.quantity;
        marginVat = Math.round(marginVat * 100) / 100;
      } else {
        vatAmount = calculateStandardVat(newDiscountedPrice, itemVatRate) * item.quantity;
        vatAmount = Math.round(vatAmount * 100) / 100;
      }

      return {
        ...item,
        discountedPrice: newDiscountedPrice,
        subtotal: newSubtotal,
        vatAmount,
        marginVat,
      };
    });
  }

  // Step 5: Sum up VAT totals
  finalItems.forEach((item) => {
    standardVatTotal += item.vatAmount;
    marginVatTotal += item.marginVat;
  });

  standardVatTotal = Math.round(standardVatTotal * 100) / 100;
  marginVatTotal = Math.round(marginVatTotal * 100) / 100;

  return {
    items: finalItems,
    subtotalBeforeOrderDiscount,
    orderDiscountAmount,
    totalAmount: discountedTotal,
    standardVatTotal,
    marginVatTotal,
  };
}

module.exports = {
  applyItemDiscount,
  applyOrderDiscount,
  validateDiscountFloor,
  calculateDiscountedCart,
};
