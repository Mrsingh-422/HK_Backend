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
            PharmacyBooking.find(refundQuery).populate('userId', 'name phone email').populate('pharmacyId', 'name city').lean(),
            AmbulanceBooking.find(refundQuery).populate('userId', 'name phone email').lean()
        ]);

        const unifiedList = [];

        // 1. Map Doctor & Hospital Admissions
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
                    phone: item.userId?.phone || "N/A",
                    email: item.userId?.email || "N/A"
                },
                paymentMethod: item.paymentMethod,
                totalPaid: item.totalAmount,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancellationDetails?.reason || item.cancelReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt
            });
        });

        // 2. Map Lab Bookings
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
                totalPaid: item.billSummary?.totalAmount || item.totalPrice || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancelReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt
            });
        });

        // 3. Map Nurse Bookings
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
                totalPaid: item.priceBreakdown?.totalPrice || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancelReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt
            });
        });

        // 🚨 4. Map Pharmacy Bookings (Supports both Order Cancellation & Product Return)
        pharmacies.forEach(item => {
            const isReturn = item.returnDetails && item.returnDetails.status === 'Approved';
            const penalty = item.billSummary?.cancellationFeeApplied || item.billSummary?.noShowFeeApplied || 0;
            
            // Refund calculation
            let refundValue = (item.billSummary?.totalAmount || 0) - penalty;
            let refundReason = item.cancelReason || "Order cancellation";

            if (isReturn) {
                refundValue = item.returnDetails.refundAmount || item.billSummary?.totalAmount || 0;
                refundReason = `Product Return Approved: ${item.returnDetails.reason}`;
            }

            unifiedList.push({
                bookingMongoId: item._id,
                bookingId: item.orderId, // 👈 Correct Pharmacy Order ID
                vendorModel: 'Pharmacy',
                pharmacyName: item.pharmacyId?.name || "Store",
                customer: {
                    name: item.userId?.name || item.address?.name || "Customer",
                    phone: item.userId?.phone || item.address?.phone || "N/A",
                    email: item.userId?.email || "N/A"
                },
                paymentMethod: item.paymentMethod,
                totalPaid: item.billSummary?.totalAmount || 0,
                penaltyApplied: isReturn ? 0 : penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: refundReason,
                refundType: isReturn ? "Product Return" : "Order Cancellation", // 👈 Distinct badge for Admin
                createdAt: item.createdAt
            });
        });

        // 5. Map Ambulance Bookings
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
                totalPaid: item.pricing?.total || 0,
                penaltyApplied: penalty,
                refundAmountCalculated: Math.max(0, refundValue),
                reason: item.cancellationReason || "Late cancellation",
                refundType: "Cancellation",
                createdAt: item.createdAt
            });
        });

        // Sort by latest date first
        unifiedList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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

// 2. POST: Execute refund for a booking (With Pharmacy Return & Identifier Fix)
// Endpoint: POST /api/admin/refunds/process
const processAdminRefund = async (req, res) => {
    try {
        const { bookingId, vendorModel } = req.body; 

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

        let paymentId = booking.paymentDetails?.razorpayPaymentId || booking.transactionId;
        let refundAmount = 0;

        if (vendorModel === 'Doctor' || vendorModel === 'Hospital') {
            refundAmount = booking.cancellationDetails?.refundAmountCalculated || 
                           (booking.totalAmount - (booking.pricingBreakdown?.noShowFeeApplied || 0));
        } else if (vendorModel === 'Nurse') {
            refundAmount = booking.priceBreakdown?.totalPrice - (booking.priceBreakdown?.cancellationFeeApplied || booking.priceBreakdown?.noShowFeeApplied || 0);
        } else if (vendorModel === 'Pharmacy') {
            // 🚨 Check if it's a product return or cancellation
            if (booking.returnDetails && booking.returnDetails.status === 'Approved') {
                refundAmount = booking.returnDetails.refundAmount || booking.billSummary?.totalAmount || 0;
            } else {
                refundAmount = booking.billSummary?.totalAmount - (booking.billSummary?.cancellationFeeApplied || booking.billSummary?.noShowFeeApplied || 0);
            }
        } else if (vendorModel === 'Lab') {
            refundAmount = booking.billSummary?.totalAmount - (booking.billSummary?.cancellationFeeApplied || booking.billSummary?.noShowFeeApplied || 0);
        } else if (vendorModel === 'Ambulance') {
            refundAmount = booking.pricing?.total - (booking.pricing?.cancellationFeeApplied || booking.pricing?.noShowFeeApplied || 0);
        }

        if (refundAmount <= 0) {
            return res.status(400).json({ success: false, message: "Refund amount must be greater than 0." });
        }

        // For COD or Free bookings
        if (!paymentId || paymentId.startsWith('FREE-') || booking.paymentMethod === 'COD') {
            booking.paymentStatus = 'Refunded';
            if (booking.returnDetails && booking.returnDetails.status === 'Approved') {
                booking.returnDetails.status = 'Completed';
            }
            await booking.save();
            return res.json({ success: true, message: "COD/Free booking marked as refunded locally." });
        }

        // 🚨 FIXED: Passes either booking.orderId (Pharmacy) or booking.bookingId
        const trackingReference = booking.orderId || booking.bookingId;
        const refundResponse = await refundRazorpayPayment(paymentId, refundAmount, trackingReference);

        booking.paymentStatus = 'Refunded';
        
        if (booking.returnDetails && booking.returnDetails.status === 'Approved') {
            booking.returnDetails.status = 'Completed';
        }

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