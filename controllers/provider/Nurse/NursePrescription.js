const NursingPrescriptionRequest = require('../../../models/NursingPrescriptionRequest');
const NurseBooking = require('../../../models/NurseBooking');
const moment = require('moment');

// 1. GET ALL ACTIVE BROADCASTED REQUESTS FOR THE LOGGED-IN NURSE
const getIncomingPrescriptionRequests = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const now = new Date();

        // Find requests where this nurse is a candidate, and status is Broadcasted and not expired
        const requests = await NursingPrescriptionRequest.find({
            status: 'Broadcasted',
            expiresAt: { $gt: now },
            "candidateNurses": {
                $elemMatch: {
                    nurseId: nurseId,
                    status: 'Pending'
                }
            }
        }).populate('userId', 'name gender age');

        res.json({
            success: true,
            count: requests.length,
            data: requests
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. SUBMIT PROPOSAL / GENERATE BILL
const submitProposal = async (req, res) => {
    try {
        const nurseId = req.user._id; // Using mongodb safe objectId key

        // 🔍 Terminal log to inspect raw incoming request from Flutter/Frontend
        console.log("=== [DEBUG] Incoming Submit Proposal Payload ===");
        console.log("Body:", req.body);
        console.log("User/Nurse ID:", nurseId);

        let { requestId, servicesPricing, consumablesUsed, taxAmount } = req.body;

        // 1. Safe parsing for stringified Arrays sent by some frontend networks
        if (typeof servicesPricing === 'string') {
            try {
                servicesPricing = JSON.parse(servicesPricing);
            } catch (e) {
                return res.status(400).json({ success: false, message: "Failed parsing servicesPricing string into JSON array." });
            }
        }

        if (typeof consumablesUsed === 'string') {
            try {
                consumablesUsed = JSON.parse(consumablesUsed);
            } catch (e) {
                consumablesUsed = [];
            }
        }

        // 2. Precise Validation Checks with unique message tags
        if (!requestId) {
            return res.status(400).json({ success: false, message: "Validation Error: 'requestId' field is missing or empty." });
        }
        if (!servicesPricing || !Array.isArray(servicesPricing) || servicesPricing.length === 0) {
            return res.status(400).json({ success: false, message: "Validation Error: 'servicesPricing' must be a valid non-empty array." });
        }

        const request = await NursingPrescriptionRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "Database Lookup Error: No request found with the provided requestId." });
        }

        // 3. Expiration validation check
        if (new Date() > request.expiresAt) {
            request.status = 'Expired';
            await request.save();
            return res.status(400).json({ success: false, message: "Transaction Error: This prescription request has expired (6 hours passed)." });
        }

        // 4. Double submission validation check
        const alreadySubmitted = request.proposals.some(p => p.nurseId.toString() === nurseId.toString());
        if (alreadySubmitted) {
            return res.status(400).json({ success: false, message: "Validation Error: You have already submitted a proposal for this prescription request." });
        }

        // Calculations
        const baseServicePrice = servicesPricing.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        const consumableTotal = (consumablesUsed || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        const tax = Number(taxAmount) || 0;
        const totalPrice = baseServicePrice + consumableTotal + tax;

        const proposal = {
            nurseId,
            servicesPricing,
            consumablesUsed,
            priceBreakdown: {
                baseServicePrice,
                consumableTotal,
                taxAmount: tax,
                totalPrice
            }
        };

        request.proposals.push(proposal);

        const candidateIndex = request.candidateNurses.findIndex(cn => cn.nurseId.toString() === nurseId.toString());
        if (candidateIndex > -1) {
            request.candidateNurses[candidateIndex].status = 'Submitted';
        }

        await request.save();

        res.status(211).json({
            success: true,
            message: "Proposal submitted successfully.",
            data: proposal
        });

    } catch (error) {
        console.error("[CRITICAL ERROR] submitProposal:", error);
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

const getVendorPrescriptionBookings = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { status } = req.query; // e.g., Confirmed, Completed, Cancelled

        let query = { 
            nurseId: nurseId, 
            bookingType: 'Prescription' // 👈 Strictly filters only prescription bookings
        };
        
        if (status) {
            query.status = status;
        }

        const bookings = await NurseBooking.find(query)
            .populate('userId', 'name phone profilePic gender dob')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: bookings.length,
            data: bookings
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getIncomingPrescriptionRequests,
    submitProposal,
    declinePrescriptionRequest,
    getVendorPrescriptionBookings
};