// controllers/admin/others/Refunds.js (PHARMACY RETURN & CANCELLATION COMPATIBLE)
const Appointment = require('../../../models/Appointment');
const LabBooking = require('../../../models/LabBooking');
const NurseBooking = require('../../../models/NurseBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const AmbulanceBooking = require('../../../models/AmbulanceBooking');
const { refundRazorpayPayment } = require('../../../utils/razorpay');
const moment = require('moment');
const mongoose = require('mongoose');

// Helper mapping to resolve different service collections dynamically
const modelMap = {
    'Doctor': Appointment,
    'Hospital': Appointment,
    'Lab': LabBooking,
    'Nurse': NurseBooking,
    'Pharmacy': PharmacyBooking,
    'Ambulance': AmbulanceBooking
};

// @desc    Fetch all active/completed refund requests across all models (Correctly classifies Hospital OPD under Hospital)
// @route   GET /api/admin/refunds
// @access  Private (Admin)
const getRefundInitiatedList = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const skip = (page - 1) * limit;

        const targetStatus = req.query.status || 'Refund-Initiated';
        const refundQuery = { paymentStatus: targetStatus };

        const [doctorAndHospital, labs, nurses, pharmacies, ambulances] = await Promise.all([
            Appointment.find(refundQuery).populate('userId', 'name phone email').lean(),
            LabBooking.find(refundQuery).populate('userId', 'name phone email').lean(),
            NurseBooking.find(refundQuery).populate('userId', 'name phone email').lean(),
            PharmacyBooking.find(refundQuery).populate('userId', 'name phone email').populate('pharmacyId', 'name city').lean(),
            AmbulanceBooking.find(refundQuery).populate('userId', 'name phone email').lean()
        ]);

        const unifiedList = [];

        // 1. Map Doctor & Hospital (Includes both IPD Admission & OPD under Hospital)
        doctorAndHospital.forEach(item => {
            const modelName = (item.hospitalId || item.bookingType === 'Admission' || item.bookingType === 'OPD') 
                ? 'Hospital' 
                : 'Doctor';
            const penalty = item.pricingBreakdown?.cancellationFeeApplied || item.pricingBreakdown?.noShowFeeApplied || 0;
            const refundValue = item.cancellationDetails?.refundAmountCalculated || ((item.totalAmount || 0) - penalty);

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: modelName,
                bookingSubType: item.bookingType || 'Appointment',
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A",
                    email: item.userId?.email || "N/A"
                },
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
                refundId: item.paymentDetails?.refundId || "Local/Manual",
                totalPaid: item.totalAmount || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancellationDetails?.reason || item.cancelReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt,
                processedAt: item.updatedAt
            });
        });

        // 2. Map Labs
        labs.forEach(item => {
            const penalty = item.billSummary?.cancellationFeeApplied || item.billSummary?.noShowFeeApplied || 0;
            const refundValue = (item.billSummary?.totalAmount || item.totalPrice || 0) - penalty;

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: 'Lab',
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A",
                    email: item.userId?.email || "N/A"
                },
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
                refundId: item.paymentDetails?.refundId || "Local/Manual",
                totalPaid: item.billSummary?.totalAmount || item.totalPrice || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancelReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt,
                processedAt: item.updatedAt
            });
        });

        // 3. Map Nurses
        nurses.forEach(item => {
            const penalty = item.priceBreakdown?.cancellationFeeApplied || item.priceBreakdown?.noShowFeeApplied || 0;
            const refundValue = (item.priceBreakdown?.totalPrice || 0) - penalty;

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: 'Nurse',
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A",
                    email: item.userId?.email || "N/A"
                },
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
                refundId: item.paymentDetails?.refundId || "Local/Manual",
                totalPaid: item.priceBreakdown?.totalPrice || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancelReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt,
                processedAt: item.updatedAt
            });
        });

        // 4. Map Pharmacy
        pharmacies.forEach(item => {
            const isReturn = item.returnDetails && item.returnDetails.status === 'Completed';
            const penalty = item.billSummary?.cancellationFeeApplied || item.billSummary?.noShowFeeApplied || 0;
            
            let refundValue = (item.billSummary?.totalAmount || 0) - penalty;
            let refundReason = item.cancelReason || "Order cancellation";

            if (isReturn) {
                refundValue = item.returnDetails.refundAmount || item.billSummary?.totalAmount || 0;
                refundReason = `Product Return: ${item.returnDetails.reason}`;
            }

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.orderId,
                vendorModel: 'Pharmacy',
                pharmacyName: item.pharmacyId?.name || "Store",
                customer: {
                    name: item.userId?.name || item.address?.name || "Customer",
                    phone: item.userId?.phone || item.address?.phone || "N/A",
                    email: item.userId?.email || "N/A"
                },
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
                refundId: item.paymentDetails?.refundId || "Local/Manual",
                totalPaid: item.billSummary?.totalAmount || 0,
                penaltyApplied: isReturn ? 0 : penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: refundReason,
                refundType: isReturn ? "Product Return" : "Order Cancellation",
                createdAt: item.createdAt,
                processedAt: item.updatedAt
            });
        });

        // 5. Map Ambulances
        ambulances.forEach(item => {
            const penalty = item.pricing?.cancellationFeeApplied || item.pricing?.noShowFeeApplied || 0;
            const refundValue = (item.pricing?.total || 0) - penalty;

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: 'Ambulance',
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A",
                    email: item.userId?.email || "N/A"
                },
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
                refundId: item.paymentDetails?.refundId || "Local/Manual",
                totalPaid: item.pricing?.total || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancellationReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt,
                processedAt: item.updatedAt
            });
        });

        unifiedList.sort((a, b) => new Date(b.processedAt || b.createdAt) - new Date(a.processedAt || a.createdAt));

        const paginatedList = unifiedList.slice(skip, skip + limit);

        return res.status(200).json({
            success: true,
            totalRecords: unifiedList.length,
            totalPages: Math.ceil(unifiedList.length / limit),
            currentPage: page,
            limit,
            data: paginatedList
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Execute refund for a booking (Supports Hospital Early-Discharge Refunds + Cancellation Refunds)
// @route   POST /api/admin/refunds/process
// @access  Private (Admin)
const processAdminRefund = async (req, res) => {
    try {
        const { bookingId, vendorModel } = req.body; 

        if (!bookingId || !vendorModel) {
            return res.status(400).json({ success: false, message: "bookingId and vendorModel are required." });
        }

        const TargetModel = modelMap[vendorModel];
        if (!TargetModel) {
            return res.status(400).json({ success: false, message: "Invalid service model category." });
        }

        const isObjectId = mongoose.Types.ObjectId.isValid(bookingId);
        const searchConditions = [];

        if (isObjectId) {
            searchConditions.push({ _id: bookingId });
        }
        searchConditions.push({ orderId: bookingId });
        searchConditions.push({ bookingId: bookingId });

        const booking = await TargetModel.findOne({ $or: searchConditions });

        if (!booking) {
            return res.status(404).json({ success: false, message: `Booking record not found for identifier: '${bookingId}'` });
        }

        if (booking.paymentStatus !== 'Refund-Initiated') {
            return res.status(400).json({ 
                success: false, 
                message: `This booking is not flagged for refund. Current payment status is '${booking.paymentStatus}'.` 
            });
        }

        let paymentId = booking.paymentDetails?.razorpayPaymentId || booking.transactionId;
        let refundAmount = 0;

        if (vendorModel === 'Doctor' || vendorModel === 'Hospital') {
            // Check 1: Is this an Early-Discharge IPD Refund?
            const earlyDischargeRefund = Number(
                booking.pricingBreakdown?.unusedDaysRefund || 
                booking.pricingBreakdown?.refundDueToUser || 
                0
            );

            if (earlyDischargeRefund > 0) {
                refundAmount = earlyDischargeRefund;
            } else if (booking.cancellationDetails?.refundAmountCalculated !== undefined && booking.cancellationDetails.refundAmountCalculated > 0) {
                refundAmount = Number(booking.cancellationDetails.refundAmountCalculated);
            } else {
                const penalty = Number(booking.pricingBreakdown?.cancellationFeeApplied || 0) + Number(booking.pricingBreakdown?.noShowFeeApplied || 0);
                refundAmount = Math.max(0, Number(booking.totalAmount || 0) - penalty);
            }
        } else if (vendorModel === 'Nurse') {
            const penalty = (booking.priceBreakdown?.cancellationFeeApplied || 0) + (booking.priceBreakdown?.noShowFeeApplied || 0);
            refundAmount = (booking.priceBreakdown?.totalPrice || 0) - penalty;
        } else if (vendorModel === 'Pharmacy') {
            if (booking.returnDetails && (booking.returnDetails.status === 'Approved' || booking.returnDetails.status === 'Completed')) {
                refundAmount = booking.returnDetails.refundAmount || booking.billSummary?.totalAmount || 0;
            } else {
                const penalty = (booking.billSummary?.cancellationFeeApplied || 0) + (booking.billSummary?.noShowFeeApplied || 0);
                refundAmount = (booking.billSummary?.totalAmount || 0) - penalty;
            }
        } else if (vendorModel === 'Lab') {
            const penalty = (booking.billSummary?.cancellationFeeApplied || 0) + (booking.billSummary?.noShowFeeApplied || 0);
            refundAmount = (booking.billSummary?.totalAmount || 0) - penalty;
        } else if (vendorModel === 'Ambulance') {
            const penalty = (booking.pricing?.cancellationFeeApplied || 0) + (booking.pricing?.noShowFeeApplied || 0);
            refundAmount = (booking.pricing?.total || 0) - penalty;
        }

        if (refundAmount <= 0) {
            return res.status(400).json({ success: false, message: "Refund amount must be greater than 0." });
        }

        // For COD, Counter Cash, or Free subscription bookings
        const isOfflineOrFree = !paymentId || 
                                paymentId.startsWith('FREE-') || 
                                paymentId.startsWith('COUNTER-') || 
                                booking.paymentMethod === 'COD' || 
                                booking.paymentMethod === 'Cash';

        if (isOfflineOrFree) {
            booking.paymentStatus = 'Refunded';
            if (booking.pricingBreakdown?.settlementStatus === 'Refund-Initiated') {
                booking.pricingBreakdown.settlementStatus = 'Refunded';
            }
            if (booking.returnDetails && booking.returnDetails.status === 'Approved') {
                booking.returnDetails.status = 'Completed';
            }
            await booking.save();
            return res.status(200).json({ 
                success: true, 
                message: "Counter/COD/Free booking marked as refunded locally.",
                data: booking
            });
        }

        // Trigger Razorpay Refund
        const trackingReference = booking.orderId || booking.bookingId || booking._id.toString();
        const refundResponse = await refundRazorpayPayment(paymentId, refundAmount, trackingReference);

        booking.paymentStatus = 'Refunded';
        if (booking.pricingBreakdown?.settlementStatus === 'Refund-Initiated') {
            booking.pricingBreakdown.settlementStatus = 'Refunded';
        }
        
        if (booking.returnDetails && booking.returnDetails.status === 'Approved') {
            booking.returnDetails.status = 'Completed';
        }

        if (booking.paymentDetails) {
            booking.paymentDetails.refundId = refundResponse.id;
        }

        await booking.save();

        return res.status(200).json({
            success: true,
            message: `Successfully refunded ₹${refundAmount} to the patient!`,
            refundId: refundResponse.id,
            data: booking
        });

    } catch (error) {
        console.error("Refund Processing Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getRefundInitiatedList, processAdminRefund };