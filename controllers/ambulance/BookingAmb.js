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



// 1. GET DRIVER CURRENT ACTIVE TRIP (Strict Live Trip vs Future Scheduled Filter)
// Endpoint: GET /ambulance/booking/active-trip
const getMyActiveTrip = async (req, res) => {
    try {
        const driverId = req.user.id;
        const now = new Date();
        const twoHoursLater = moment().add(2, 'hours').toDate();

        // 🚨 CRITICAL FIX: Only return trips that are ongoing right now or starting within 2 hours
        const activeTrip = await Booking.findOne({
            ambulanceId: driverId,
            $or: [
                // In-transit stages are always active
                { status: { $in: ['Arrived', 'Picked-Up', 'En-Route'] } },
                // Confirmed instant SOS or scheduled trips within current 2-hour window
                { 
                    status: 'Confirmed',
                    $or: [
                        { serviceType: 'Accident emergency' },
                        { scheduledAt: { $lte: twoHoursLater } }
                    ]
                }
            ]
        })
        .populate('userId', 'name phone profilePic')
        .populate('hospitalId', 'name address location')
        .populate('pickupHospitalId', 'name address location')
        .sort({ scheduledAt: 1 })
        .lean();

        res.json({ 
            success: true, 
            hasActiveTrip: !!activeTrip,
            data: activeTrip || null 
        });
    } catch (error) {
        console.error("Get Active Trip Error:", error);
        res.status(500).json({ success: false, message: error.message });
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

// 1. GET INCOMING REQUESTS (Filtered by Driver Proximity Radius)
// Endpoint: GET /ambulance/booking/requests
const getIncomingRequests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const driverId = req.user.id;

        const driver = await Ambulance.findById(driverId).lean();
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver not found." });
        }

        const driverLat = driver.location?.lat || 0;
        const driverLng = driver.location?.lng || 0;
        const maxRadius = parseInt(driver.serviceRadius) || 15; // Default 15km

        // 1. Query all relevant candidate bookings
        const candidateBookings = await Booking.find({
            $or: [
                {
                    serviceType: 'Accident emergency',
                    status: 'Searching',
                    rejectedBy: { $nin: [driver._id] }
                },
                {
                    ambulanceId: driver._id,
                    status: 'Confirmed',
                    $or: [
                        { paymentMethod: 'COD' },
                        { paymentStatus: 'Paid' }
                    ]
                }
            ]
        })
        .sort({ createdAt: -1 })
        .populate('userId', 'name phone profilePic')
        .populate('pickupHospitalId', 'name address')
        .populate('hospitalId', 'name address')
        .lean();

        // 2. Filter accidental emergency broadcasts within driver's radius
        const filteredRequests = [];

        for (let booking of candidateBookings) {
            if (booking.serviceType === 'Accident emergency') {
                if (driverLat && driverLng && booking.pickupLocation?.lat) {
                    const dist = await getDistance(
                        driverLat, 
                        driverLng, 
                        booking.pickupLocation.lat, 
                        booking.pickupLocation.lng
                    );
                    if (dist <= maxRadius) {
                        filteredRequests.push({ ...booking, distanceToPickup: `${dist.toFixed(1)} km` });
                    }
                } else {
                    filteredRequests.push(booking);
                }
            } else {
                // Targeted rides assigned to this driver always included
                filteredRequests.push(booking);
            }
        }

        // Pagination slice
        const skip = (page - 1) * limit;
        const paginatedData = filteredRequests.slice(skip, skip + limit);

        res.json({
            success: true,
            count: paginatedData.length,
            totalAvailable: filteredRequests.length,
            page,
            data: paginatedData
        });

    } catch (error) { 
        console.error("Get Incoming Requests Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 2. ACCEPT REQUEST (Figma Screen 35) ---
const acceptBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const ambulanceId = req.user.id;

        const driver = await Ambulance.findById(ambulanceId);
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        }

        // 1. Check if driver is already on another active ride
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
        
        // 🚨 CRITICAL FIX: Wrapped inside $and to prevent duplicate $or key overwrite!
        const query = {
            $and: [
                {
                    $or: [
                        { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                        { bookingId: String(id).trim() }
                    ]
                },
                {
                    $or: [
                        { status: 'Searching' },
                        { status: 'Confirmed', ambulanceId: driver._id }
                    ]
                }
            ]
        };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(400).json({ 
                success: false, 
                message: "This trip is no longer available or was already claimed by another driver." 
            });
        }

        const isAccidental = (booking.serviceType === 'Accident emergency');
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

        // 2. Hospital Pre-Admission Auto-Sync
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



// --- 3. REJECT REQUEST (With Online Refund & Benefit Sync) ---
const rejectBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, comments } = req.body; 
        const driverId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query); 
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        booking.rejectedBy = booking.rejectedBy || [];
        if (!booking.rejectedBy.includes(driverId)) {
            booking.rejectedBy.push(driverId);
        }

        // Accidental SOS: Re-open broadcast pool for other ambulances
        if (booking.serviceType === 'Accident emergency') {
            booking.ambulanceId = null;
            booking.status = 'Searching';
            booking.trackingTimeline.push({ 
                status: 'Driver Passed', 
                timestamp: new Date(), 
                note: `Driver ${req.user.name || ''} passed ride (${reason || 'Busy'}). Searching next nearest ambulance.` 
            });
        } else {
            // Targeted Medical / Referral: Mark Cancelled & Trigger Refund
            booking.status = 'Cancelled';
            booking.cancelledBy = 'Driver';
            booking.cancellationReason = `${reason || 'Driver Unavailable'}. Comments: ${comments || 'None'}`;
            
            // 🚨 REFUND SYNC: If patient paid online, move to refund queue
            if (booking.paymentStatus === 'Paid') {
                booking.paymentStatus = 'Refund-Initiated';
            }

            // 🚨 SUBSCRIPTION REFUND: Return benefit count to user
            if (booking.subscriptionDetails?.isSubscriptionApplied) {
                const { refundBenefitCount } = require('../../utils/subscriptionBenefitHelper');
                await refundBenefitCount(booking.userId, 'freeAmbulanceTripsCount');
            }

            booking.trackingTimeline.push({ 
                status: 'Cancelled by Driver', 
                timestamp: new Date(), 
                note: `Selected driver unavailable: ${reason || 'Busy'}.` 
            });

            await sendPushNotification(
                booking.userId, 
                'user', 
                "Ambulance Driver Unavailable", 
                "The selected ambulance is unavailable. Any paid amount has been initiated for refund.",
                { bookingId: booking._id.toString(), type: 'request_rejected' }
            );

            // Cancel linked pre-admission Appointment in hospital
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

// 2. UPDATE TRIP STATUS (With Live Hospital Trauma Room Sync)
// Endpoint: PATCH /ambulance/booking/update-trip/:id
const updateTripStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, patientCondition, hospitalId } = req.body; 

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query);
        if (!booking) return res.status(404).json({ success: false, message: "Trip not found." });

        if (status) booking.status = status;
        if (patientCondition) {
            booking.patientDetails = booking.patientDetails || {};
            booking.patientDetails.condition = patientCondition;
        }

        // Hospital allocation for Accidental emergency en-route
        if (status === 'En-Route' && hospitalId) {
            booking.hospitalId = hospitalId;
        }

        booking.trackingTimeline.push({ 
            status: status || booking.status, 
            timestamp: new Date(),
            note: note || `Ambulance status updated to '${status}'. Patient Condition: ${patientCondition || 'Stable'}`
        });

        if (status === 'Delivered') {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { 
                $set: { availableForEmergency: true, isOnline: true } 
            });
        }

        await booking.save();

        // 🚨 CRITICAL HOSPITAL TRAUMA ROOM PRE-SYNC:
        if (booking.bookingId) {
            const updateFields = { 'tracking.status': status };
            if (status === 'Delivered') {
                updateFields.status = 'In-Progress'; // Patient physically in emergency ward
            }

            // Sync updated patient condition into Hospital Appointment
            if (patientCondition) {
                updateFields['clinicalSummary.triagePriority'] = patientCondition;
                updateFields['clinicalSummary.admissionNote'] = `Live In-Transit Update: Patient condition reported as '${patientCondition}' by Ambulance Driver.`;
            }

            await Appointment.findOneAndUpdate(
                { transactionId: booking.bookingId },
                { $set: updateFields }
            );

            // Notify destination hospital if condition becomes Critical
            if (booking.hospitalId && (patientCondition === 'Critical' || patientCondition === 'Deteriorating')) {
                try {
                    await notifyAdminsAndVendor(
                        booking.hospitalId,
                        'hospital',
                        "⚠️ CRITICAL TRAUMA PATIENT INCOMING!",
                        `Ambulance #${booking.bookingId} reported patient condition as '${patientCondition}'. Prepare emergency resuscitation & trauma team.`,
                        { bookingId: booking._id.toString(), type: 'emergency_critical_incoming' }
                    );
                } catch (e) {}
            }
        }

        res.json({ 
            success: true, 
            message: `Trip status updated to '${status}'. Hospital trauma room synchronized.`, 
            data: booking 
        });

    } catch (error) { 
        console.error("Update Trip Status Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 2. UPLOAD DRIVER ON-SPOT PHOTO (Fixed Hybrid ID Resolver) ---
// Endpoint: POST /ambulance/booking/incident-photo/:id
const uploadIncidentPhoto = async (req, res) => {
    try {
        const { id } = req.params; 
        const files = req.files || {};
        
        const photoPath = files.incidentPhoto ? `/uploads/ambulances/${files.incidentPhoto[0].filename}` : null;
        if (!photoPath) {
            return res.status(400).json({ success: false, message: "No photo uploaded. Field key must be 'incidentPhoto'." });
        }

        // 🚨 FIXED: Hybrid query safely supports both Mongo _id and custom string bookingId
        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };
        
        const booking = await Booking.findOneAndUpdate(
            query, 
            { $set: { 'patientDetails.driverOnSpotPhoto': photoPath } }, 
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ success: false, message: "Ambulance booking record not found." });
        }

        res.json({ 
            success: true, 
            message: "On-spot accident scene photo saved successfully.", 
            data: booking 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};



// Updated: Replaced hardcoded "8.4 km" & "15 mins" with dynamic GPS distance and actual ride time calculations
// --- 5. FINALIZE TRIP HANDOFF (With Auto COD Paid Settlement & Subsidy Payout) ---
const finalizeTripHandoff = async (req, res) => {
    try {
        const { id } = req.params; 
        const { doctorName, wardName, duration, reason, totalDistance, travelTime } = req.body; 

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query).populate('hospitalId');
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

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
            duration: dynamicTravelTime,
            reasonAtHandoff: reason || "Handoff completed",
            completedAt: now,
            totalDistance: dynamicDistance || "N/A",
            travelTime: dynamicTravelTime
        };

        booking.status = 'Delivered';

        // 🚨 COD SETTLEMENT FIX: Mark payment as Paid upon verified handover
        if (booking.paymentMethod === 'COD' && booking.paymentStatus !== 'Paid') {
            booking.paymentStatus = 'Paid';
            if (!booking.paymentDetails) booking.paymentDetails = {};
            booking.paymentDetails.status = 'captured';
            booking.paymentDetails.paidAt = now;
            booking.paymentDetails.method = 'COD';
        }

        await booking.save();

        // Release driver back to Available
        if (booking.ambulanceId) {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { 
                $set: { availableForEmergency: true, isOnline: true } 
            });
        }

        // Sync Hospital Admission record to In-Progress
        if (booking.bookingId) {
            const appointment = await Appointment.findOne({ transactionId: booking.bookingId });
            if (appointment) {
                appointment.status = appointment.bedId ? 'In-Progress' : 'Hospital-Pending';
                appointment.wardName = appointment.wardName || wardName;
                appointment.tracking.status = 'Admitted/Dropped to Hospital';
                appointment.tracking.rideEndTime = now;
                
                if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
                appointment.clinicalSummary.admissionNote = `Admitted via Ambulance #${booking.bookingId}. Handoff to Dr. ${doctorName || 'Duty Physician'} (${wardName || 'Emergency'}).`;
                
                await appointment.save();
            }
        }

        res.json({ 
            success: true, 
            message: "Trip Finalized, Driver Released & Hospital Admission Synced successfully.", 
            data: booking 
        });
    } catch (error) { 
        console.error("Finalize Handoff Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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

// 1. RE-ROUTE AMBULANCE IN TRANSIT (With Pre-Admission Creation Fallback)
// Endpoint: PATCH /ambulance/booking/re-route/:id
const reRouteAmbulance = async (req, res) => {
    try {
        const { id } = req.params;
        const { newHospitalId, reason } = req.body;

        if (!newHospitalId || !mongoose.isValidObjectId(newHospitalId)) {
            return res.status(400).json({ success: false, message: "Valid target Hospital ID is required for re-routing." });
        }

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Transit booking not found." });
        }

        // Protocol Check: Only Accidental emergency allow real-time diversion
        if (booking.serviceType !== 'Accident emergency') {
            return res.status(400).json({ 
                success: false, 
                message: "Re-routing is strictly restricted to 'Accident emergency' cases only." 
            });
        }

        if (!['Confirmed', 'Picked-Up', 'En-Route', 'Searching'].includes(booking.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot re-route ambulance in current status '${booking.status}'.`
            });
        }

        const oldHospitalId = booking.hospitalId;
        const oldHospital = oldHospitalId ? await Hospital.findById(oldHospitalId).lean() : null;
        const newHospital = await Hospital.findById(newHospitalId).lean();

        if (!newHospital) {
            return res.status(404).json({ success: false, message: "New target hospital not found." });
        }

        booking.hospitalId = newHospital._id;
        booking.trackingTimeline.push({
            status: 'Re-Routed',
            timestamp: new Date(),
            note: `Emergency Re-routed to ${newHospital.name}. Reason: ${reason || 'Clinical decision / Route diversion'}`
        });
        await booking.save();

        // 🚨 PRE-ADMISSION FILE TRANSFER OR FRESH CREATION FIX:
        let activeAdmission = await Appointment.findOne({ 
            transactionId: booking.bookingId 
        });

        if (activeAdmission) {
            // Case A: Transfer existing file to new hospital
            activeAdmission.hospitalId = newHospital._id;
            activeAdmission.status = 'Hospital-Pending';
            if (!activeAdmission.clinicalSummary) activeAdmission.clinicalSummary = {};
            activeAdmission.clinicalSummary.admissionNote = `Diverted from ${oldHospital?.name || 'Spot'} to ${newHospital.name}. Reason: ${reason || 'Emergency Re-route'}`;
            await activeAdmission.save();
        } else {
            // Case B: Create fresh admission file if it was not assigned initially
            const hospitalBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            activeAdmission = await Appointment.create({
                userId: booking.userId,
                hospitalId: newHospital._id,
                ambulanceId: booking.ambulanceId,
                bookingType: 'Admission',
                bedBookingType: 'Emergency-Bed',
                status: 'Hospital-Pending',
                bookingId: hospitalBookingId,
                transactionId: booking.bookingId,
                triageLevel: 'Emergency',
                patients: [{
                    patientName: booking.patientDetails?.name || "Accident Victim",
                    patientAge: booking.patientDetails?.age || 30,
                    gender: booking.patientDetails?.gender || "Male",
                    reasonForVisit: `Accident Emergency Re-route (${reason || 'Trauma Care'})`
                }],
                startDate: new Date(),
                pricingBreakdown: { baseFee: 0, subtotal: 0 },
                totalAmount: 0
            });
        }

        // Notify Old Hospital (Diverted away)
        if (oldHospitalId) {
            try {
                await notifyAdminsAndVendor(
                    oldHospitalId,
                    'hospital',
                    "ℹ️ Emergency Case Diverted",
                    `Incoming patient from Ambulance #${booking.bookingId} has been diverted to ${newHospital.name}. Reason: ${reason || 'Route diversion'}`
                );
            } catch (e) {}
        }

        // Notify New Destination Hospital (Incoming Patient Alert)
        try {
            await notifyAdminsAndVendor(
                newHospital._id,
                'hospital',
                "🚨 Incoming Emergency Diverted to You!",
                `Incoming trauma patient from Ambulance #${booking.bookingId} is en-route. Prepare emergency ward.`,
                { appointmentId: activeAdmission._id.toString(), type: 'emergency_re_routed' }
            );
        } catch (e) {}

        // Notify Patient & Family
        if (booking.userId) {
            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "🚨 Ambulance Diverted to Hospital",
                    `Ambulance #${booking.bookingId} has been re-routed to ${newHospital.name}. Tracking updated.`,
                    { bookingId: booking._id.toString(), hospitalName: newHospital.name, type: 'emergency_re_routed' }
                );
            } catch (e) {}
        }

        res.json({ 
            success: true, 
            message: `Emergency successfully re-routed to ${newHospital.name}. Pre-admission file synced.`, 
            data: booking 
        });

    } catch (error) {
        console.error("Re-route API error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};




// --- 1. GET DRIVER DASHBOARD STATS (Strict Delivered Trips Filter) ---
// Endpoint: GET /ambulance/booking/dashboard-stats
const getDriverDashboardStats = async (req, res) => {
    try {
        const driverId = req.user.id;
        const driverObjId = new mongoose.Types.ObjectId(driverId);

        const [stats, reviews, totalTrips, driverProfile] = await Promise.all([
            // 🚨 FIXED: Only count DELIVERED trips to avoid inflating with cancelled/searching requests
            Booking.aggregate([
                { 
                    $match: { 
                        ambulanceId: driverObjId,
                        status: 'Delivered'
                    } 
                },
                { 
                    $group: {
                        _id: null,
                        emergency: { $sum: { $cond: [{ $eq: ["$serviceType", "Accident emergency"] }, 1, 0] } },
                        medical: { $sum: { $cond: [{ $eq: ["$serviceType", "Medical Ambulance"] }, 1, 0] } },
                        referral: { $sum: { $cond: [{ $eq: ["$serviceType", "Referral Ambulance"] }, 1, 0] } }
                    }
                }
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
                emergencyTrips: counts.emergency, // Accidental SOS completed
                medicalTrips: counts.medical,     // Medical completed
                referralTrips: counts.referral,   // Referral completed
                totalTrips: totalTrips,           // Grand total completed
                rating: averageRating,
                totalReviews: reviews.length || driverProfile?.totalReviews || 0
            }
        });
    } catch (error) {
        console.error("Driver Stats Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// 2. GET DRIVER COMPLETED TRIPS HISTORY (With Multi-Filter & Pagination)
// Endpoint: GET /ambulance/booking/history
// =========================================================================
const getDriverTripHistory = async (req, res) => {
    try {
        const driverId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const skip = (page - 1) * limit;

        const { status, serviceType } = req.query;

        // Base Query: Rides belonging to logged-in driver
        const query = { ambulanceId: driverId };

        // Status Filter: Default to Delivered & Cancelled history
        if (status && status !== 'All') {
            query.status = status;
        } else {
            query.status = { $in: ['Delivered', 'Cancelled'] };
        }

        // Service Type Filter
        if (serviceType && serviceType !== 'All') {
            query.serviceType = serviceType;
        }

        const [history, total] = await Promise.all([
            Booking.find(query)
                .populate('userId', 'name phone profilePic')
                .populate('hospitalId', 'name address location phone hospitalImage')
                .populate('pickupHospitalId', 'name address location phone hospitalImage')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Booking.countDocuments(query)
        ]);

        res.json({
            success: true,
            totalRecords: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            count: history.length,
            data: history
        });
    } catch (error) {
        console.error("Driver Trip History Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. ARRIVED AT DROP-OFF (With 1-Step Hospital Linking & Handover OTP)
// Endpoint: PATCH /ambulance/booking/arrived-dropoff/:id
// =========================================================================
const arrivedAtDropOff = async (req, res) => {
    try {
        const { id } = req.params;
        const { hospitalId } = req.body; // 👈 Allows driver to link hospital at gate in 1 step

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        // 🚨 1-STEP LINKING FIX: If hospital was not set earlier, link it now from request body
        if (!booking.hospitalId && hospitalId && mongoose.isValidObjectId(hospitalId)) {
            booking.hospitalId = hospitalId;
        }

        if (!booking.hospitalId) {
            return res.status(400).json({ 
                success: false, 
                message: "No destination hospital is linked to this trip. Please select destination hospital." 
            });
        }

        const hospital = await Hospital.findById(booking.hospitalId).select('name fcmToken').lean();
        if (!hospital) {
            return res.status(404).json({ success: false, message: "Destination hospital not found." });
        }

        // Generate Dynamic 6-Digit Handover OTP
        const dynamicHospitalOtp = Math.floor(100000 + Math.random() * 900000).toString();
        booking.dropOffOtp = dynamicHospitalOtp;
        booking.status = 'Arrived'; 
        
        booking.trackingTimeline.push({
            status: 'Arrived at Dropoff',
            timestamp: new Date(),
            note: `Ambulance reached destination hospital (${hospital.name}). Handover OTP: ${dynamicHospitalOtp}`
        });

        await booking.save();

        // Send push alert to Hospital Trauma Gate
        try {
            await sendPushNotification(
                booking.hospitalId,
                'hospital',
                "Ambulance Arrived at Emergency Gate! 🏥",
                `Ambulance #${booking.bookingId} has arrived. Provide Handover OTP: ${dynamicHospitalOtp} to driver.`,
                { bookingId: booking._id.toString(), otp: dynamicHospitalOtp, type: 'ambulance_handover' }
            );
        } catch (e) {}

        res.json({ 
            success: true, 
            message: `Arrived at destination hospital (${hospital.name}). Handover OTP sent to emergency desk.`,
            hospitalName: hospital.name,
            debugOtp: process.env.NODE_ENV === 'production' ? undefined : dynamicHospitalOtp
        });
    } catch (error) { 
        console.error("Arrived Dropoff Error:", error);
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

        const isObjectId = mongoose.isValidObjectId(id);
        const query = isObjectId ? { _id: id } : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query);
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        const savedOtp = String(booking.dropOffOtp || "").trim();
        const incomingOtp = String(otp).trim();

        if (!savedOtp || savedOtp !== incomingOtp) {
            return res.status(400).json({ success: false, message: "Invalid Hospital Handover OTP. Please verify with emergency desk." });
        }

        booking.isDropOffVerified = true;
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

// 2. GET DRIVER NOTIFICATIONS (With Unread Counter for Red Dot Badge)
// Endpoint: GET /ambulance/booking/notifications
const getDriverNotifications = async (req, res) => {
    try {
        const driverId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const skip = (page - 1) * limit;

        const [notifications, total, unreadCount] = await Promise.all([
            DriverNotification.find({ driverId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            DriverNotification.countDocuments({ driverId }),
            DriverNotification.countDocuments({ driverId, isRead: false }) // 👈 Unread badge counter
        ]);

        res.json({
            success: true,
            unreadCount,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: notifications
        });
    } catch (error) {
        console.error("Get Driver Notifications Error:", error);
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

// =========================================================================
// 3. GET SINGLE TRIP DETAILS (For Driver Summary Screen & History Modal)
// Endpoint: GET /ambulance/booking/details/:id
// =========================================================================
const getDriverBookingDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const driverId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            $and: [
                {
                    $or: [
                        { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                        { bookingId: String(id).trim() },
                        { caseReference: String(id).trim() }
                    ]
                },
                {
                    $or: [
                        { ambulanceId: new mongoose.Types.ObjectId(driverId) },
                        { status: 'Searching' } // Allow viewing incoming pool request details
                    ]
                }
            ]
        };

        const booking = await Booking.findOne(query)
            .populate('userId', 'name phone email profilePic gender dob')
            .populate('hospitalId', 'name address location phone hospitalImage')
            .populate('pickupHospitalId', 'name address location phone hospitalImage')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Trip details not found or unauthorized." });
        }

        res.json({
            success: true,
            data: booking
        });

    } catch (error) {
        console.error("Get Driver Booking Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {getMyActiveTrip,getDriverReferralCases,getSystemCms, getIncomingRequests, acceptBooking, updateTripStatus, uploadIncidentPhoto,
    finalizeTripHandoff,verifyPickupOtp, arrivedAtDropOff, verifyDropOffOtp, triggerAmbulanceSos, getDriverBookingDetails,
    rejectBooking, reRouteAmbulance,getDriverDashboardStats,
    getDriverTripHistory, changeDriverPassword, getDriverNotifications, markAllNotificationsAsRead, reportAmbulanceNoShow
 };