// utils/policyHelper.js
const CancellationConfig = require('../models/CancellationConfig');
const NoShowConfig = require('../models/NoShowConfig');
const AdminCommissionConfig = require('../models/AdminCommissionConfig');
const Wallet = require('../models/Wallet');
const CodConfig = require('../models/CodConfig');

/**
 * Checks if a driver or provider has started transit on a booking
 */
const hasDriverStarted = (booking, vendorType) => {
    switch (vendorType) {
        case 'Lab':
            return !!booking.startedAt || !['Pending', 'Confirmed', 'Under Review'].includes(booking.status);
        case 'Nurse':
            return !!booking.schedule?.startTime || !['Pending', 'Confirmed'].includes(booking.status);
        case 'Ambulance':
        case 'Ambulance-Accident':
        case 'Ambulance-Medical':
        case 'Ambulance-Referral':
            return ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'].includes(booking.status);
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
 * Calculates final cancellation deductions and driver compensations dynamically
 */
const processCancellationRefund = async (booking, vendorType) => {
    const isAccidental = (booking.serviceType === 'Accident emergency' || vendorType === 'Ambulance-Accident');
    const totalPaid = booking.totalAmount || 
                      booking.billSummary?.totalAmount || 
                      booking.priceBreakdown?.totalPrice || 
                      booking.pricing?.total || 
                      0;
    
    let cancellationFee = 0; 
    let driverCompensation = 0;
    const started = hasDriverStarted(booking, vendorType);

    if (started) {
        // Fetch specific config
        let config = await CancellationConfig.findOne({ vendorType, isActive: true });
        if (!config && String(vendorType).startsWith('Ambulance')) {
            config = await CancellationConfig.findOne({ vendorType: 'Ambulance', isActive: true });
        }

        if (config && config.chargeValue > 0) {
            if (config.chargeType === 'Percentage') {
                const baseValuation = isAccidental ? (booking.pricing?.originalAmbulanceCharge || 2000) : totalPaid;
                cancellationFee = Math.round((baseValuation * config.chargeValue) / 100);
            } else {
                cancellationFee = config.chargeValue;
            }
        }

        // Accidental me user se 0 charge hoga, par driver ko platform se fee jayegi
        if (isAccidental) {
            driverCompensation = cancellationFee > 0 ? cancellationFee : 200; // Default ₹200 platform compensation
            cancellationFee = 0; // Free for user
        } else {
            driverCompensation = cancellationFee;
        }
    }

    const refundAmount = Math.max(0, totalPaid - cancellationFee);

    return {
        hasStarted: started,
        cancellationFee,      // User se kitna deduct hua (Accidental me 0)
        driverCompensation,   // Driver ko kitna mila (Platform or User fee)
        refundAmount          // User ko kitna wapas milega
    };
};

/**
 * 💰 DYNAMIC ADMIN CUTOFF / COMMISSION CALCULATOR
 * Calculates Admin Platform Cutoff vs Net Vendor Earnings
 */
const calculateAdminCommission = async (vendorType, totalAmount) => {
    try {
        const amount = Number(totalAmount || 0);
        if (amount <= 0) return { adminCutoff: 0, netVendorAmount: 0 };

        const config = await AdminCommissionConfig.findOne({ vendorType, isActive: true });
        if (!config || config.commissionType === 'None') {
            return { adminCutoff: 0, netVendorAmount: amount };
        }

        let adminCutoff = 0;

        if (config.commissionType === 'Percentage') {
            adminCutoff = (amount * (config.percentageValue || 0)) / 100;
        } else if (config.commissionType === 'Rupees') {
            adminCutoff = Math.min(config.fixedRupeesValue || 0, amount);
        } else if (config.commissionType === 'Both') {
            const percentPart = (amount * (config.percentageValue || 0)) / 100;
            const fixedPart = config.fixedRupeesValue || 0;
            adminCutoff = Math.min(percentPart + fixedPart, amount);
        }

        adminCutoff = Math.round(adminCutoff);
        const netVendorAmount = Math.max(0, amount - adminCutoff);

        return {
            adminCutoff,
            netVendorAmount,
            commissionType: config.commissionType,
            percentageValue: config.percentageValue,
            fixedRupeesValue: config.fixedRupeesValue
        };

    } catch (error) {
        console.error("Admin Commission Calculation Error:", error);
        return { adminCutoff: 0, netVendorAmount: totalAmount };
    }
};

/**
 * Atomic helper to credit compensation to vendor wallet
 */
const creditVendorCompensation = async (vendorId, vendorModel, amount, bookingId, type) => {
    try {
        if (!amount || amount <= 0) return;

        const transaction = {
            type: 'Credit',
            amount: amount,
            remark: `${type} - Booking #${bookingId}`,
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
        
        console.log(`[Wallet Sync]: Credited ₹${amount} (${type}) to ${vendorModel}: ${vendorId}`);
    } catch (error) {
        console.error("Error crediting vendor compensation:", error);
    }
};

const isCodEnabled = async (vendorType) => {
    try {
        const config = await CodConfig.findOne({ vendorType });
        return config ? config.isCodAvailable : true;
    } catch (error) {
        return true;
    }
};

module.exports = { 
    hasDriverStarted, 
    processCancellationRefund, 
    calculateAdminCommission, // 👈 New Export
    creditVendorCompensation, 
    isCodEnabled 
};