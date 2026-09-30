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

// 3. SUBMIT PROPOSAL / GENERATE PRESCRIPTION BILL
// Endpoint: POST /provider/nurse/prescription/respond
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

        // 🚨 FIXED: Standard 200 OK Response
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