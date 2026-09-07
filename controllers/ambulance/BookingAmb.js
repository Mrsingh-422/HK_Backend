const Booking = require('../../models/AmbulanceBooking');
const Ambulance = require('../../models/Ambulance');
const Appointment = require('../../models/Appointment'); // 👈 FIX 1: Added missing Appointment model import
const DriverNotification = require('../../models/DriverNotification'); // Naya Model Imported
const bcrypt = require('bcryptjs'); // Password change hashing ke liye
const crypto = require('crypto'); // 👈 FIX 2: Added missing crypto module import
const mongoose = require('mongoose');
const { sendPushNotification, notifyAdminsAndVendor } = require('../../utils/notification'); // 👈 FIX 3: Added missing notification helper import
const Review = require('../../models/Review');
const Hospital = require('../../models/Hospital');
const NoShowConfig = require('../../models/NoShowConfig');
const { verifyFirebasePhoneToken } = require('../../utils/firebaseAuthHelper');
const { creditVendorCompensation } = require('../../utils/policyHelper');



const getMyActiveTrip = async (req, res) => {
    try {
        const driverId = req.user.id;

        // Fetch active trip with both origin and destination populated safely
        const activeTrip = await Booking.findOne({
            ambulanceId: driverId,
            status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
        })
        .populate('userId', 'name phone profilePic')
        .populate('hospitalId', 'name address location') // 🚀 Destination Hospital (Hospital B)
        .populate('pickupHospitalId', 'name address location'); // 🚀 SYNC FIX: Origin Hospital (Hospital A)

        res.json({ success: true, data: activeTrip || null });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// --- 1. GET DRIVER'S REFERRAL CASES (NEW: Figma Sidebar Option) ---
// GET /ambulance/booking/referral-cases?page=1
const getDriverReferralCases = async (req, res) => {
    try {
        const driverId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const query = {
            ambulanceId: driverId,
            serviceType: 'Referral Ambulance' // Only fetch referral transfers
        };

        const total = await Booking.countDocuments(query);
        const cases = await Booking.find(query)
            .populate('userId', 'name phone profilePic')
            .populate('pickupHospitalId', 'name address')
            .populate('hospitalId', 'name address')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: cases
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. GET SYSTEM CMS DETAILS (NEW: Figma Sidebar About, Terms & Contact Us) ---
// GET /ambulance/booking/system-cms
const getSystemCms = async (req, res) => {
    try {
        // Fetch global system-wide settings or return figma-aligned static config
        const cmsData = {
            about: "Health Kangaroo is a one-stop healthcare logistics solution, providing real-time, high-speed emergency and scheduled medical transit across India.",
            termsAndConditions: "The Detroit Medical Center STANDARD TERMS AND CONDITIONS: All prices and discounts are to be quoted firm against increase for the contract period. The vendor agrees herewith to invoice the DMC Accounts Payable Dept. at P.O. Box 02789...", // Matches your T&C document screenshot!
            contactUs: {
                phone: "+91 9876543210", // Exact phone from your Figma "Contact Us" modal screen
                email: "help@gmail.com"   // Exact email from your Figma "Contact Us" modal screen
            }
        };

        res.json({
            success: true,
            data: cmsData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1. GET INCOMING REQUESTS (PAGINATED & TARGETED ONLY) ---
const getIncomingRequests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const driverId = req.user.id;

        // 🚨 STRICT DRIVER VISIBILITY FILTER:
        // 1. Accidental Emergency (Searching in broadcast pool, not rejected by this driver)
        // 2. Direct Assigned Medical / Referral ONLY IF Confirmed AND (COD or Paid)
        const requests = await Booking.find({
            $or: [
                {
                    serviceType: 'Accident emergency',
                    status: 'Searching',
                    rejectedBy: { $ne: driverId }
                },
                {
                    ambulanceId: driverId,
                    status: 'Confirmed', // 👈 Blocks 'Pending' unpaid online orders!
                    $or: [
                        { paymentMethod: 'COD' },
                        { paymentStatus: 'Paid' }
                    ]
                }
            ]
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'name phone profilePic')
        .populate('pickupHospitalId', 'name address')
        .populate('hospitalId', 'name address');

        res.json({ success: true, page, data: requests });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// --- 2. ACCEPT REQUEST (Figma Screen 35) ---
const acceptBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const ambulanceId = req.user.id;

        const driver = await Ambulance.findById(ambulanceId);
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver not found." });
        }

        // 1. Check if driver is on another active trip
        const otherActiveTrip = await Booking.findOne({
            ambulanceId: driver._id,
            _id: { $ne: id },
            bookingId: { $ne: id },
            status: { $in: ['Arrived', 'Picked-Up', 'En-Route'] }
        });

        if (otherActiveTrip) {
            return res.status(400).json({ 
                success: false, 
                message: `You are already busy on active trip #${otherActiveTrip.bookingId}. Complete it first.` 
            });
        }

        const isObjectId = mongoose.isValidObjectId(id);
        
        // 🚀 SYNC FIX: Only unassigned ('Searching') OR trips already assigned to this driver can be accepted
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                { bookingId: id }
            ],
            $or: [
                { status: 'Searching' },
                { status: 'Confirmed', ambulanceId: driver._id }
            ]
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(400).json({ 
                success: false, 
                message: "This trip is no longer available or was claimed by another driver." 
            });
        }

        const isAccidental = booking.serviceType === 'Accident emergency';
        const timelineStatus = isAccidental ? 'Driver Assigned' : 'Accepted by Driver';
        const timelineNote = isAccidental 
            ? `${driver.name} has accepted your emergency request and is arriving shortly.`
            : `${driver.name} accepted your request. Navigation started.`;

        booking.ambulanceId = driver._id;
        booking.status = 'Confirmed';
        booking.trackingTimeline.push({ status: timelineStatus, timestamp: new Date(), note: timelineNote });
        await booking.save();

        // Lock driver availability
        driver.availableForEmergency = false;
        await driver.save();

        // 2. HOSPITAL PRE-ADMISSION SYNC
        if (booking.hospitalId) {
            const existingAppt = await Appointment.findOne({ transactionId: booking.bookingId });
            if (!existingAppt) {
                const hospitalBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
                await Appointment.create({
                    userId: booking.userId,
                    hospitalId: booking.hospitalId,
                    ambulanceId: driver._id,
                    bookingType: 'Admission',
                    bedBookingType: 'Emergency-Bed',
                    status: 'Hospital-Pending',
                    bookingId: hospitalBookingId,
                    transactionId: booking.bookingId,
                    triageLevel: booking.triageLevel || 'Emergency',
                    patients: [{
                        patientName: booking.patientDetails?.name || "Emergency Patient",
                        patientAge: booking.patientDetails?.age || 30,
                        gender: booking.patientDetails?.gender || "Male",
                        reasonForVisit: booking.patientDetails?.emergencyDescription || "Ambulance Emergency Drop-off"
                    }],
                    startDate: new Date(),
                    pricingBreakdown: { baseFee: 0, subtotal: 0 },
                    totalAmount: 0
                });

                await notifyAdminsAndVendor(
                    booking.hospitalId,
                    'hospital',
                    "🚨 New Incoming Emergency Case",
                    `Trauma patient is arriving shortly via Ambulance #${booking.bookingId}. Prepare emergency ward.`,
                    { bookingId: booking._id.toString(), type: 'incoming_emergency_case' }
                );
            }
        }

        // Alert user
        await sendPushNotification(
            booking.userId, 
            'user', 
            "Ambulance Assigned!", 
            `${driver.name} is on the way. Share Pickup OTP: ${booking.otp || 'None (Accidental)'} on arrival.`,
            { bookingId: booking._id.toString(), otp: booking.otp, type: 'driver_assigned' }
        );

        res.json({ success: true, message: "Ride accepted successfully. Navigation active.", data: booking });
    } catch (error) {
        console.error("Accept Booking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- 3. REJECT REQUEST (Driver Rejection) ---
const rejectBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, comments } = req.body; 
        const driverId = req.user.id;

        const figmaRejectionReasons = [
            'Busy on another case',
            'Pickup location too far',
            'Vehicle issue',
            'Not available right now'
        ];

        if (!figmaRejectionReasons.includes(reason)) {
            return res.status(400).json({ 
                success: false, 
                message: "Please select a valid rejection reason from the list." 
            });
        }

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query); 
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

        booking.rejectedBy = booking.rejectedBy || [];
        if (!booking.rejectedBy.includes(driverId)) {
            booking.rejectedBy.push(driverId);
        }

        // If it was an accidental SOS or broadcast, reopen pool for other ambulances
        if (booking.serviceType === 'Accident emergency') {
            booking.ambulanceId = null;
            booking.status = 'Searching';
            booking.trackingTimeline.push({ 
                status: 'Driver Passed', 
                timestamp: new Date(), 
                note: `Driver ${req.user.name || ''} was unavailable (${reason}). Searching next nearest ambulance.` 
            });
        } else {
            // For targeted bookings, mark cancelled and inform user
            booking.status = 'Cancelled';
            booking.cancelledBy = 'Driver';
            booking.cancellationReason = `${reason}. Comments: ${comments || 'None'}`;
            booking.trackingTimeline.push({ 
                status: 'Cancelled by Driver', 
                timestamp: new Date(), 
                note: `Selected driver unavailable: ${reason}.` 
            });

            await sendPushNotification(
                booking.userId, 
                'user', 
                "Ambulance Driver Unavailable", 
                "The selected ambulance is busy. Please choose another ambulance.",
                { bookingId: booking._id.toString(), type: 'request_rejected' }
            );

            // 🚀 SYNC FIX: Cancel linked pre-admission Appointment in hospital
            if (booking.bookingId) {
                await Appointment.findOneAndUpdate(
                    { transactionId: booking.bookingId },
                    { $set: { status: 'Cancelled-By-Doctor', 'tracking.status': 'Cancelled by Driver' } }
                );
            }
        }

        await booking.save();

        // Release Driver back to Available
        await Ambulance.findByIdAndUpdate(driverId, { $set: { availableForEmergency: true } });

        res.json({ 
            success: true, 
            message: "Request passed successfully. You are now Available for other calls." 
        });
    } catch (error) { 
        console.error("Reject Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 3. UPDATE TRIP PROGRESS (Figma Screen 37 Timeline) ---
// Status flow: Arrived -> Picked-Up -> En-Route -> Delivered
// Path: controllers/ambulance/BookingAmb.js
const updateTripStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, patientCondition, hospitalId } = req.body; 

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ success: false, message: "Trip not found" });

        booking.status = status;
        if (patientCondition) booking.patientDetails.condition = patientCondition;

        const existingAdmission = await Appointment.findOne({ transactionId: booking.bookingId });

        // Accidental emergency hospital allocation
        if (status === 'En-Route' && hospitalId) {
            booking.hospitalId = hospitalId;

            if (!existingAdmission) {
                const hospitalBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
                
                await Appointment.create({
                    userId: booking.userId,
                    hospitalId: hospitalId,
                    ambulanceId: booking.ambulanceId,
                    bookingType: 'Admission',
                    bedBookingType: 'Emergency-Bed',
                    status: 'Hospital-Pending', 
                    bookingId: hospitalBookingId,
                    transactionId: booking.bookingId, 
                    triageLevel: booking.triageLevel || 'Emergency',
                    patients: [{
                        patientName: booking.patientDetails?.name || "Accident Victim",
                        patientAge: booking.patientDetails?.age || 30,
                        gender: booking.patientDetails?.gender || "Male",
                        reasonForVisit: booking.patientDetails?.emergencyDescription || "Accidental Emergency Drop-off"
                    }],
                    startDate: new Date(),
                    pricingBreakdown: { baseFee: 0, subtotal: 0 },
                    totalAmount: 0
                });

                await notifyAdminsAndVendor(
                    hospitalId,
                    'hospital',
                    "🚨 New Emergency Patient En-Route!",
                    `Accident victim is arriving via Ambulance #${booking.bookingId}. Both User & Driver spot photos attached.`,
                    { bookingId: booking._id.toString(), type: 'emergency_incoming' }
                );
            }
        }

        booking.trackingTimeline.push({ 
            status: status, 
            timestamp: new Date(),
            note: note || `Patient marked as ${status}`
        });

        if (status === 'Delivered') {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { availableForEmergency: true });
        }

        await booking.save();

        // 🚀 CRITICAL WORKFLOW SYNC: Update status and tracking timeline in linked hospital Appointment
        if (booking.bookingId) {
            const updateFields = { 'tracking.status': status };
            if (status === 'Delivered') {
                updateFields.status = 'In-Progress'; // Mark patient physically admitted
            }
            await Appointment.findOneAndUpdate(
                { transactionId: booking.bookingId },
                { $set: updateFields }
            );
        }

        res.json({ success: true, message: `Status updated to: ${status}`, data: booking });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 4. CAPTURE INCIDENT PHOTO (Figma Screen 33)
const uploadIncidentPhoto = async (req, res) => {
    try {
        const { id } = req.params; // Booking Mongo ID
        const files = req.files || {};
        
        const photoPath = files.incidentPhoto ? `/uploads/ambulances/${files.incidentPhoto[0].filename}` : null;
        if (!photoPath) return res.status(400).json({ success: false, message: "No photo uploaded" });
        
        const booking = await Booking.findByIdAndUpdate(id, {
            $set: { 'patientDetails.driverOnSpotPhoto': photoPath } // Saves driver's live on-spot photo
        }, { new: true });

        res.json({ success: true, message: "On-spot photo saved successfully", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- 3. UPDATE FINALIZE HANDOFF (Fully Dynamic Telemetry) ---
// Path: controllers/ambulance/BookingAmb.js
// Updated: Replaced hardcoded "8.4 km" & "15 mins" with dynamic GPS distance and actual ride time calculations
const finalizeTripHandoff = async (req, res) => {
    try {
        const { id } = req.params; 
        const { doctorName, wardName, duration, reason, totalDistance, travelTime } = req.body; 

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query).populate('hospitalId');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        const now = new Date();

        let dynamicTravelTime = travelTime;
        if (!dynamicTravelTime) {
            const pickupEvent = booking.trackingTimeline?.find(t => t.status === 'Patient pickup confirmed' || t.status === 'Picked-Up');
            if (pickupEvent && pickupEvent.timestamp) {
                const diffMinutes = Math.max(1, Math.round((now - new Date(pickupEvent.timestamp)) / 60000));
                dynamicTravelTime = `${diffMinutes} mins`;
            } else {
                dynamicTravelTime = duration || "Direct Transit";
            }
        }

        let dynamicDistance = totalDistance;
        if (!dynamicDistance && booking.pickupLocation?.lat && booking.hospitalId?.location?.lat) {
            const { getDistance } = require('../../utils/helpers');
            const dist = await getDistance(
                booking.pickupLocation.lat, 
                booking.pickupLocation.lng, 
                booking.hospitalId.location.lat, 
                booking.hospitalId.location.lng
            );
            dynamicDistance = dist > 0 ? `${dist.toFixed(1)} km` : "At Destination";
        }

        booking.handoffDetails = {
            doctorName: doctorName || "Duty Staff",
            wardName: wardName || "Emergency / Reception",
            duration: duration || dynamicTravelTime,
            reasonAtHandoff: reason || "Handoff completed",
            completedAt: now,
            totalDistance: dynamicDistance || "N/A",
            travelTime: dynamicTravelTime
        };

        booking.status = 'Delivered';
        await booking.save();

        // Release ambulance driver back to available state
        if (booking.ambulanceId) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { 
                $set: { availableForEmergency: true } 
            });
        }

        // 🚀 SYNC FIX: Transfer handoff wardName, doctorName, and reason into Hospital Admission record
        if (booking.bookingId) {
            const appointment = await Appointment.findOne({ transactionId: booking.bookingId });
            if (appointment) {
                const targetStatus = appointment.bedId ? 'In-Progress' : 'Hospital-Pending';
                
                appointment.status = targetStatus;
                appointment.wardName = appointment.wardName || wardName;
                appointment.tracking.status = 'Admitted/Dropped to Hospital';
                appointment.tracking.rideEndTime = now;
                
                if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
                appointment.clinicalSummary.admissionNote = `Admitted via Ambulance #${booking.bookingId}. Handoff to Dr. ${doctorName || 'Duty Physician'} (${wardName || 'Emergency'}). Notes: ${reason || 'Stable at handoff'}`;
                
                await appointment.save();
            }
        }

        res.json({ 
            success: true, 
            message: "Trip Finalized, Driver Released & Hospital Admission Synced successfully.", 
            data: booking 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// --- 1. VERIFY OTP (Figma Screen 36) ---
const verifyPickupOtp = async (req, res) => {
    try {
        const { id } = req.params; 
        const { otp, idToken } = req.body; 

        // 🚀 SYNC FIX: Safe Hybrid ID lookup (supports both Mongo _id and custom bookingId string)
        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query).populate('userId', 'phone');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        // 1. ACCIDENTAL EMERGENCY: NO OTP REQUIRED
        if (booking.serviceType === 'Accident emergency') {
            booking.isOtpVerified = true;
            booking.status = 'Picked-Up';
            booking.otp = null;
            
            booking.trackingTimeline.push({ 
                status: 'Patient pickup confirmed', 
                timestamp: new Date(),
                note: "Emergency accident patient onboarded directly by driver without OTP."
            });
            
            await booking.save();

            // 🚀 SYNC FIX: Sync status to linked Appointment model
            if (booking.bookingId) {
                await Appointment.findOneAndUpdate(
                    { transactionId: booking.bookingId },
                    { $set: { 'tracking.isOtpVerified': true, 'tracking.status': 'Picked-Up' } }
                );
            }

            return res.json({ 
                success: true, 
                message: "Accident victim onboarded successfully without OTP. Start Navigation to Hospital!", 
                data: booking 
            });
        }

        // 2. MEDICAL & REFERRAL: 6-DIGIT OTP VERIFICATION
        const patientPhone = booking.patientDetails?.phone || booking.userId?.phone;
        const cleanPatientPhone = patientPhone ? String(patientPhone).replace(/\D/g, "").slice(-10) : "";

        if (idToken && idToken.trim() !== "") {
            const verification = await verifyFirebasePhoneToken(idToken, cleanPatientPhone);
            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        } else if (otp) {
            const savedOtp = String(booking.otp || "").trim();
            const incomingOtp = String(otp).trim();

            if (!savedOtp || savedOtp !== incomingOtp) {
                return res.status(400).json({ success: false, message: "Invalid Pickup OTP. Please collect valid 6-digit OTP from patient." });
            }
        } else {
            return res.status(400).json({ success: false, message: "6-Digit Pickup OTP is required for Medical/Referral transit." });
        }

        booking.isOtpVerified = true;
        booking.status = 'Picked-Up';
        booking.otp = null;
        
        booking.trackingTimeline.push({ 
            status: 'Patient pickup confirmed', 
            timestamp: new Date(),
            note: "Patient pickup verified via 6-digit OTP."
        });
        
        await booking.save();

        // 🚀 SYNC FIX: Sync status and OTP verification to linked Appointment model
        if (booking.bookingId) {
            await Appointment.findOneAndUpdate(
                { transactionId: booking.bookingId },
                { $set: { 'tracking.isOtpVerified': true, 'tracking.status': 'Picked-Up' } }
            );
        }

        res.json({ 
            success: true, 
            message: "Pickup verified successfully! Start Navigation to Hospital.", 
            data: booking 
        });

    } catch (error) { 
        console.error("Pickup verification error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- STRICT ID SANITIZER FOR CONSOLE (Crash Prevention) ---
const sanitizeObjectId = (id) => {
    if (id && id !== 'null' && id !== 'undefined' && mongoose.Types.ObjectId.isValid(id)) {
        return id;
    }
    return null;
};

// --- DYNAMIC RE-ROUTE (Strict Hospital Swap & Record Transfer) ---
const reRouteAmbulance = async (req, res) => {
    try {
        const { id } = req.params;
        const { newHospitalId, reason } = req.body;

        const cleanBookingId = sanitizeObjectId(id);
        const cleanNewHospitalId = sanitizeObjectId(newHospitalId);

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Transit booking not found." });
        }

        if (!cleanNewHospitalId) {
            return res.status(400).json({ success: false, message: "Valid target Hospital ID is required for re-routing." });
        }

        // Protocol Check
        if (booking.serviceType !== 'Accident emergency') {
            return res.status(400).json({ 
                success: false, 
                message: `Re-routing is strictly restricted to 'Accident emergency' cases only. Pre-scheduled '${booking.serviceType}' destination hospital cannot be altered in transit.` 
            });
        }

        if (!['Confirmed', 'Picked-Up', 'En-Route'].includes(booking.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot re-route ambulance in current status '${booking.status}'. Re-routing is only allowed during active transit.`
            });
        }

        const oldHospitalId = booking.hospitalId;
        const oldHospital = oldHospitalId ? await Hospital.findById(oldHospitalId) : null;
        const newHospital = await Hospital.findById(cleanNewHospitalId);

        if (!newHospital) {
            return res.status(404).json({ success: false, message: "New target hospital not found in database." });
        }

        booking.hospitalId = cleanNewHospitalId;
        booking.trackingTimeline.push({
            status: 'Re-Routed',
            timestamp: new Date(),
            note: `Emergency Re-routed from ${oldHospital ? oldHospital.name : 'Unassigned/Spot'} to ${newHospital.name}. Reason: ${reason || 'Traffic congestion / Clinical emergency decision'}`
        });
        await booking.save();

        // Swap Hospital Pre-Admission File
        const activeAdmission = await Appointment.findOne({ 
            transactionId: booking.bookingId,
            status: 'Hospital-Pending'
        });

        if (activeAdmission) {
            activeAdmission.hospitalId = cleanNewHospitalId;
            await activeAdmission.save();

            if (oldHospitalId) {
                await notifyAdminsAndVendor(
                    oldHospitalId,
                    'hospital',
                    "ℹ️ Emergency Case Diverted",
                    `Incoming patient from Ambulance #${booking.bookingId} has been diverted to another facility due to: ${reason || 'Route obstruction'}.`
                );
            }

            await notifyAdminsAndVendor(
                cleanNewHospitalId,
                'hospital',
                "🚨 Emergency Case Diverted to You!",
                `An incoming trauma patient from Ambulance #${booking.bookingId} has been re-routed to your facility. Reason: ${reason || 'Emergency Re-route'}`,
                { appointmentId: activeAdmission._id.toString(), type: 'emergency_re_routed' }
            );
        }

        // 🚀 SYNC FIX: Notify Patient & Family about Emergency Diversion
        if (booking.userId) {
            await sendPushNotification(
                booking.userId,
                'user',
                "🚨 Ambulance Route Diverted to Nearest Hospital",
                `Ambulance #${booking.bookingId} is re-routed to ${newHospital.name} due to: ${reason || 'Traffic obstruction'}. Tracking updated.`,
                { bookingId: booking._id.toString(), hospitalName: newHospital.name, type: 'emergency_re_routed' }
            );
        }

        res.json({ 
            success: true, 
            message: `Emergency successfully re-routed to ${newHospital.name}. Pre-arrival admission file transferred.`, 
            data: booking 
        });

    } catch (error) {
        console.error("Re-route API error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



// --- 7. GET DRIVER DASHBOARD COUNTS (NEW API - Figma Screen 1/2) ---
const getDriverDashboardStats = async (req, res) => {
    try {
        const driverId = req.user.id;
        const driverObjId = new mongoose.Types.ObjectId(driverId);

        const [stats, reviews, totalTrips, driverProfile] = await Promise.all([
            // 🚀 SYNC FIX: Pure 3-types aggregation without Quick Response remnant
            Booking.aggregate([
                { $match: { ambulanceId: driverObjId } },
                { $group: {
                    _id: null,
                    emergency: { $sum: { $cond: [{ $eq: ["$serviceType", "Accident emergency"] }, 1, 0] } },
                    medical: { $sum: { $cond: [{ $eq: ["$serviceType", "Medical Ambulance"] }, 1, 0] } },
                    referral: { $sum: { $cond: [{ $eq: ["$serviceType", "Referral Ambulance"] }, 1, 0] } }
                }}
            ]),
            Review.find({ targetId: driverObjId, targetType: 'Ambulance' }).select('rating').lean(),
            Booking.countDocuments({ ambulanceId: driverId, status: 'Delivered' }),
            Ambulance.findById(driverId).select('averageRating totalReviews').lean()
        ]);

        let averageRating = driverProfile?.averageRating > 0 ? driverProfile.averageRating : 5.0;
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            averageRating = Number((totalRating / reviews.length).toFixed(1));
        }

        const counts = stats[0] || { emergency: 0, medical: 0, referral: 0 };

        res.json({
            success: true,
            data: {
                emergencyTrips: counts.emergency, // Accidental SOS trips
                medicalTrips: counts.medical,     // Medical Ambulance trips
                referralTrips: counts.referral,   // Referral Ambulance trips
                totalTrips: totalTrips,           // Delivered trips
                rating: averageRating,
                totalReviews: reviews.length || driverProfile?.totalReviews || 0
            }
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
            status: { $in: ['Delivered', 'Cancelled'] }
        })
        .populate('userId', 'name phone profilePic')
        .populate('hospitalId', 'name address location')
        .populate('pickupHospitalId', 'name address location') // 🚀 SYNC FIX: Populates origin hospital for referrals!
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

// --- 1. ARRIVED AT DROP-OFF (Figma Screen 12 - Generate Hospital OTP) ---
const arrivedAtDropOff = async (req, res) => {
    try {
        const { id } = req.params;
        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query).populate('hospitalId', 'fcmToken name');
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        // 🚀 SYNC FIX: Guard against null hospital in unallocated accidental trips
        if (!booking.hospitalId) {
            return res.status(400).json({ 
                success: false, 
                message: "No destination hospital is linked to this trip. Please allocate a destination hospital first." 
            });
        }

        // Dynamic 6-Digit Handover OTP
        const dynamicHospitalOtp = Math.floor(100000 + Math.random() * 900000).toString();
        booking.dropOffOtp = dynamicHospitalOtp;
        booking.status = 'Arrived'; 
        
        booking.trackingTimeline.push({
            status: 'Arrived at Dropoff',
            timestamp: new Date(),
            note: `Ambulance reached destination hospital (${booking.hospitalId.name}). Handover OTP: ${dynamicHospitalOtp}`
        });

        await booking.save();

        await sendPushNotification(
            booking.hospitalId._id,
            'hospital',
            "Ambulance Arrived at Emergency Gate! 🏥",
            `Ambulance #${booking.bookingId} has arrived. Provide Handover OTP: ${dynamicHospitalOtp} to driver.`,
            { bookingId: booking._id.toString(), otp: dynamicHospitalOtp, type: 'ambulance_handover' }
        );

        res.json({ 
            success: true, 
            message: `Arrived at destination hospital (${booking.hospitalId.name}). Handover OTP sent to emergency desk.`,
            debugOtp: process.env.NODE_ENV === 'production' ? undefined : dynamicHospitalOtp
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 2. VERIFY DROP-OFF OTP (Figma Screen 14 - Handover Verification) ---
const verifyDropOffOtp = async (req, res) => {
    try {
        const { id } = req.params;
        const { otp } = req.body;

        if (!otp) {
            return res.status(400).json({ success: false, message: "Hospital Handover OTP is required." });
        }

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        const savedOtp = String(booking.dropOffOtp || "").trim();
        const incomingOtp = String(otp).trim();

        // Strict Check
        if (!savedOtp || savedOtp !== incomingOtp) {
            return res.status(400).json({ success: false, message: "Invalid Hospital Handover OTP. Please verify with emergency desk." });
        }

        booking.isDropOffVerified = true;
        // 🚀 SYNC FIX: Status remains 'Arrived' (Ready for final handoff) instead of rolling back to 'En-Route'
        booking.status = 'Arrived'; 
        booking.dropOffOtp = null; // Invalidate OTP after use
        
        booking.trackingTimeline.push({
            status: 'Dropoff OTP Verified',
            timestamp: new Date(),
            note: "Hospital staff confirmed patient arrival via 6-digit Handover OTP. Handoff ready."
        });

        await booking.save();
        res.json({ 
            success: true, 
            message: "Handover OTP Verified. Please complete the Handoff Form.", 
            data: booking 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// BREAKDOWN SOS TRIGGER (Broadcast Pool Auto-Reopen Sync)
const triggerAmbulanceSos = async (req, res) => {
    try {
        const { id } = req.params;
        const { sosType, lat, lng } = req.body; 

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOne(query);
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        booking.trackingTimeline.push({
            status: 'SOS Alert',
            timestamp: new Date(),
            note: `Driver triggered SOS: ${sosType}. Coordinates: [Lat: ${lat || 'N/A'}, Lng: ${lng || 'N/A'}]`
        });

        // BREAKDOWN LOGIC: Auto-reopen broadcast pool for other ambulances
        if (sosType === 'Vehicle Breakdown') {
            const oldDriverId = booking.ambulanceId;
            booking.rejectedBy = booking.rejectedBy || [];
            if (oldDriverId) booking.rejectedBy.push(oldDriverId);

            booking.ambulanceId = null;
            booking.status = 'Searching'; // Reopen for all nearby drivers

            if (oldDriverId) {
                await Ambulance.findByIdAndUpdate(oldDriverId, {
                    $set: { availableForEmergency: false, isOnline: false }
                });
            }

            // 🚀 SYNC FIX 1: Notify the Patient/User immediately
            if (booking.userId) {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "⚠️ Ambulance Breakdown Alert",
                    "Assigned ambulance reported vehicle breakdown. Re-dispatching nearest replacement ambulance immediately.",
                    { bookingId: booking._id.toString(), type: 'ambulance_breakdown_redispatch' }
                );
            }

            // 🚀 SYNC FIX 2: Update Hospital Pre-admission file
            if (booking.bookingId) {
                await Appointment.findOneAndUpdate(
                    { transactionId: booking.bookingId },
                    { $set: { ambulanceId: null, 'tracking.status': 'Vehicle Breakdown - Re-dispatching' } }
                );
            }
        }

        await booking.save();

        // Alert Control Room & Admins
        await notifyAdminsAndVendor(
            null,
            'admin',
            `🚨 AMBULANCE EMERGENCY SOS: ${sosType}!`,
            `Ambulance #${booking.bookingId} reported ${sosType} at Lat: ${lat || 'N/A'}, Lng: ${lng || 'N/A'}. Action required.`,
            { bookingId: booking._id.toString(), type: 'ambulance_sos_alert' }
        );

        res.json({ 
            success: true, 
            message: `${sosType} logged. Ride reopened in broadcast pool, User & Control Room alerted.`,
            data: booking 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 2. CHANGE PASSWORD (NEW: Profile Modal Screen) ---
const changeDriverPassword = async (req, res) => {
    try {
        const driverId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        const driver = await Ambulance.findById(driverId).select('+password');
        if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

        // Verify Old Password
        const isMatch = await bcrypt.compare(oldPassword, driver.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        // Hash and Save New Password
        driver.password = await bcrypt.hash(newPassword, 10);
        await driver.save();

        res.json({ success: true, message: "Password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. GET DYNAMIC NOTIFICATIONS (NEW: Figma Screen 4/5 Notifications List) ---
const getDriverNotifications = async (req, res) => {
    try {
        const driverId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 15;

        const notifications = await DriverNotification.find({ driverId })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await DriverNotification.countDocuments({ driverId });

        res.json({
            success: true,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: notifications
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. MARK ALL NOTIFICATIONS AS READ (Figma Checkmark icon) ---
const markAllNotificationsAsRead = async (req, res) => {
    try {
        const driverId = req.user.id;
        await DriverNotification.updateMany({ driverId, isRead: false }, { $set: { isRead: true } });
        res.json({ success: true, message: "All notifications marked as read." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const reportAmbulanceNoShow = async (req, res) => {
    try {
        const { bookingId, comments } = req.body;
        const driverId = req.user.id; 

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(bookingId) : new mongoose.Types.ObjectId() },
                { bookingId }
            ],
            ambulanceId: driverId,
            status: 'Arrived'
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Booking must be in 'Arrived' state to report a No-Show." 
            });
        }

        // 🚀 SYNC FIX: Exactly 3 booking types mapped to NoShow policy
        const serviceTypeToVendorMap = {
            'Accident emergency': 'Ambulance-Accident',
            'Medical Ambulance': 'Ambulance-Medical',
            'Referral Ambulance': 'Ambulance-Referral'
        };
        const targetVendorType = serviceTypeToVendorMap[booking.serviceType] || 'Ambulance-Medical';

        const totalPaid = booking.pricing?.total || 0;
        let noShowFee = 0;

        const config = await NoShowConfig.findOne({ vendorType: targetVendorType, isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage' 
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        booking.status = 'Cancelled';
        booking.cancelledBy = 'Driver';
        booking.cancellationReason = comments || "Ambulance Driver arrived on spot but customer was unreachable.";
        if (!booking.pricing) booking.pricing = {};
        booking.pricing.noShowFeeApplied = noShowFee;
        booking.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';

        booking.trackingTimeline.push({
            status: 'No-Show',
            timestamp: new Date(),
            note: `Ambulance driver reported spot No-Show. Penalty applied: ₹${noShowFee}.`
        });

        // Release driver back to Available
        await Ambulance.findByIdAndUpdate(driverId, { $set: { availableForEmergency: true } });
        await booking.save();

        // Credit No-Show Penalty to Driver's Wallet
        if (noShowFee > 0) {
            await creditVendorCompensation(driverId, 'Ambulance', noShowFee, booking.bookingId, 'No-Show Fee');
        }

        // Sync Hospital Pre-Admission cancel status
        if (booking.bookingId) {
            await Appointment.findOneAndUpdate(
                { transactionId: booking.bookingId },
                { $set: { status: 'No-Show', 'tracking.status': 'No-Show' } }
            );
        }

        res.json({ 
            success: true, 
            message: `Spot No-Show logged. ₹${noShowFee} credited to your driver wallet.`, 
            noShowFeeApplied: noShowFee,
            data: booking
        });
    } catch (error) {
        console.error("No-Show Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {getMyActiveTrip,getDriverReferralCases,getSystemCms, getIncomingRequests, acceptBooking, updateTripStatus, uploadIncidentPhoto,
    finalizeTripHandoff,verifyPickupOtp, arrivedAtDropOff, verifyDropOffOtp, triggerAmbulanceSos,
    rejectBooking, reRouteAmbulance,getDriverDashboardStats,
    getDriverTripHistory, changeDriverPassword, getDriverNotifications, markAllNotificationsAsRead, reportAmbulanceNoShow
 };