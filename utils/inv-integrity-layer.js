/**
 * System Integrity Layer
 *
 * Prevents direct database writes to critical financial models
 * (Transaction, CashLedger, Device financial fields) outside of
 * approved services. Runs as Mongoose pre-hooks.
 *
 * Usage in services:
 *   const { authorize, SOURCES } = require('./inv-integrity-layer');
 *   const doc = authorize(new Transaction({...}), SOURCES.CHECKOUT);
 *   await doc.save({ session });
 */

const { calculateStandardVat, calculateMarginVat } = require('./inv-vat-calculator');

// ─── Approved Sources ─────────────────────────────────────────────────
const SOURCES = Object.freeze({
  CHECKOUT: 'checkout',
  REFUND: 'refund',
  ROOT_EDIT: 'root-edit',
});

const _allowedSources = new Set(Object.values(SOURCES));

// ─── Integrity Token (Symbol — inaccessible outside this module) ──────
const I = Symbol('integrity:authorized');

/**
 * Mark a Mongoose document as authorized for integrity-protected writes.
 * Must be called before save() on any protected model.
 *
 * @param {import('mongoose').Document} doc
 * @param {string} source — one of SOURCES.*
 * @returns {import('mongoose').Document} same doc, for chaining
 */
function authorize(doc, source) {
  if (!_allowedSources.has(source)) {
    throw new Error(`Unknown integrity source: "${source}"`);
  }
  doc[I] = source;
  return doc;
}

/**
 * Get the integrity source from a document, or null if unauthorized.
 */
function getSource(doc) {
  return doc && doc[I] ? doc[I] : null;
}

/**
 * Check whether a document is authorized from one of the given sources.
 *
 * @param {import('mongoose').Document} doc
 * @param {...string} allowed — SOURCES values to allow
 */
function isAuthorized(doc, ...allowed) {
  const src = getSource(doc);
  return !!src && allowed.includes(src);
}

// ─── Per-Item VAT Calculation (handles negative prices for refunds) ───
function _expectedItemVat(item) {
  const price = item.discountedPrice || item.unitPrice || 0;
  const absPrice = Math.abs(price);
  const rate = item.vatRate || 0.23;
  const qty = item.quantity || 1;
  const sign = price < 0 ? -1 : 1;

  if (item.marginScheme) {
    const perUnit = calculateMarginVat(absPrice, Math.abs(item.costPrice || 0), rate);
    return { vatAmount: 0, marginVat: sign * Math.round(perUnit * qty * 100) / 100 };
  }
  const perUnit = calculateStandardVat(absPrice, rate);
  return { vatAmount: sign * Math.round(perUnit * qty * 100) / 100, marginVat: 0 };
}

// ─── Transaction VAT Re-Validation ────────────────────────────────────
/**
 * Verify every item's VAT matches backend calculation, and that document
 * totals equal the sum of item-level values.
 *
 * @param {import('mongoose').Document} doc — a Transaction document being saved
 * @param {string|null} source — integrity source (checkout → full check; others → totals only)
 */
function validateTransactionVAT(doc, source) {
  let sumStd = 0;
  let sumMargin = 0;
  let sumSubtotal = 0;

  for (const item of doc.items) {
    sumSubtotal += item.subtotal || 0;
    sumStd += item.vatAmount || 0;
    sumMargin += item.marginVat || 0;

    // Full per-item VAT re-computation only for checkout source
    // (refunds use simplified VAT that doesn't match per-item recomputation)
    if (source === SOURCES.CHECKOUT) {
      const expected = _expectedItemVat(item);
      if (Math.abs((item.vatAmount || 0) - expected.vatAmount) > 0.02) {
        throw new Error(
          `INTEGRITY: "${item.name}" vatAmount ${item.vatAmount} !== ${expected.vatAmount} ` +
          `(price=${item.discountedPrice || item.unitPrice}, rate=${item.vatRate || 0.23}, qty=${item.quantity})`
        );
      }
      if (Math.abs((item.marginVat || 0) - expected.marginVat) > 0.02) {
        throw new Error(
          `INTEGRITY: "${item.name}" marginVat ${item.marginVat} !== ${expected.marginVat} ` +
          `(price=${item.discountedPrice || item.unitPrice}, cost=${item.costPrice || 0}, rate=${item.vatRate || 0.23}, qty=${item.quantity})`
        );
      }
    }
  }

  sumStd = Math.round(sumStd * 100) / 100;
  sumMargin = Math.round(sumMargin * 100) / 100;
  sumSubtotal = Math.round(sumSubtotal * 100) / 100;

  if (Math.abs((doc.standardVatTotal || 0) - sumStd) > 0.02) {
    throw new Error(
      `INTEGRITY: standardVatTotal ${doc.standardVatTotal} !== sum(items) ${sumStd}`
    );
  }
  if (Math.abs((doc.marginVatTotal || 0) - sumMargin) > 0.02) {
    throw new Error(
      `INTEGRITY: marginVatTotal ${doc.marginVatTotal} !== sum(items) ${sumMargin}`
    );
  }
  if (Math.abs((doc.totalAmount || 0) - sumSubtotal) > 0.02) {
    throw new Error(
      `INTEGRITY: totalAmount ${doc.totalAmount} !== sum(items) ${sumSubtotal}`
    );
  }
}

// ─── Transaction Payment Validation ───────────────────────────────────
function validateTransactionPayment(doc) {
  const { paymentMethod, totalAmount, cashReceived, cardAmount, changeGiven } = doc;

  if (paymentMethod === 'cash') {
    if (cashReceived == null || cashReceived < totalAmount) {
      throw new Error(`INTEGRITY: cashReceived=${cashReceived} < totalAmount=${totalAmount}`);
    }
    if (changeGiven != null && changeGiven < 0) {
      throw new Error(`INTEGRITY: changeGiven=${changeGiven} is negative`);
    }
  } else if (paymentMethod === 'card') {
    if (Math.abs((cardAmount || 0) - totalAmount) > 0.02) {
      throw new Error(`INTEGRITY: cardAmount=${cardAmount} !== totalAmount=${totalAmount}`);
    }
  } else if (paymentMethod === 'split') {
    if (cardAmount == null || cashReceived == null) {
      throw new Error('INTEGRITY: split payment missing cardAmount or cashReceived');
    }
    const cashPortion = Math.round((totalAmount - cardAmount) * 100) / 100;
    if (cashPortion < 0) {
      throw new Error(`INTEGRITY: cardAmount=${cardAmount} > totalAmount=${totalAmount}`);
    }
    if (cashReceived < cashPortion) {
      throw new Error(`INTEGRITY: split cash=${cashReceived} < cashPortion=${cashPortion}`);
    }
  }
}

module.exports = {
  SOURCES,
  authorize,
  getSource,
  isAuthorized,
  validateTransactionVAT,
  validateTransactionPayment,
};
