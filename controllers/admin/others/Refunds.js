const Appointment = require('../../../models/Appointment');
const LabBooking = require('../../../models/LabBooking');
const NurseBooking = require('../../../models/NurseBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const AmbulanceBooking = require('../../../models/AmbulanceBooking'); // 👈 Imported
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
    'Ambulance': AmbulanceBooking // 👈 Added
};

// 1. GET: Fetch all active refund requests across all 5 models (Paginated)
// Endpoint: GET /api/admin/refunds
const getRefundInitiatedList = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const skip = (page - 1) * limit;

        const refundQuery = { paymentStatus: 'Refund-Initiated' };

        // Execute parallel queries across all collections for optimal performance
        const [doctorAndHospital, labs, nurses, pharmacies, ambulances] = await Promise.all([
            Appointment.find(refundQuery).populate('userId', 'name phone email').lean(),
            LabBooking.find(refundQuery).populate('userId', 'name phone email').lean(),
            NurseBooking.find(refundQuery).populate('userId', 'name phone email').lean(),
            PharmacyBooking.find(refundQuery).populate('userId', 'name phone email').lean(),
            AmbulanceBooking.find(refundQuery).populate('userId', 'name phone email').lean()
        ]);

        const unifiedList = [];

        // Map Doctor & Hospital Admissions
        doctorAndHospital.forEach(item => {
            const modelName = item.bookingType === 'Admission' ? 'Hospital' : 'Doctor';
            const penalty = item.pricingBreakdown?.cancellationFeeApplied || item.pricingBreakdown?.noShowFeeApplied || 0;
            const refundValue = item.cancellationDetails?.refundAmountCalculated || (item.totalAmount - penalty);

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: modelName,
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A"
                },
                paymentMethod: item.paymentMethod,
                totalPaid: item.totalAmount,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancellationDetails?.reason || item.cancelReason || "Late cancellation",
                createdAt: item.createdAt
            });
        });

        // Map Lab Bookings
        labs.forEach(item => {
            const penalty = item.billSummary?.cancellationFeeApplied || item.billSummary?.noShowFeeApplied || 0;
            const refundValue = (item.billSummary?.totalAmount || item.totalPrice || 0) - penalty;

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: 'Lab',
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A"
                },
                paymentMethod: item.paymentMethod,
                totalPaid: item.billSummary?.totalAmount || item.totalPrice || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancelReason || "Late cancellation",
                createdAt: item.createdAt
            });
        });

        // Map Nurse Bookings
        nurses.forEach(item => {
            const penalty = item.priceBreakdown?.cancellationFeeApplied || item.priceBreakdown?.noShowFeeApplied || 0;
            const refundValue = (item.priceBreakdown?.totalPrice || 0) - penalty;

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: 'Nurse',
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A"
                },
                paymentMethod: item.paymentMethod,
                totalPaid: item.priceBreakdown?.totalPrice || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancelReason || "Late cancellation",
                createdAt: item.createdAt
            });
        });

        // Map Pharmacy Bookings
        pharmacies.forEach(item => {
            const penalty = item.billSummary?.cancellationFeeApplied || item.billSummary?.noShowFeeApplied || 0;
            const refundValue = (item.billSummary?.totalAmount || 0) - penalty;

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.orderId,
                vendorModel: 'Pharmacy',
                customer: {
                    name: item.userId?.name || "Customer",
                    phone: item.userId?.phone || "N/A"
                },
                paymentMethod: item.paymentMethod,
                totalPaid: item.billSummary?.totalAmount || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancelReason || "Late cancellation",
                createdAt: item.createdAt
            });
        });

        // Map Ambulance Bookings
        ambulances.forEach(item => {
            const penalty = item.pricing?.cancellationFeeApplied || item.pricing?.noShowFeeApplied || 0;
            const refundValue = (item.pricing?.total || 0) - penalty;

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.bookingId,
                vendorModel: 'Ambulance',
                customer: {
                    name: item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A"
                },
                paymentMethod: item.paymentMethod,
                totalPaid: item.pricing?.total || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancellationReason || "Late cancellation",
                createdAt: item.createdAt
            });
        });

        // Sort unified array by latest date first
        unifiedList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Apply pagination offsets in memory
        const paginatedList = unifiedList.slice(skip, skip + limit);

        res.json({
            success: true,
            totalRecords: unifiedList.length,
            totalPages: Math.ceil(unifiedList.length / limit),
            currentPage: page,
            limit,
            data: paginatedList
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. POST: Execute refund for a booking (With Ambulance integration added)
// Endpoint: POST /api/admin/refunds/process
const processAdminRefund = async (req, res) => {
    try {
        const { bookingId, vendorModel } = req.body; // vendorModel: 'Doctor' | 'Hospital' | 'Lab' | 'Nurse' | 'Pharmacy' | 'Ambulance'

        const TargetModel = modelMap[vendorModel];
        if (!TargetModel) {
            return res.status(400).json({ success: false, message: "Invalid service model category." });
        }

        const booking = await TargetModel.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        if (booking.paymentStatus !== 'Refund-Initiated') {
            return res.status(400).json({ success: false, message: "This booking is not flagged for a refund." });
        }

        // Extract transaction tokens and calculated refund snapshots
        let paymentId = booking.paymentDetails?.razorpayPaymentId || booking.transactionId;
        let refundAmount = 0;

        if (vendorModel === 'Doctor' || vendorModel === 'Hospital') {
            refundAmount = booking.cancellationDetails?.refundAmountCalculated || 
                           (booking.totalAmount - (booking.pricingBreakdown?.noShowFeeApplied || 0));
        } else if (vendorModel === 'Nurse') {
            refundAmount = booking.priceBreakdown?.totalPrice - (booking.priceBreakdown?.cancellationFeeApplied || booking.priceBreakdown?.noShowFeeApplied || 0);
        } else if (vendorModel === 'Pharmacy') {
            refundAmount = booking.billSummary?.totalAmount - (booking.billSummary?.cancellationFeeApplied || booking.billSummary?.noShowFeeApplied || 0);
        } else if (vendorModel === 'Lab') {
            refundAmount = booking.billSummary?.totalAmount - (booking.billSummary?.cancellationFeeApplied || booking.billSummary?.noShowFeeApplied || 0);
        } else if (vendorModel === 'Ambulance') {
            refundAmount = booking.pricing?.total - (booking.pricing?.cancellationFeeApplied || booking.pricing?.noShowFeeApplied || 0);
        }

        if (refundAmount <= 0) {
            return res.status(400).json({ success: false, message: "Refund amount must be greater than 0." });
        }

        if (!paymentId || paymentId.startsWith('FREE-') || booking.paymentMethod === 'COD') {
            // For COD bookings or free subscription bookings, mark as resolved without calling Razorpay
            booking.paymentStatus = 'Refunded';
            await booking.save();
            return res.json({ success: true, message: "COD/Free booking marked as refunded locally." });
        }

        // Trigger Razorpay Payout Refund API
        const refundResponse = await refundRazorpayPayment(paymentId, refundAmount, booking.bookingId);

        // Update database status
        booking.paymentStatus = 'Refunded';
        
        // Save Razorpay refund ID reference
        if (booking.paymentDetails) {
            booking.paymentDetails.refundId = refundResponse.id;
        }

        await booking.save();

        res.json({
            success: true,
            message: `Successfully refunded ₹${refundAmount} to the patient!`,
            refundId: refundResponse.id,
            data: booking
        });

    } catch (error) {
        console.error("Refund Processing Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getRefundInitiatedList, processAdminRefund };