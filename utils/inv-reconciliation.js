/**
 * 数据核对引擎
 * 提供库存核对、报表核对和税务核对功能
 * 用于定期自动核对和手动触发核对，确保数据一致性
 */

const Product = require('../models/inv/Product');
const StockMovement = require('../models/inv/StockMovement');
const Transaction = require('../models/inv/Transaction');
const { calculateStandardVat, calculateMarginVat, DEFAULT_VAT_RATE } = require('./inv-vat-calculator');

/**
 * 库存核对（核心逻辑）：比对商品列表与出入库汇总
 * 纯计算函数，不依赖数据库，便于测试
 *
 * @param {Array} products - 商品列表 [{_id, name, sku, stock}]
 * @param {Array} entryAgg - 入库汇总 [{_id, totalEntry}]
 * @param {Array} exitAgg - 出库汇总 [{_id, totalExit}]
 * @returns {Array<{productId: string, name: string, sku: string, expectedStock: number, actualStock: number, difference: number}>}
 */
function computeStockDiscrepancies(products, entryAgg, exitAgg) {
  // Build lookup maps
  const entryMap = {};
  for (const e of entryAgg) {
    entryMap[e._id.toString()] = e.totalEntry;
  }
  const exitMap = {};
  for (const e of exitAgg) {
    exitMap[e._id.toString()] = e.totalExit;
  }

  const report = [];
  for (const product of products) {
    const pid = product._id.toString();
    const totalEntry = entryMap[pid] || 0;
    const totalExit = exitMap[pid] || 0;
    const expectedStock = totalEntry - totalExit;
    const actualStock = product.stock;
    const difference = actualStock - expectedStock;

    report.push({
      productId: pid,
      name: product.name,
      sku: product.sku,
      expectedStock,
      actualStock,
      difference
    });
  }

  return report;
}

/**
 * 库存核对：比对商品 stock 字段与 StockMovement 记录的净入库量
 * 对每个活跃商品，计算 net stock = sum(entry quantities) - sum(exit quantities)
 * 与 product.stock 比较，生成差异报告
 *
 * @returns {Promise<Array<{productId: string, name: string, sku: string, expectedStock: number, actualStock: number, difference: number}>>}
 */
async function reconcileStock() {
  const products = await Product.find({ active: true }).select('name sku stock');

  if (products.length === 0) {
    return [];
  }

  const productIds = products.map(p => p._id);

  const entryAgg = await StockMovement.aggregate([
    { $match: { product: { $in: productIds }, type: 'entry' } },
    { $group: { _id: '$product', totalEntry: { $sum: '$quantity' } } }
  ]);

  const exitAgg = await StockMovement.aggregate([
    { $match: { product: { $in: productIds }, type: 'exit' } },
    { $group: { _id: '$product', totalExit: { $sum: '$quantity' } } }
  ]);

  return computeStockDiscrepancies(products, entryAgg, exitAgg);
}

/**
 * 报表核对（核心逻辑）：比对交易记录直接汇总与聚合管道汇总
 * 纯计算函数，不依赖数据库，便于测试
 *
 * @param {Array} transactions - 交易记录列表
 * @param {Array} aggResult - MongoDB 聚合管道结果
 * @param {string} startDateStr - 开始日期字符串
 * @param {string} endDateStr - 结束日期字符串
 * @returns {{startDate: string, endDate: string, transactionTotals: object, reportTotals: object, discrepancies: Array}}
 */
function computeReportDiscrepancies(transactions, aggResult, startDateStr, endDateStr) {
  // Method 1: Direct sum from transaction records
  let txnTotalAmount = 0;
  let txnCashTotal = 0;
  let txnCardTotal = 0;
  let txnStandardVatTotal = 0;
  let txnMarginVatTotal = 0;

  for (const txn of transactions) {
    txnTotalAmount += txn.totalAmount;
    if (txn.paymentMethod === 'cash') {
      txnCashTotal += txn.totalAmount;
    } else {
      txnCardTotal += txn.totalAmount;
    }
    txnStandardVatTotal += txn.standardVatTotal || 0;
    txnMarginVatTotal += txn.marginVatTotal || 0;
  }

  // Method 2: From aggregation pipeline result
  const reportTotals = aggResult.length > 0 ? {
    totalAmount: Math.round((aggResult[0].totalAmount || 0) * 100) / 100,
    cashTotal: Math.round((aggResult[0].cashTotal || 0) * 100) / 100,
    cardTotal: Math.round((aggResult[0].cardTotal || 0) * 100) / 100,
    standardVatTotal: Math.round((aggResult[0].standardVatTotal || 0) * 100) / 100,
    marginVatTotal: Math.round((aggResult[0].marginVatTotal || 0) * 100) / 100,
    transactionCount: aggResult[0].count || 0
  } : {
    totalAmount: 0,
    cashTotal: 0,
    cardTotal: 0,
    standardVatTotal: 0,
    marginVatTotal: 0,
    transactionCount: 0
  };

  const transactionTotals = {
    totalAmount: Math.round(txnTotalAmount * 100) / 100,
    cashTotal: Math.round(txnCashTotal * 100) / 100,
    cardTotal: Math.round(txnCardTotal * 100) / 100,
    standardVatTotal: Math.round(txnStandardVatTotal * 100) / 100,
    marginVatTotal: Math.round(txnMarginVatTotal * 100) / 100,
    transactionCount: transactions.length
  };

  // Identify discrepancies
  const discrepancies = [];
  const fields = ['totalAmount', 'cashTotal', 'cardTotal', 'standardVatTotal', 'marginVatTotal', 'transactionCount'];

  for (const field of fields) {
    const txnVal = transactionTotals[field];
    const rptVal = reportTotals[field];
    const diff = Math.round((txnVal - rptVal) * 100) / 100;
    if (diff !== 0) {
      discrepancies.push({
        field,
        transactionValue: txnVal,
        reportValue: rptVal,
        difference: diff
      });
    }
  }

  // Check that cash + card = total
  const txnPaymentSum = Math.round((txnCashTotal + txnCardTotal) * 100) / 100;
  const txnPaymentDiff = Math.round((transactionTotals.totalAmount - txnPaymentSum) * 100) / 100;
  if (txnPaymentDiff !== 0) {
    discrepancies.push({
      field: 'paymentMethodSplit',
      description: 'Cash + Card totals do not match total sales amount',
      totalAmount: transactionTotals.totalAmount,
      cashPlusCard: txnPaymentSum,
      difference: txnPaymentDiff
    });
  }

  return {
    startDate: startDateStr,
    endDate: endDateStr,
    transactionTotals,
    reportTotals,
    discrepancies
  };
}

/**
 * 报表核对：比对 Transaction 记录与报表聚合数据
 * 在指定日期范围内，独立聚合交易数据并与报表逻辑交叉验证
 *
 * @param {Date|string} startDate - 开始日期
 * @param {Date|string} endDate - 结束日期
 * @returns {Promise<{startDate: string, endDate: string, transactionTotals: object, reportTotals: object, discrepancies: Array}>}
 */
async function reconcileReports(startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const transactions = await Transaction.find({
    createdAt: { $gte: start, $lte: end }
  });

  const aggResult = await Transaction.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$totalAmount' },
        cashTotal: {
          $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$totalAmount', 0] }
        },
        cardTotal: {
          $sum: { $cond: [{ $eq: ['$paymentMethod', 'card'] }, '$totalAmount', 0] }
        },
        standardVatTotal: { $sum: '$standardVatTotal' },
        marginVatTotal: { $sum: '$marginVatTotal' },
        count: { $sum: 1 }
      }
    }
  ]);

  const startDateStr = start.toISOString().split('T')[0];
  const endDateStr = end.toISOString().split('T')[0];

  return computeReportDiscrepancies(transactions, aggResult, startDateStr, endDateStr);
}

/**
 * 税务核对（核心逻辑）：比对交易中 VAT 字段与重新计算的 VAT 值
 * 纯计算函数，不依赖数据库，便于测试
 *
 * @param {Array} transactions - 交易记录列表
 * @param {number} vatRate - VAT 税率
 * @param {string} startDateStr - 开始日期字符串
 * @param {string} endDateStr - 结束日期字符串
 * @returns {{startDate: string, endDate: string, summary: object, discrepancies: Array}}
 */
function computeVatDiscrepancies(transactions, vatRate, startDateStr, endDateStr) {
  const discrepancies = [];
  let totalRecordedStandardVat = 0;
  let totalRecordedMarginVat = 0;
  let totalRecalculatedStandardVat = 0;
  let totalRecalculatedMarginVat = 0;

  for (const txn of transactions) {
    let txnRecalcStandardVat = 0;
    let txnRecalcMarginVat = 0;
    const itemDiscrepancies = [];

    for (const item of txn.items) {
      const effectivePrice = item.discountedPrice != null ? item.discountedPrice : item.unitPrice;

      if (item.isSecondHand) {
        // Margin VAT recalculation
        const recalcMarginVat = calculateMarginVat(effectivePrice, item.costPrice, vatRate);
        const recalcMarginVatTotal = Math.round(recalcMarginVat * item.quantity * 100) / 100;
        const recordedMarginVat = Math.round((item.marginVat || 0) * 100) / 100;
        const diff = Math.round((recordedMarginVat - recalcMarginVatTotal) * 100) / 100;

        txnRecalcMarginVat += recalcMarginVatTotal;

        if (diff !== 0) {
          itemDiscrepancies.push({
            itemName: item.name,
            sku: item.sku,
            serialNumber: item.serialNumber || null,
            isSecondHand: true,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice,
            effectivePrice,
            quantity: item.quantity,
            recordedMarginVat: recordedMarginVat,
            recalculatedMarginVat: recalcMarginVatTotal,
            difference: diff
          });
        }
      } else {
        // Standard VAT recalculation
        const recalcVat = calculateStandardVat(effectivePrice, vatRate);
        const recalcVatTotal = Math.round(recalcVat * item.quantity * 100) / 100;
        const recordedVat = Math.round((item.vatAmount || 0) * 100) / 100;
        const diff = Math.round((recordedVat - recalcVatTotal) * 100) / 100;

        txnRecalcStandardVat += recalcVatTotal;

        if (diff !== 0) {
          itemDiscrepancies.push({
            itemName: item.name,
            sku: item.sku,
            serialNumber: item.serialNumber || null,
            isSecondHand: false,
            unitPrice: item.unitPrice,
            effectivePrice,
            quantity: item.quantity,
            recordedVatAmount: recordedVat,
            recalculatedVatAmount: recalcVatTotal,
            difference: diff
          });
        }
      }
    }

    // Compare transaction-level VAT totals
    const recordedStdVat = Math.round((txn.standardVatTotal || 0) * 100) / 100;
    const recordedMgnVat = Math.round((txn.marginVatTotal || 0) * 100) / 100;
    const recalcStdVat = Math.round(txnRecalcStandardVat * 100) / 100;
    const recalcMgnVat = Math.round(txnRecalcMarginVat * 100) / 100;

    totalRecordedStandardVat += recordedStdVat;
    totalRecordedMarginVat += recordedMgnVat;
    totalRecalculatedStandardVat += recalcStdVat;
    totalRecalculatedMarginVat += recalcMgnVat;

    const stdVatDiff = Math.round((recordedStdVat - recalcStdVat) * 100) / 100;
    const mgnVatDiff = Math.round((recordedMgnVat - recalcMgnVat) * 100) / 100;

    if (itemDiscrepancies.length > 0 || stdVatDiff !== 0 || mgnVatDiff !== 0) {
      discrepancies.push({
        transactionId: txn._id.toString(),
        receiptNumber: txn.receiptNumber,
        createdAt: txn.createdAt,
        recordedStandardVat: recordedStdVat,
        recalculatedStandardVat: recalcStdVat,
        standardVatDifference: stdVatDiff,
        recordedMarginVat: recordedMgnVat,
        recalculatedMarginVat: recalcMgnVat,
        marginVatDifference: mgnVatDiff,
        itemDiscrepancies
      });
    }
  }

  return {
    startDate: startDateStr,
    endDate: endDateStr,
    summary: {
      totalTransactions: transactions.length,
      transactionsWithDiscrepancies: discrepancies.length,
      recordedStandardVatTotal: Math.round(totalRecordedStandardVat * 100) / 100,
      recalculatedStandardVatTotal: Math.round(totalRecalculatedStandardVat * 100) / 100,
      standardVatDifference: Math.round((totalRecordedStandardVat - totalRecalculatedStandardVat) * 100) / 100,
      recordedMarginVatTotal: Math.round(totalRecordedMarginVat * 100) / 100,
      recalculatedMarginVatTotal: Math.round(totalRecalculatedMarginVat * 100) / 100,
      marginVatDifference: Math.round((totalRecordedMarginVat - totalRecalculatedMarginVat) * 100) / 100
    },
    discrepancies
  };
}

/**
 * 税务核对：比对 Transaction 中 VAT 字段与重新计算的 VAT 值
 * 对每笔交易的每个商品，根据售价/成本价/二手标识重新计算 VAT
 *
 * @param {Date|string} startDate - 开始日期
 * @param {Date|string} endDate - 结束日期
 * @param {number} [vatRate=0.23] - VAT 税率
 * @returns {Promise<{startDate: string, endDate: string, summary: object, discrepancies: Array}>}
 */
async function reconcileVat(startDate, endDate, vatRate = DEFAULT_VAT_RATE) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const transactions = await Transaction.find({
    createdAt: { $gte: start, $lte: end }
  });

  const startDateStr = start.toISOString().split('T')[0];
  const endDateStr = end.toISOString().split('T')[0];

  return computeVatDiscrepancies(transactions, vatRate, startDateStr, endDateStr);
}

module.exports = {
  reconcileStock,
  reconcileReports,
  reconcileVat,
  // Export pure computation functions for testing
  computeStockDiscrepancies,
  computeReportDiscrepancies,
  computeVatDiscrepancies
};
