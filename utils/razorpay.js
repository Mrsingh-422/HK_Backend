// utils/razorpay.js
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Reusable function to create Razorpay Order
const createRazorpayOrder = async (amountInRupees, receiptId) => {
    try {
        const options = {
            amount: Math.round(amountInRupees * 100), // in paise
            currency: "INR",
            receipt: receiptId,
        };
        const order = await razorpayInstance.orders.create(options);
        return order;
    } catch (error) {
        console.error("Razorpay Order Creation Error:", error);
        throw error;
    }
};

// Reusable function to verify payment signature securely
const verifyRazorpaySignature = (razorpayOrderId, razorpayPaymentId, razorpaySignature) => {
    try {
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        const hmac = crypto.createHmac('sha256', keySecret);
        hmac.update(razorpayOrderId + "|" + razorpayPaymentId);
        const generatedSignature = hmac.digest('hex');
        
        return generatedSignature === razorpaySignature;
    } catch (error) {
        console.error("Signature Verification Error:", error);
        return false;
    }
};

/**
 * 🚨 NEW HELPER: Fetch authentic transaction details directly from Razorpay APIs [1]
 */
const fetchAndMapRazorpayPayment = async (paymentId, signature) => {
    try {
        // Fetch raw payment data from Razorpay Server
        const rzpPayment = await razorpayInstance.payments.fetch(paymentId);
        if (!rzpPayment) return null;

        // Map to our database paymentDetails schema format
        return {
            razorpayPaymentId: rzpPayment.id,
            razorpayOrderId: rzpPayment.order_id,
            razorpaySignature: signature,
            method: rzpPayment.method, // upi, card, netbanking, wallet
            amount: Number(rzpPayment.amount / 100), // convert paise to Rupees
            currency: rzpPayment.currency || "INR",
            status: rzpPayment.status,
            bank: rzpPayment.bank || "",
            wallet: rzpPayment.wallet || "",
            vpa: rzpPayment.vpa || "",
            cardDetails: rzpPayment.card ? {
                last4: rzpPayment.card.last4,
                network: rzpPayment.card.network,
                type: rzpPayment.card.type
            } : undefined,
            paidAt: rzpPayment.created_at ? new Date(rzpPayment.created_at * 1000) : new Date()
        };
    } catch (error) {
        console.error("Error fetching payment details from Razorpay:", error);
        return null;
    }
};

const refundRazorpayPayment = async (paymentId, amountInRupees, bookingId) => {
    try {
        const refund = await razorpayInstance.payments.refund(paymentId, {
            amount: Math.round(amountInRupees * 100), // Convert Rupees to paise
            speed: "normal", // 'normal' | 'instant'
            notes: {
                bookingId: bookingId,
                reason: "Automated booking cancellation/no-show refund."
            }
        });
        return refund;
    } catch (error) {
        console.error("Razorpay Payout Refund Failure:", error);
        throw error;
    }
};

module.exports = {
    createRazorpayOrder,
    verifyRazorpaySignature,
    fetchAndMapRazorpayPayment, // 👈 Export Added
    razorpayInstance,
    refundRazorpayPayment
};