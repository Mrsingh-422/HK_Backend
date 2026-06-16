// utils/razorpay.js
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * 1. Reusable function to create Razorpay Order (Backend Side)
 * @param {Number} amountInRupees - Pay amount in Rupees (e.g. 500)
 * @param {String} receiptId - Unique custom id (e.g. "receipt_book_12345")
 */
const createRazorpayOrder = async (amountInRupees, receiptId) => {
    try {
        const options = {
            amount: Math.round(amountInRupees * 100), // Razorpay expects amount in paise (1 INR = 100 paise)
            currency: "INR",
            receipt: receiptId,
        };

        const order = await razorpayInstance.orders.create(options);
        return order; // Returns { id: 'order_9A33X...', amount: 50000, ... }
    } catch (error) {
        console.error("Razorpay Order Creation Helper Error:", error);
        throw error;
    }
};

/**
 * 2. Reusable function to verify payment signature securely (Anti-fraud check)
 */
const verifyRazorpaySignature = (razorpayOrderId, razorpayPaymentId, razorpaySignature) => {
    try {
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        const hmac = crypto.createHmac('sha256', keySecret);
        hmac.update(razorpayOrderId + "|" + razorpayPaymentId);
        const generatedSignature = hmac.digest('hex');
        
        return generatedSignature === razorpaySignature;
    } catch (error) {
        console.error("Signature Verification Helper Error:", error);
        return false;
    }
};

module.exports = {
    createRazorpayOrder,
    verifyRazorpaySignature,
    razorpayInstance
};