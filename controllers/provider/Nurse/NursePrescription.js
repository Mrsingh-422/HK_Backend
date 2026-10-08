const NursingPrescriptionRequest = require('../../../models/NursingPrescriptionRequest');
const NurseBooking = require('../../../models/NurseBooking');
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

// @desc    Submit Proposal / Generate Prescription Bill for Patient (With Instant Patient Alert)
// @route   POST /provider/nurse/prescription/respond
// @access  Private (Nurse Bureau)
const submitProposal = async (req, res) => {
    try {
        const nurseId = req.user.id;
        let { requestId, servicesPricing, consumablesUsed, taxAmount } = req.body;

        if (typeof servicesPricing === 'string') {
            try { servicesPricing = JSON.parse(servicesPricing); } catch (e) {}
        }
        if (typeof consumablesUsed === 'string') {
            try { consumablesUsed = JSON.parse(consumablesUsed); } catch (e) {}
        }

        if (!requestId || !servicesPricing || !Array.isArray(servicesPricing) || servicesPricing.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "requestId and a valid non-empty servicesPricing array are required." 
            });
        }

        const request = await NursingPrescriptionRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "Prescription request not found." });
        }

        if (request.status !== 'Broadcasted' || new Date() > request.expiresAt) {
            return res.status(400).json({ success: false, message: "This prescription inquiry has expired or is no longer active." });
        }

        const alreadySubmitted = request.proposals.some(p => p.nurseId.toString() === nurseId.toString());
        if (alreadySubmitted) {
            return res.status(400).json({ success: false, message: "You have already submitted a proposal for this request." });
        }

        const baseServicePrice = servicesPricing.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        const consumableTotal = (consumablesUsed || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        const tax = Number(taxAmount || 0);
        const totalPrice = baseServicePrice + consumableTotal + tax;

        const proposal = {
            nurseId,
            servicesPricing,
            consumablesUsed: consumablesUsed || [],
            priceBreakdown: {
                baseServicePrice,
                consumableTotal,
                taxAmount: tax,
                totalPrice
            },
            status: 'Pending',
            submittedAt: new Date()
        };

        request.proposals.push(proposal);

        const candidateIndex = request.candidateNurses.findIndex(cn => cn.nurseId.toString() === nurseId.toString());
        if (candidateIndex > -1) {
            request.candidateNurses[candidateIndex].status = 'Submitted';
        }

        await request.save();

        // 🔔 Patient Push Notification: Alert user that a proposal bill has arrived
        if (request.userId) {
            try {
                await sendPushNotification(
                    request.userId,
                    'user',
                    "📋 New Nursing Proposal Bill Received!",
                    `A nearby nurse bureau submitted a proposal of ₹${totalPrice} for your prescription inquiry. Tap to review.`,
                    { requestId: request._id.toString(), type: 'new_prescription_proposal' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: "Proposal bill submitted successfully to patient.",
            data: proposal
        });

    } catch (error) {
        console.error("Submit Proposal Error:", error);
        res.status(500).json({ success: false, message: error.message });
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