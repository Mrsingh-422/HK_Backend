const Booking = require('../../models/AmbulanceBooking');
const Ambulance = require('../../models/Ambulance');
const Appointment = require('../../models/Appointment'); // 👈 FIX 1: Added missing Appointment model import
const crypto = require('crypto'); // 👈 FIX 2: Added missing crypto module import
const mongoose = require('mongoose');

const getMyActiveTrip = async (req, res) => {
    try {
        const driverId = req.user.id;

        // Strictly fetches any active transit booking for this specific driver with full coordinates
        const activeTrip = await Booking.findOne({
            ambulanceId: driverId,
            status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
        })
        .populate('userId', 'name phone profilePic')
        .populate('hospitalId', 'name address location'); // 👈 Populates Hospital Location Coords

        res.json({ success: true, data: activeTrip || null });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 1. GET NEW REQUESTS (PAGINATED)
const getIncomingRequests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;

        const requests = await Booking.find({ status: 'Searching' })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('userId', 'name phone profilePic');

        res.json({ success: true, page, data: requests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. ACCEPT REQUEST (Figma Screen 35)
const acceptBooking = async (req, res) => {
    try {
        const { bookingId } = req.params; // e.g., "HK-BOK-404336"
        const ambulanceId = req.user.id;

        // Check if driver is already on duty
        const driver = await Ambulance.findById(ambulanceId);
        if (!driver.availableForEmergency) {
            return res.status(400).json({ message: "You are already on a trip" });
        }

        // FIX: Replaced findByIdAndUpdate with findOneAndUpdate to search strictly by dynamic bookingId string
        const booking = await Booking.findOneAndUpdate(
            { bookingId: bookingId }, 
            {
                ambulanceId: ambulanceId,
                status: 'Confirmed',
                $push: { trackingTimeline: { status: 'Driver Assigned', note: `${driver.name} is on the way` } }
            }, 
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ message: "Booking record not found in system." });
        }

        // Mark driver busy
        driver.availableForEmergency = false;
        await driver.save();

        res.json({ success: true, message: "Trip Confirmed", data: booking });
    } catch (error) { 
        console.error("Accept booking error:", error);
        res.status(500).json({ message: error.message }); 
    }
};

// 3. UPDATE TRIP PROGRESS (Figma Screen 37 Timeline)
// Status flow: Arrived -> Picked-Up -> En-Route -> Delivered
const updateTripStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, patientCondition } = req.body; 

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ message: "Trip not found" });

        booking.status = status;
        if (patientCondition) booking.patientDetails.condition = patientCondition;

        // Push to Figma Timeline
        booking.trackingTimeline.push({ 
            status: status, 
            timestamp: new Date(),
            note: note || `Patient marked as ${status}`
        });

        if (status === 'Delivered') {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { availableForEmergency: true });
        }

        await booking.save();
        res.json({ success: true, message: `Status: ${status}`, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. CAPTURE INCIDENT PHOTO (Figma Screen 33)
const uploadIncidentPhoto = async (req, res) => {
    try {
        const files = req.files || {};
        
        // FIX: Replaced req.file with req.files structure as ambulanceDocUploads is a fields uploader
        const photoPath = files.incidentPhoto ? `/uploads/ambulances/${files.incidentPhoto[0].filename}` : null;

        if (!photoPath) {
            return res.status(400).json({ success: false, message: "No photo uploaded or wrong field name" });
        }
        
        const booking = await Booking.findByIdAndUpdate(req.params.id, {
            $set: { 'patientDetails.incidentPhoto': photoPath }
        }, { new: true });

        res.json({ success: true, message: "Incident photo uploaded successfully", data: booking });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// 5. FINALIZE TRIP HANDOFF & AUTO-REGISTER HOSPITAL EMERGENCY ADMISSION
const finalizeTripHandoff = async (req, res) => {
    try {
        const { id } = req.params; // Ambulance Booking ID
        const { doctorName, wardName, duration, reason } = req.body;

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        // 1. Save Handoff Details
        booking.handoffDetails = {
            doctorName,
            wardName,
            duration,
            reasonAtHandoff: reason,
            completedAt: new Date()
        };

        // 2. Mark Trip as Delivered/Completed
        booking.status = 'Delivered';
        
        // 3. Update Timeline
        booking.trackingTimeline.push({
            status: 'Patient delivered to hospital',
            timestamp: new Date(),
            note: `Handoff done to ${doctorName} in ${wardName}`
        });

        // 4. Ambulance ko free karein (On Duty -> Available)
        await Ambulance.findByIdAndUpdate(booking.ambulanceId, { availableForEmergency: true });

        await booking.save();

        // 5. 🚀 AUTO-CREATE HOSPITAL ADMISSION (APPOINTMENT) RECORD
        // Generating Unique Booking ID for Hospital Side
        const hospitalBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // Map Patient details from Ambulance Booking model
        const patientsData = [{
            patientName: booking.patientDetails?.name || "Emergency Patient",
            patientAge: booking.patientDetails?.age || 30,
            gender: booking.patientDetails?.gender || "Male",
            relation: booking.patientDetails?.relation || "Self",
            reasonForVisit: reason || booking.patientDetails?.emergencyDescription || "Ambulance Emergency Drop-off"
        }];

        await Appointment.create({
            userId: booking.userId,
            hospitalId: booking.hospitalId, // Destination Hospital ID
            ambulanceId: booking.ambulanceId, // Tracking Ambulance ID (Brought by Ambulance)
            bookingType: 'Admission',
            bedBookingType: 'Emergency-Bed', // 👈 Categorized as Emergency Bed Booking
            status: 'Hospital-Pending', // Hospital Panel me "Incoming Referral/Pending" me show hoga
            bookingId: hospitalBookingId,
            triageLevel: booking.triageLevel || 'Emergency',
            patients: patientsData,
            startDate: new Date(), // Admission starts instantly at handoff
            pricingBreakdown: {
                baseFee: 0,
                subtotal: 0
            },
            totalAmount: 0
        });

        res.json({ success: true, message: "Trip Finalized & Hospital Admission Created", data: booking });

    } catch (error) { 
        console.error("Handoff Error:", error);
        res.status(500).json({ message: error.message }); 
    }
};

// --- 1. VERIFY OTP (Figma Screen 36) ---
const verifyPickupOtp = async (req, res) => {
    try {
        const { id } = req.params; // Booking ObjectId
        const { otp } = req.body; // Sent from driver panel

        const booking = await Booking.findById(id);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        // --- DEVELOPMENT BYPASS CHECK ---
        const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
        const isStaticOtpMatch = isDev && String(otp).trim() === '1111';

        // Strict validation (Bypassed if development mode and static OTP '1111' is used)
        if (!isStaticOtpMatch && String(booking.otp).trim() !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: "Invalid OTP. Please check with patient again." });
        }

        booking.isOtpVerified = true;
        booking.status = 'Picked-Up';
        
        // Timeline tracking audit
        booking.trackingTimeline.push({ 
            status: 'Patient pickup confirmed', 
            timestamp: new Date(),
            note: isStaticOtpMatch ? "OTP verified via development master bypass code." : "OTP successfully verified by driver at pickup spot."
        });
        
        await booking.save();

        res.json({ success: true, message: "OTP Verified. Start Navigation.", data: booking });
    } catch (error) { 
        console.error("OTP verification error:", error);
        res.status(500).json({ message: error.message }); 
    }
};

const rejectBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { reason, comments } = req.body; // Figma Radio options: "Busy on another case", "Vehicle issue", etc.

        // Booking remains in 'Searching' state so other nearby drivers can see and accept it
        const booking = await Booking.findOneAndUpdate(
            { bookingId },
            {
                $set: { cancelledBy: 'Driver', cancellationReason: reason },
                $push: { 
                    trackingTimeline: { 
                        status: 'Rejected by Driver', 
                        timestamp: new Date(), 
                        note: `Driver rejected. Reason: ${reason}. Note: ${comments || ''}` 
                    } 
                }
            },
            { new: true }
        );

        if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

        // Restore driver's active availability state
        await Ambulance.findByIdAndUpdate(req.user.id, { $set: { availableForEmergency: true } });

        res.json({ success: true, message: "SOS Booking rejected successfully. Returned back to pool." });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// --- API: RE-ROUTE TRANSIT AMBULANCE (Figma Screen: Re-Route Dialog) ---
const reRouteAmbulance = async (req, res) => {
    try {
        const { id } = req.params; // Booking ObjectId (_id)
        const { newHospitalId, reason, notes } = req.body; // Reason options: "Hospital Full", "No ICU Bed", etc.

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ success: false, message: "Transit booking not found." });

        const oldHospital = await Hospital.findById(booking.hospitalId);
        const newHospital = await Hospital.findById(newHospitalId);

        if (!newHospital) return res.status(404).json({ success: false, message: "New target hospital not found." });

        // Update target destination hospital
        booking.hospitalId = newHospitalId;
        
        // Push re-route event to tracking timeline
        booking.trackingTimeline.push({
            status: 'Re-Routed',
            timestamp: new Date(),
            note: `Re-routed from ${oldHospital ? oldHospital.name : 'Old Hospital'} to ${newHospital.name}. Reason: ${reason}. Note: ${notes || ''}`
        });

        await booking.save();
        res.json({ success: true, message: `Transit successfully re-routed to ${newHospital.name}`, data: booking });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// --- 7. GET DRIVER DASHBOARD COUNTS (NEW API - Figma Screen 1/2) ---
const getDriverDashboardStats = async (req, res) => {
    try {
        const driverId = req.user.id; // Logged-in Driver ID

        // FIX: MongoDB aggregate strictly requires explicit ObjectId wrapping to match records
        const stats = await Booking.aggregate([
            { $match: { ambulanceId: new mongoose.Types.ObjectId(driverId) } },
            { $group: {
                _id: null,
                emergency: { $sum: { $cond: [{ $in: ["$serviceType", ["Accident emergency", "Quick Response"]] }, 1, 0] } },
                medical: { $sum: { $cond: [{ $eq: ["$serviceType", "Medical Ambulance"] }, 1, 0] } },
                referral: { $sum: { $cond: [{ $eq: ["$serviceType", "Referral Ambulance"] }, 1, 0] } }
            }}
        ]);

        res.json({
            success: true,
            data: stats[0] || { emergency: 0, medical: 0, referral: 0 }
        });
    } catch (error) {
        console.error("Driver Stats Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 7. GET DRIVER COMPLETE TRIPS HISTORY (NEW API) ---
const getDriverTripHistory = async (req, res) => {
    try {
        const driverId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;

        const history = await Booking.find({
            ambulanceId: driverId,
            status: { $in: ['Delivered', 'Cancelled'] } // Strictly completed/cancelled trips
        })
        .populate('userId', 'name phone profilePic')
        .populate('hospitalId', 'name address')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

        const total = await Booking.countDocuments({
            ambulanceId: driverId,
            status: { $in: ['Delivered', 'Cancelled'] }
        });

        res.json({
            success: true,
            totalRecords: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            count: history.length,
            data: history
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};



module.exports = {getMyActiveTrip, getIncomingRequests, acceptBooking, updateTripStatus, uploadIncidentPhoto,
    finalizeTripHandoff,verifyPickupOtp,
    rejectBooking, reRouteAmbulance,getDriverDashboardStats,
    getDriverTripHistory
 };