const NursingPrescriptionRequest = require('../../../models/NursingPrescriptionRequest');
const NurseBooking = require('../../../models/NurseBooking');
const Nurse = require('../../../models/Nurse');
const mongoose = require('mongoose');
const moment = require('moment');
const { sendPushNotification } = require('../../../utils/notification'); 

// @desc    Get Active Broadcasted Prescription Requests for Nurse Bureau (With Pagination)
// @route   GET /provider/nurse/prescription/requests
// @access  Private (Nurse Bureau)
const getIncomingPrescriptionRequests = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { page = 1, limit = 10 } = req.query;
        const now = new Date();

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        const query = {
            status: 'Broadcasted',
            expiresAt: { $gt: now },
            "candidateNurses": {
                $elemMatch: {
                    nurseId: nurseId,
                    status: 'Pending'
                }
            }
        };

        const [totalItems, requests] = await Promise.all([
            NursingPrescriptionRequest.countDocuments(query),
            NursingPrescriptionRequest.find(query)
                .populate('userId', 'name gender age profilePic')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        res.status(200).json({
            success: true,
            count: requests.length,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            data: requests
        });

    } catch (error) {
        console.error("Get Incoming Prescription Requests Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Submit Proposal / Generate Prescription Bill for Patient (Crash-Proof with Dynamic Key Fallback)
// @route   POST /provider/nurse/prescription/respond
// @access  Private (Nurse Bureau)
const submitProposal = async (req, res) => {
    try {
        const nurseId = req.user.id || req.user._id;
        let { requestId, id, _id, servicesPricing, consumablesUsed, taxAmount } = req.body;

        // 1. Resolve Request ID safely (Accepts 'requestId', 'id', or '_id' from frontend)
        const targetRequestId = String(requestId || id || _id || "").trim();

        if (!targetRequestId || !mongoose.isValidObjectId(targetRequestId)) {
            return res.status(400).json({ 
                success: false, 
                message: "A valid 24-character hexadecimal MongoDB ID is required for 'requestId'." 
            });
        }

        // 2. Safe Parser for servicesPricing (Handles Array, stringified JSON, or single Object)
        let parsedServices = [];
        if (typeof servicesPricing === 'string') {
            try { parsedServices = JSON.parse(servicesPricing); } catch (e) { parsedServices = []; }
        } else if (Array.isArray(servicesPricing)) {
            parsedServices = servicesPricing;
        } else if (servicesPricing && typeof servicesPricing === 'object') {
            parsedServices = [servicesPricing];
        }

        if (parsedServices.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "servicesPricing array is required with at least one service item." 
            });
        }

        // 3. Safe Parser for consumablesUsed
        let parsedConsumables = [];
        if (typeof consumablesUsed === 'string') {
            try { parsedConsumables = JSON.parse(consumablesUsed); } catch (e) { parsedConsumables = []; }
        } else if (Array.isArray(consumablesUsed)) {
            parsedConsumables = consumablesUsed;
        }

        // 4. Fetch the target prescription request
        const request = await NursingPrescriptionRequest.findById(targetRequestId);
        if (!request) {
            return res.status(404).json({ 
                success: false, 
                message: "Prescription request not found." 
            });
        }

        if (request.status !== 'Broadcasted' || new Date() > request.expiresAt) {
            return res.status(400).json({ 
                success: false, 
                message: "This prescription inquiry has expired or is no longer active." 
            });
        }

        // 5. Null-safe duplicate proposal check
        const alreadySubmitted = Array.isArray(request.proposals) && request.proposals.some(p => 
            p && p.nurseId && String(p.nurseId) === String(nurseId)
        );

        if (alreadySubmitted) {
            return res.status(400).json({ 
                success: false, 
                message: "You have already submitted a proposal for this prescription request." 
            });
        }

        // 6. Clean calculation of totals
        const baseServicePrice = parsedServices.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        const consumableTotal = parsedConsumables.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        const tax = Number(taxAmount || 0);
        const totalPrice = baseServicePrice + consumableTotal + tax;

        const formattedServices = parsedServices.map(s => ({
            title: String(s.title || "Nursing Service"),
            price: Number(s.price || 0)
        }));

        const formattedConsumables = parsedConsumables.map(c => ({
            name: String(c.name || c.itemName || "Consumable"),
            price: Number(c.price || 0)
        }));

        const proposal = {
            nurseId,
            servicesPricing: formattedServices,
            consumablesUsed: formattedConsumables,
            priceBreakdown: {
                baseServicePrice,
                consumableTotal,
                taxAmount: tax,
                totalPrice
            },
            status: 'Pending',
            submittedAt: new Date()
        };

        if (!Array.isArray(request.proposals)) {
            request.proposals = [];
        }
        request.proposals.push(proposal);

        // 7. Null-safe candidate status update
        if (Array.isArray(request.candidateNurses)) {
            const candidateIndex = request.candidateNurses.findIndex(cn => 
                cn && cn.nurseId && String(cn.nurseId) === String(nurseId)
            );
            if (candidateIndex > -1) {
                request.candidateNurses[candidateIndex].status = 'Submitted';
            }
        }

        await request.save();

        // 8. In-memory Nurse Bureau Name resolution (Fast & zero DB overhead)
        const nurseName = req.user?.name || "Nursing Care Bureau";

        const serviceNames = formattedServices.map(s => s.title).slice(0, 3).join(', ');
        const servicesSummary = formattedServices.length > 3 ? `${serviceNames} +${formattedServices.length - 3} more` : serviceNames;

        // 9. Fail-safe Patient Notification Dispatch
        if (request.userId) {
            try {
                await sendPushNotification(
                    request.userId,
                    'user',
                    `🧾 Nursing Care Bill Ready: ₹${totalPrice} (${nurseName})`,
                    `${nurseName} has generated your care bill of ₹${totalPrice} for [${servicesSummary}]. Tap to review and pay.`,
                    { 
                        type: 'PRESCRIPTION_BILL_GENERATED',
                        serviceType: 'Nurse',
                        requestId: String(request._id), 
                        proposalId: String(proposal._id || ""),
                        totalAmount: String(totalPrice),
                        vendorName: String(nurseName),
                        itemCount: String(formattedServices.length),
                        itemsSummary: String(servicesSummary),
                        paymentRoute: '/nurse/prescription-bill',
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                );
            } catch (notifErr) {
                console.error("Nurse Bill Notification Non-Blocking Error:", notifErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: "Proposal bill submitted successfully to patient.",
            data: proposal
        });

    } catch (error) {
        console.error("Submit Proposal Critical Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};  


const declinePrescriptionRequest = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { requestId } = req.body;

        const request = await NursingPrescriptionRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found." });
        }

        // Update specific candidate index state to 'Declined'
        const candidateIndex = request.candidateNurses.findIndex(cn => cn.nurseId.toString() === nurseId.toString());
        if (candidateIndex > -1) {
            request.candidateNurses[candidateIndex].status = 'Declined';
            await request.save();
        }

        res.json({ success: true, message: "Request declined and removed from your view." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get All Confirmed Prescription Bookings for Nurse Bureau (With Pagination)
// @route   GET /provider/nurse/prescription/bookings
// @access  Private (Nurse Bureau)
const getVendorPrescriptionBookings = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { status, page = 1, limit = 10 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        let query = { 
            nurseId: nurseId, 
            bookingType: 'Prescription' 
        };
        
        if (status && status !== 'All') {
            query.status = status;
        }

        const [totalItems, bookings] = await Promise.all([
            NurseBooking.countDocuments(query),
            NurseBooking.find(query)
                .populate('userId', 'name phone profilePic gender dob')
                .populate('assignedStaffId', 'name phone vehicleNumber status location')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        res.status(200).json({
            success: true,
            count: bookings.length,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            data: bookings
        });

    } catch (error) {
        console.error("Get Vendor Prescription Bookings Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Cancel Active Prescription Broadcast Request by Patient
// @route   PATCH /user/nurse/prescription/cancel/:requestId
// @access  Private (User)
const cancelPrescriptionInquiry = async (req, res) => {
    try {
        const { requestId } = req.params;
        const userId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(requestId);
        const query = {
            userId,
            ...(isObjectId ? { _id: requestId } : { _id: new mongoose.Types.ObjectId() })
        };

        const request = await NursingPrescriptionRequest.findOne(query);
        if (!request) {
            return res.status(404).json({ success: false, message: "Prescription inquiry not found or unauthorized." });
        }

        if (request.status === 'Completed') {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot cancel. This inquiry has already been converted into a paid booking." 
            });
        }

        if (request.status === 'Expired' || request.status === 'Cancelled') {
            return res.status(400).json({ 
                success: false, 
                message: `Inquiry is already in '${request.status}' state.` 
            });
        }

        request.status = 'Cancelled';
        await request.save();

        res.status(200).json({
            success: true,
            message: "Prescription inquiry cancelled successfully.",
            data: request
        });

    } catch (error) {
        console.error("Cancel Prescription Inquiry Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getIncomingPrescriptionRequests,
    submitProposal,
    declinePrescriptionRequest,
    getVendorPrescriptionBookings,
    cancelPrescriptionInquiry
};