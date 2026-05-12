/**
 * Receipt Content Generator
 * Generates structured receipt data for both Print Agent ESC/POS and browser print fallback.
 * All receipt text output is in English only.
 */

/**
 * Generate a receipt number from a Date object.
 * Delegates to the dedicated receipt number generator.
 * Uses default type 'sale' when no transaction type context is available.
 *
 * @param {Date} date - The transaction date
 * @returns {string} Receipt number in S-YYYYMMDDHHmmss-XXXXXXXX format
 */
function generateReceiptNumber(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Invalid date provided');
  }
  return require('./inv-receipt-number').generateReceiptNumber('sale', date);
}

/**
 * Format a Date object as DD/MM/YYYY HH:mm:ss for receipt display.
 *
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string
 */
function formatReceiptDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Invalid date provided');
  }

  const dd = String(date.getDate()).padStart(2, '0');
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear().toString();
  const HH = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return `${dd}/${MM}/${yyyy} ${HH}:${mm}:${ss}`;
}

// Default company info (pulled from existing site data)
const DEFAULT_COMPANY_INFO = {
  name: 'Tech Cross Repair Centre',
  logo: 'logo.png',
  address: 'Unit 4, Navan Shopping Centre, Navan, Co. Meath, C15 F658, Ireland',
  phone: '046 905 9854',
  mobile: '089 482 5300',
  email: 'navantechcross@gmail.com',
  website: 'https://techcross.ie',
};

// Fixed receipt terms text (English only)
const TERMS_TEXT =
  'Warranty & Store Policy\n' +
  'Repairs - 3 Months: Covers replaced parts for hardware defects only. Void if physical/liquid damage or third-party repair. Customer must back up data before repair.\n' +
  'Pre-owned devices - 7-day refund policy: Device must be returned in the same condition, pass inspection, and be free from account locks.\n' +
  'Accessories - 14 Days: Exchange/return only if unopened, sealed, and resalable.';

const SECOND_HAND_TERMS_TEXT =
  'IMPORTANT - Pre-owned Devices - 7 Days: No physical/liquid damage. Must be fully erased with no Apple ID, Google ID, or passcode. Locked devices are non-refundable. Warranty covers hardware defects only. Refund after inspection via original payment method.';

const QR_CODE_URL = 'https://techcross.ie/receipt-terms.html';
const REPAIR_TC_URL = 'https://techcross.ie/terms.html';

/**
 * Generate structured receipt content from a transaction record.
 *
 * @param {object} transaction - The transaction record (matching Transaction schema)
 * @param {object} [companyInfo] - Optional company info override
 * @param {string} [companyInfo.name] - Company name
 * @param {string} [companyInfo.logo] - Company logo filename
 * @param {string} [companyInfo.address] - Company address
 * @param {string} [companyInfo.phone] - Company phone
 * @returns {object} Structured receipt content
 */
function generateReceipt(transaction, companyInfo) {
  if (!transaction || typeof transaction !== 'object') {
    throw new Error('Transaction data is required');
  }

  const company = { ...DEFAULT_COMPANY_INFO, ...(companyInfo || {}) };

  // Determine transaction date
  const txDate = transaction.createdAt
    ? new Date(transaction.createdAt)
    : new Date();

  // Build receipt number from transaction or generate from date
  const receiptNumber = transaction.receiptNumber || generateReceiptNumber(txDate);

  // Build items list
  const items = (transaction.items || []).map((item) => {
    const receiptItem = {
      name: item.name || '',
      quantity: item.quantity || 1,
      unitPrice: item.unitPrice || 0,
      discountedPrice: item.discountedPrice != null ? item.discountedPrice : item.unitPrice || 0,
      subtotal: item.subtotal || 0,
      isSecondHand: item.isSecondHand || false,
    };

    // Include serial number for second-hand items (IMEI/SN)
    if (item.serialNumber) {
      receiptItem.serialNumber = item.serialNumber;
    }

    return receiptItem;
  });

  // Check if any items are second-hand
  const hasSecondHandItems = items.some((item) => item.isSecondHand);

  // Build discount info
  const itemDiscounts = (transaction.items || [])
    .filter((item) => item.discount && item.discount.type && item.discount.value > 0)
    .map((item) => ({
      itemName: item.name || '',
      discountType: item.discount.type,
      discountValue: item.discount.value,
      originalPrice: item.unitPrice || 0,
      discountedPrice: item.discountedPrice != null ? item.discountedPrice : item.unitPrice || 0,
    }));

  const orderDiscount = transaction.orderDiscount &&
    transaction.orderDiscount.type &&
    transaction.orderDiscount.value > 0
    ? {
        discountType: transaction.orderDiscount.type,
        discountValue: transaction.orderDiscount.value,
      }
    : null;

  const discountInfo = {
    itemDiscounts,
    orderDiscount,
  };

  // Build the receipt object
  const receipt = {
    companyName: company.name,
    companyLogo: company.logo,
    companyAddress: company.address,
    companyPhone: company.phone,
    receiptNumber,
    date: formatReceiptDate(txDate),
    items,
    discountInfo,
    totalAmount: transaction.totalAmount || 0,
    paymentMethod: transaction.paymentMethod || 'cash',
    cardAmount: transaction.cardAmount != null ? transaction.cardAmount : null,
    cashReceived: transaction.cashReceived != null ? transaction.cashReceived : null,
    changeGiven: transaction.changeGiven != null ? transaction.changeGiven : null,
    standardVatTotal: transaction.standardVatTotal || 0,
    marginVatTotal: transaction.marginVatTotal || 0,
    termsText: TERMS_TEXT,
    secondHandTermsText: SECOND_HAND_TERMS_TEXT,
    hasSecondHandItems,
    qrCodeUrl: QR_CODE_URL,
    repairTcUrl: REPAIR_TC_URL,
  };

  return receipt;
}

module.exports = {
  generateReceipt,
  generateReceiptNumber,
  formatReceiptDate,
  DEFAULT_COMPANY_INFO,
  TERMS_TEXT,
  SECOND_HAND_TERMS_TEXT,
  QR_CODE_URL,
  REPAIR_TC_URL,
};
