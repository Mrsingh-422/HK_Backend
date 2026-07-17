// utils/policyHelper.js
const CancellationConfig = require('../models/CancellationConfig');
const NoShowConfig = require('../models/NoShowConfig');
const Wallet = require('../models/Wallet');


/**
 * Checks if a driver or provider has started transit on a booking
 * @param {Object} booking - The Mongoose booking document
 * @param {String} vendorType - 'Lab' | 'Pharmacy' | 'Nurse' | 'Hospital' | 'Doctor' | 'Ambulance'
 * @returns {Boolean} - True if trip transit has started
 */
const hasDriverStarted = (booking, vendorType) => {
    switch (vendorType) {
        case 'Lab':
            // Driver is active if startedAt timestamp exists or status is beyond Confirmed
            return !!booking.startedAt || !['Pending', 'Confirmed', 'Under Review'].includes(booking.status);
        case 'Nurse':
            // Checks if dynamic start timestamp is active or transition progress has begun
            return !!booking.schedule?.startTime || !['Pending', 'Confirmed'].includes(booking.status);
        case 'Ambulance':
            // Trip starts when driver has accepted, arrived, or is en-route
            return ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'].includes(booking.status);
        case 'Pharmacy':
            // If home delivery has been initiated by the designated courier
            return !['Pending', 'Confirmed', 'Preparing'].includes(booking.status);
        case 'Doctor':
            // For home-visit consultations: checks if the doctor's OTP tracking has started
            if (booking.consultationType === 'Home Visit') {
                return !!booking.tracking?.startedAt || booking.status === 'In-Progress';
            }
            return booking.status === 'In-Progress';
        case 'Hospital':
            // Admitted cases are active once checked-in
            return booking.status === 'In-Progress';
        default:
            return false;
    }
};

/**
 * Calculates final cancellation deductions and payable refunds dynamically
 * @param {Object} booking - The Mongoose booking document
 * @param {String} vendorType - 'Lab' | 'Pharmacy' | 'Nurse' | 'Hospital' | 'Doctor' | 'Ambulance'
 * @returns {Object} - { cancellationFee, refundAmount }
 */
const processCancellationRefund = async (booking, vendorType) => {
    const totalPaid = booking.totalAmount || booking.priceBreakdown?.totalPrice || booking.pricing?.total || 0;
    
    // Default fallback: 0 charge (Free cancellation)
    let cancellationFee = 0; 

    // 1. Condition Check: Has transit started?
    const started = hasDriverStarted(booking, vendorType);

    if (started) {
        // Fetch active admin configurations for this entity
        const config = await CancellationConfig.findOne({ vendorType, isActive: true });
        
        if (config && config.chargeValue > 0) {
            if (config.chargeType === 'Percentage') {
                cancellationFee = Math.round((totalPaid * config.chargeValue) / 100);
            } else {
                cancellationFee = Math.min(config.chargeValue, totalPaid); // Cap flat fee to avoid negative refund balances
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

        // Use findOneAndUpdate with upsert to prevent document version conflicts
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

module.exports = { hasDriverStarted, processCancellationRefund, creditVendorCompensation };