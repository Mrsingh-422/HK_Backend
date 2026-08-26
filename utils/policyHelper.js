// utils/policyHelper.js (PHARMACY CANCELLATION & BILLSUMMARY COMPATIBLE)
const CancellationConfig = require('../models/CancellationConfig');
const NoShowConfig = require('../models/NoShowConfig');
const Wallet = require('../models/Wallet');
const CodConfig = require('../models/CodConfig');

/**
 * Checks if a driver or provider has started transit on a booking
 * @param {Object} booking - The Mongoose booking document
 * @param {String} vendorType - 'Lab' | 'Pharmacy' | 'Nurse' | 'Hospital' | 'Doctor' | 'Ambulance'
 * @returns {Boolean} - True if trip transit has started
 */
const hasDriverStarted = (booking, vendorType) => {
    switch (vendorType) {
        case 'Lab':
            return !!booking.startedAt || !['Pending', 'Confirmed', 'Under Review'].includes(booking.status);
        case 'Nurse':
            return !!booking.schedule?.startTime || !['Pending', 'Confirmed'].includes(booking.status);
        case 'Ambulance':
            return ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'].includes(booking.status);
        // 🚨 1. FIXED: Pharmacy transit check based on real PharmacyBooking deliveryStatus
        case 'Pharmacy':
            return !!booking.startedAt || ['PickedUp', 'OutForDelivery', 'ReachedLocation'].includes(booking.deliveryStatus);
        case 'Doctor':
            if (booking.consultationType === 'Home Visit') {
                return !!booking.tracking?.startedAt || booking.status === 'In-Progress';
            }
            return booking.status === 'In-Progress';
        case 'Hospital':
            return booking.status === 'In-Progress';
        default:
            return false;
    }
};

/**
 * Calculates final cancellation deductions and payable refunds dynamically
 * @param {Object} booking - The Mongoose booking document
 * @param {String} vendorType - 'Lab' | 'Pharmacy' | 'Nurse' | 'Hospital' | 'Doctor' | 'Ambulance'
 * @returns {Object} - { hasStarted, cancellationFee, refundAmount }
 */
const processCancellationRefund = async (booking, vendorType) => {
    // 🚨 2. FIXED: Injected booking.billSummary?.totalAmount for Pharmacy & Lab Bookings
    const totalPaid = booking.totalAmount || 
                      booking.billSummary?.totalAmount || 
                      booking.priceBreakdown?.totalPrice || 
                      booking.pricing?.total || 
                      0;
    
    let cancellationFee = 0; 
    const started = hasDriverStarted(booking, vendorType);

    if (started) {
        const config = await CancellationConfig.findOne({ vendorType, isActive: true });
        
        if (config && config.chargeValue > 0) {
            if (config.chargeType === 'Percentage') {
                cancellationFee = Math.round((totalPaid * config.chargeValue) / 100);
            } else {
                cancellationFee = Math.min(config.chargeValue, totalPaid); // Cap flat fee to avoid negative balances
            }
        }
    }

    const refundAmount = Math.max(0, totalPaid - cancellationFee);

    return {
        hasStarted: started,
        cancellationFee,
        refundAmount
    };
};

/**
 * Atomic helper to credit cancellation or no-show compensation to a vendor's wallet
 * @param {String} vendorId - Doctor, Lab, Pharmacy, Nurse, Hospital, or Ambulance _id
 * @param {String} vendorModel - 'Doctor' | 'Lab' | 'Pharmacy' | 'Nurse' | 'Hospital' | 'Ambulance'
 * @param {Number} amount - The penalty fee collected from the patient as compensation
 * @param {String} bookingId - The custom tracking order/booking ID
 * @param {String} type - 'Cancellation Fee' | 'No-Show Fee'
 */
const creditVendorCompensation = async (vendorId, vendorModel, amount, bookingId, type) => {
    try {
        if (!amount || amount <= 0) return;

        const transaction = {
            type: 'Credit',
            amount: amount,
            remark: `${type} Compensation - Booking #${bookingId}`,
            orderId: bookingId,
            date: new Date()
        };

        await Wallet.findOneAndUpdate(
            { vendorId, vendorModel },
            {
                $inc: { balance: amount },
                $push: { transactions: transaction }
            },
            { upsert: true, new: true, runValidators: false }
        );
        
        console.log(`[Wallet Sync]: Credited ₹${amount} ${type} compensation to ${vendorModel}: ${vendorId}`);
    } catch (error) {
        console.error("Error crediting vendor compensation:", error);
    }
};

/**
 * Checks if Cash on Delivery (COD) is enabled for a specific service type
 * @param {String} vendorType - 'Lab' | 'Pharmacy' | 'Nurse' | 'Hospital' | 'Doctor' | 'Ambulance'
 * @returns {Boolean} - True if COD is enabled, false if disabled
 */
const isCodEnabled = async (vendorType) => {
    try {
        const config = await CodConfig.findOne({ vendorType });
        return config ? config.isCodAvailable : true;
    } catch (error) {
        console.error(`Error checking COD availability for ${vendorType}:`, error);
        return true;
    }
};

module.exports = { 
    hasDriverStarted, 
    processCancellationRefund, 
    creditVendorCompensation, 
    isCodEnabled 
};