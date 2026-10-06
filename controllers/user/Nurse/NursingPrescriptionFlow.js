const NursingPrescriptionRequest = require('../../../models/NursingPrescriptionRequest');
const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const moment = require('moment');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { getDistance } = require('../../../utils/helpers');
const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay');
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification');

// 1. UPLOAD PRESCRIPTION & PARSE (AI Integration)
const uploadAndParsePrescription = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Prescription image is required" });
        }

        const imagePath = req.file.path;
        let detectedServices = [];
        let extractedText = "";

        if (process.env.NODE_ENV === 'development') {
            extractedText = "Patient needs daily glucose tracking, wound dressing hygiene, and periodic medication injections.";
            detectedServices = [
                { title: "Wound Dressing Care", description: "Identified for daily hygiene requirements" },
                { title: "Injection & IV Support", description: "Identified for injection requirements" }
            ];
        } else {
            // Production Flow logic setup
            try {
                // Here you would integrate Cloud OCR / Vision Client
                // Example structure matching the development fallback
                extractedText = "Processed via cloud engine: Sterile wound dressing and critical injection support.";
                
                // Matching algorithms to map standard service tags
                const lowercaseText = extractedText.toLowerCase();
                if (lowercaseText.includes("dressing") || lowercaseText.includes("wound")) {
                    detectedServices.push({ title: "Wound Dressing Care", description: "Suggested matching based on prescription keywords" });
                }
                if (lowercaseText.includes("injection") || lowercaseText.includes("iv")) {
                    detectedServices.push({ title: "Injection & IV Support", description: "Suggested matching based on prescription keywords" });
                }
            } catch (err) {
                console.error("Cloud AI service returned error:", err);
                // Fail-safe empty state allows user to manually type on the UI side
                extractedText = "";
                detectedServices = [];
            }
        }

        res.json({
            success: true,
            prescriptionImage: imagePath,
            extractedText,
            detectedServices
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// BROADCAST PRESCRIPTION REQUEST (Crash-Proof Distance & Top 10 Candidate Match)
// Endpoint: POST /user/nurse/prescription/broadcast
const broadcastPrescriptionRequest = async (req, res) => {
    try {
        let { prescriptionImage, services, lat, lng, address } = req.body;

        // Parse JSON string inputs if sent via FormData
        if (typeof services === 'string') {
            try { services = JSON.parse(services); } catch (e) {}
        }
        if (typeof address === 'string') {
            try { address = JSON.parse(address); } catch (e) {}
        }

        if (!prescriptionImage || !services || !Array.isArray(services) || services.length === 0 || !lat || !lng) {
            return res.status(400).json({ 
                success: false, 
                message: "Prescription image, services list, and coordinates (lat, lng) are required." 
            });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);

        // 1. Fetch all active and approved Nurse Providers
        const allNurses = await Nurse.find({
            profileStatus: 'Approved',
            isActive: true
        }).select('_id name location phone profileImage rating city').lean();

        if (allNurses.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "No nursing service providers found in platform registry." 
            });
        }

        // 2. Calculate real-world distance safely without GeoJSON indexing crash
        const nursesWithDistance = [];
        for (let nurse of allNurses) {
            if (nurse.location?.lat && nurse.location?.lng) {
                const dist = await getDistance(userLat, userLng, Number(nurse.location.lat), Number(nurse.location.lng));
                if (dist <= 25) { // 25km service radius
                    nursesWithDistance.push({ nurseId: nurse._id, distance: dist, nurseInfo: nurse });
                }
            }
        }

        if (nursesWithDistance.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "No nursing service providers available within 25km radius." 
            });
        }

        // 3. Sort by nearest and pick top 10 candidates
        nursesWithDistance.sort((a, b) => a.distance - b.distance);
        const top10Candidates = nursesWithDistance.slice(0, 10).map(c => ({
            nurseId: c.nurseId,
            status: 'Pending'
        }));

        // Expiry: Exactly 6 hours from broadcast
        const expiresAt = moment().add(6, 'hours').toDate();

        const request = await NursingPrescriptionRequest.create({
            userId: req.user.id,
            prescriptionImage,
            services,
            location: { 
                lat: userLat, 
                lng: userLng, 
                address: address || {} 
            },
            candidateNurses: top10Candidates,
            expiresAt
        });

        // 4. Send Push Notifications to all candidate nurses
        for (let candidate of top10Candidates) {
            try {
                await sendPushNotification(
                    candidate.nurseId,
                    'nurse',
                    "📋 New Nursing Prescription Request!",
                    `New prescription care inquiry nearby. Tap to review and submit your proposal bill.`,
                    { requestId: request._id.toString(), type: 'new_prescription_inquiry' }
                );
            } catch (e) {}
        }

        res.status(201).json({
            success: true,
            message: `Prescription broadcasted successfully to ${top10Candidates.length} nearby nurses.`,
            requestId: request._id,
            expiresAt
        });

    } catch (error) {
        console.error("Broadcast Prescription Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


const getUserPrescriptionHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const total = await NursingPrescriptionRequest.countDocuments({ userId });

        const history = await NursingPrescriptionRequest.find({ userId })
            .populate({
                path: 'proposals.nurseId',
                select: 'name profileImage rating city experienceYears'
            })
            .populate('selectedNurseId', 'name profileImage rating city')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const formattedHistory = history.map(request => {
            let calculatedStatus = request.status;
            if (new Date() > request.expiresAt && request.status === 'Broadcasted') {
                calculatedStatus = 'Expired';
            }

            // Extract Selected Vendor Flat Information
            let selectedVendorDetails = null;
            if (request.selectedNurseId) {
                selectedVendorDetails = {
                    vendorId: request.selectedNurseId._id,
                    vendorName: request.selectedNurseId.name, // 👈 Explicit Flat Name
                    vendorProfileImage: request.selectedNurseId.profileImage,
                    vendorRating: request.selectedNurseId.rating,
                    vendorCity: request.selectedNurseId.city
                };
            }

            return {
                requestId: request._id,
                prescriptionImage: request.prescriptionImage,
                services: request.services,
                location: request.location,
                requestStatus: calculatedStatus, // Broadcasted, Completed, Expired
                expiresAt: request.expiresAt,
                createdAt: request.createdAt,
                selectedVendor: selectedVendorDetails, // 👈 Flat structured details
                bookingId: request.bookingId || null,
                proposals: request.proposals.map(proposal => ({
                    proposalId: proposal._id,
                    vendorId: proposal.nurseId ? proposal.nurseId._id : null,
                    vendorName: proposal.nurseId ? proposal.nurseId.name : "Unknown Vendor", // 👈 Proposals Vendor Name
                    vendorProfileImage: proposal.nurseId ? proposal.nurseId.profileImage : null,
                    vendorRating: proposal.nurseId ? proposal.nurseId.rating : 0,
                    vendorExperience: proposal.nurseId ? proposal.nurseId.experienceYears : 0,
                    servicesPricing: proposal.servicesPricing,
                    consumablesUsed: proposal.consumablesUsed,
                    priceBreakdown: proposal.priceBreakdown,
                    status: proposal.status,
                    submittedAt: proposal.submittedAt
                }))
            };
        });

        res.json({
            success: true,
            totalItems: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: formattedHistory
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET LIST OF PROPOSALS FOR THE USER
const getRequestProposals = async (req, res) => {
    try {
        const { requestId } = req.params;

        const request = await NursingPrescriptionRequest.findById(requestId)
            .populate('proposals.nurseId', 'name profileImage rating experienceYears');

        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        // Check if request has expired
        if (new Date() > request.expiresAt && request.status === 'Broadcasted') {
            request.status = 'Expired';
            await request.save();
        }

        res.json({
            success: true,
            status: request.status,
            expiresAt: request.expiresAt,
            proposals: request.proposals
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ACCEPT A PROPOSAL AND INITIATE BOOKING (Null-Safe Address & Price Calculation)
// Endpoint: POST /user/nurse/prescription/accept
const acceptProposalAndBook = async (req, res) => {
    try {
        const { requestId, proposalId } = req.body;

        // 1. Validation Checks
        const request = await NursingPrescriptionRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found." });
        }
        if (request.status !== 'Broadcasted') {
            return res.status(400).json({ success: false, message: "This request is no longer active." });
        }

        // Expiry validation check
        if (new Date() > request.expiresAt) {
            request.status = 'Expired';
            await request.save();
            return res.status(400).json({ success: false, message: "This request has expired." });
        }

        const selectedProposal = request.proposals.id(proposalId);
        if (!selectedProposal) {
            return res.status(404).json({ success: false, message: "Proposal not found." });
        }

        const bId = `HKN-RX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // 2. Generate Razorpay Order strictly for selected proposal amount
        const rzpOrder = await createRazorpayOrder(selectedProposal.priceBreakdown.totalPrice, `rx_receipt_${bId}`);

        // 3. Create booking document in 'Pending' status with safe address parsing
        const addr = request.location?.address || {};
        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId: selectedProposal.nurseId,
            bookingId: bId,
            bookingType: 'Prescription',
            prescriptionRequestId: requestId,
            serviceDetails: {
                title: `Prescription Service Booking`,
                type: "Prescription Request",
                duration: "As prescribed",
                basePrice: selectedProposal.priceBreakdown.baseServicePrice
            },
            priceBreakdown: {
                baseServicePrice: selectedProposal.priceBreakdown.baseServicePrice,
                consumableTotal: selectedProposal.priceBreakdown.consumableTotal,
                taxAmount: selectedProposal.priceBreakdown.taxAmount,
                totalPrice: selectedProposal.priceBreakdown.totalPrice,
                slotSurcharge: 0,
                fasterServiceCharge: 0
            },
            address: {
                name: addr.name || req.user.name || "Patient",
                phone: addr.phone || req.user.phone || "",
                houseNo: addr.houseNo || "",
                landmark: addr.landmark || "",
                city: addr.city || "",
                state: addr.state || "",
                pincode: addr.pincode || "",
                addressType: addr.addressType || "Home"
            },
            assessmentLocation: 'At Home',
            paymentMethod: 'Online',
            status: 'Pending',
            paymentStatus: 'Pending',
            prescriptionImage: request.prescriptionImage
        });

        // 4. Return Razorpay initialization payload for client
        return res.status(200).json({
            success: true,
            message: "Razorpay order generated successfully. Complete payment to confirm booking.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id,
            bookingId: bId,
            requestId: request._id,
            proposalId: selectedProposal._id
        });

    } catch (error) {
        console.error("Accept Proposal Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. VERIFY PRESCRIPTION PAYMENT & CONFIRM BOOKING (History Preserved)
// Endpoint: POST /user/nurse/prescription/verify-payment
const verifyPrescriptionPayment = async (req, res) => {
    try {
        const { appointmentId, requestId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!appointmentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ success: false, message: "Missing payment verification parameters." });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Invalid payment signature verification failed." });
        }

        const booking = await NurseBooking.findById(appointmentId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking document not found." });
        }

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        booking.status = 'Confirmed';
        booking.paymentStatus = 'Paid';
        booking.paymentMethod = 'Online';
        booking.paymentDetails = rzpDetails;
        await booking.save();

        // 🚨 HISTORY PRESERVATION FIX: Mark request as 'Completed' instead of deleting it!
        const targetRequestId = requestId || booking.prescriptionRequestId;
        if (targetRequestId && mongoose.isValidObjectId(targetRequestId)) {
            await NursingPrescriptionRequest.findByIdAndUpdate(targetRequestId, {
                $set: {
                    status: 'Completed',
                    selectedNurseId: booking.nurseId,
                    bookingId: booking._id
                }
            });
        }

        // Notify Nurse Bureau
        try {
            await notifyAdminsAndVendor(
                booking.nurseId,
                'nurse',
                "New Prescription Booking Confirmed!",
                `Paid Prescription booking #${booking.bookingId} has been confirmed. Please assign a nurse staff.`,
                { bookingId: booking._id.toString(), type: 'new_prescription_booking' }
            );
        } catch (e) {}

        res.json({
            success: true,
            message: "Payment verified, booking confirmed and prescription archived to history.",
            data: booking
        });

    } catch (error) {
        console.error("Verify Prescription Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    uploadAndParsePrescription,
    broadcastPrescriptionRequest,
    getUserPrescriptionHistory,
    getRequestProposals,
    acceptProposalAndBook,
    verifyPrescriptionPayment
};