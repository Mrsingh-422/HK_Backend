// utils/razorpay.js (DEVELOPMENT & PRODUCTION AWARE)
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID || "rzp_test_placeholder",
    key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET || "secret_placeholder",
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
        const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;
        const hmac = crypto.createHmac('sha256', keySecret);
        hmac.update(razorpayOrderId + "|" + razorpayPaymentId);
        const generatedSignature = hmac.digest('hex');
        
        return generatedSignature === razorpaySignature;
    } catch (error) {
        console.error("Signature Verification Error:", error);
        return false;
    }
};

const fetchAndMapRazorpayPayment = async (paymentId, signature) => {
    try {
        const rzpPayment = await razorpayInstance.payments.fetch(paymentId);
        if (!rzpPayment) return null;

        return {
            razorpayPaymentId: rzpPayment.id,
            razorpayOrderId: rzpPayment.order_id,
            razorpaySignature: signature,
            method: rzpPayment.method,
            amount: Number(rzpPayment.amount / 100),
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

// 🚨 ENVIRONMENT-AWARE REFUND ENGINE (Dev Sandbox vs Live Production)
const refundRazorpayPayment = async (paymentId, amountInRupees, bookingId) => {
    const isDevelopment = process.env.NODE_ENV === 'development';

    try {
        // 1. Try triggering actual Razorpay Gateway API (Works for valid test/live IDs)
        const refund = await razorpayInstance.payments.refund(paymentId, {
            amount: Math.round(amountInRupees * 100), // Convert Rupees to paise
            speed: "normal",
            notes: {
                bookingId: String(bookingId),
                reason: "Automated booking cancellation/product return refund."
            }
        });
        return refund;

    } catch (error) {
        // 2. In Development Mode: If test gateway rejects fake/already-refunded test ID, return Simulated Sandbox Success
        if (isDevelopment) {
            console.warn(`\x1b[33m[Razorpay DEV Sandbox]: Test gateway payout failed (${error.message}). Executing simulated test refund for smooth testing.\x1b[0m`);
            return {
                id: `rfnd_test_${Date.now()}`,
                entity: "refund",
                amount: Math.round(amountInRupees * 100),
                currency: "INR",
                payment_id: paymentId,
                status: "processed",
                speed_processed: "normal",
                created_at: Math.floor(Date.now() / 1000),
                note: "Simulated Development Refund"
            };
        }

        // 3. In Production Mode: Throw strict error
        console.error("Razorpay Payout Refund Failure in Production:", error);
        throw error;
    }
};

module.exports = {
    createRazorpayOrder,
    verifyRazorpaySignature,
    fetchAndMapRazorpayPayment,
    razorpayInstance,
    refundRazorpayPayment
};