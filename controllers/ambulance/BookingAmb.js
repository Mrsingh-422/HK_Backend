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

        // Query logic: Driver strictly sees broadcast accidental emergencies OR requests targeted directly to them
        const requests = await Booking.find({ 
            status: 'Searching',
            $or: [
                { serviceType: 'Accident emergency' }, // Broadcast emergency
                { ambulanceId: driverId } // Directly requested to this driver
            ]
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'name phone profilePic');

        res.json({ success: true, page, data: requests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. ACCEPT REQUEST (Figma Screen 35) ---
const acceptBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const ambulanceId = req.user.id;

        const driver = await Ambulance.findById(ambulanceId);
        if (!driver.availableForEmergency) {
            return res.status(400).json({ success: false, message: "You are already on an active trip." });
        }

        const bookingCheck = await Booking.findOne({ _id: id, status: 'Searching' });
        if (!bookingCheck) {
            return res.status(400).json({ success: false, message: "This trip is no longer available." });
        }

        const isAccidental = bookingCheck.serviceType === 'Accident emergency';
        const timelineStatus = isAccidental ? 'Driver Assigned' : 'Accepted by Driver';
        const timelineNote = isAccidental 
            ? `${driver.name} has accepted your emergency request and is arriving shortly.`
            : `${driver.name} accepted your request. Waiting for payment to start navigation.`;

        // ATOMIC UPDATE
        const booking = await Booking.findOneAndUpdate(
            { _id: id, status: 'Searching' },
            {
                $set: { ambulanceId: ambulanceId, status: 'Confirmed' },
                $push: { trackingTimeline: { status: timelineStatus, timestamp: new Date(), note: timelineNote } }
            },
            { new: true }
        );

        if (!booking) {
            return res.status(400).json({ success: false, message: "This trip was just claimed by another driver." });
        }

        driver.availableForEmergency = false;
        await driver.save();

        // 🚨 PRE-ARRIVAL SHORT ADMISSION REGISTRATION FOR THE TARGET HOSPITAL
        // If hospital is already selected, create the pre-arrival record immediately
        if (booking.hospitalId) {
            const hospitalBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            
            await Appointment.create({
                userId: booking.userId,
                hospitalId: booking.hospitalId,
                ambulanceId: booking.ambulanceId,
                bookingType: 'Admission',
                bedBookingType: 'Emergency-Bed',
                status: 'Hospital-Pending', // Appears in Hospital's Pending List
                bookingId: hospitalBookingId,
                transactionId: booking.bookingId, // Map with ambulance booking reference
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

            // Trigger Notification to Destination Hospital (Figma Notification Screen)
            await notifyAdminsAndVendor(
                booking.hospitalId,
                'hospital',
                "🚨 New Incoming Emergency Case",
                `Trauma patient is arriving shortly via Ambulance #${booking.bookingId}. Prepare emergency ward.`,
                { bookingId: booking._id.toString(), type: 'incoming_emergency_case' }
            );
        }

        // Send Push Notifications to User
        if (isAccidental) {
            await sendPushNotification(booking.userId, 'user', "Emergency Driver Assigned!", `${driver.name} is arriving shortly. OTP is ${booking.otp}.`);
        } else {
            await sendPushNotification(booking.userId, 'user', "Ambulance Request Accepted", "Driver accepted! Please complete payment to start navigation.");
        }

        res.json({ success: true, message: "Ride accepted. Pre-arrival registration triggered.", data: booking });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- 3. REJECT REQUEST (Driver Rejection) ---
const rejectBooking = async (req, res) => {
    try {
        const { id } = req.params; // Booking Mongo ObjectId
        const { reason, comments } = req.body; 
        const driverId = req.user.id;

        // Figma Screen 11/Reject Modal Strict Validation
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

        const booking = await Booking.findById(id); 
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

        booking.status = 'Cancelled';
        booking.cancelledBy = 'Driver';
        booking.cancellationReason = `${reason}. Comments: ${comments || 'None'}`;
        
        booking.trackingTimeline.push({ 
            status: 'Cancelled', 
            timestamp: new Date(), 
            note: `Request rejected by driver. Reason: ${reason}` 
        });

        await booking.save();

        // Release Driver back to Available status
        await Ambulance.findByIdAndUpdate(driverId, { $set: { availableForEmergency: true } });

        // Notify User immediately
        await sendPushNotification(
            booking.userId, 
            'user', 
            "Ambulance Request Rejected", 
            "The driver is currently busy. Please select another ambulance.",
            { type: 'request_rejected' }
        );

        res.json({ success: true, message: "SOS Booking rejected successfully. User notified." });
    } catch (error) { 
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

        const booking = await Booking.findById(id).populate('hospitalId');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        const now = new Date();

        // 🚀 DYNAMIC TRAVEL TIME CALCULATION: Calculate real elapsed time since pickup
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

        // 🚀 DYNAMIC DISTANCE CALCULATION: Calculate GPS distance between pickup and dropoff hospital
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

        // Synchronize status change to linked Appointment
        if (booking.bookingId) {
            const appointment = await Appointment.findOne({ transactionId: booking.bookingId });
            if (appointment) {
                const targetStatus = appointment.bedId ? 'In-Progress' : 'Hospital-Pending';
                
                appointment.status = targetStatus;
                appointment.tracking.status = 'Admitted/Dropped to Hospital';
                appointment.tracking.rideEndTime = now;
                
                await appointment.save();
            }
        }

        res.json({ success: true, message: "Trip Finalized, Driver Released & Hospital Admission Synced successfully.", data: booking });
    } catch (error) { 
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
        const { id } = req.params; // Booking ID
        const { newHospitalId, reason } = req.body;

        // 1. Sanitize the Input IDs first to block CastErrors
        const cleanBookingId = sanitizeObjectId(id);
        const cleanNewHospitalId = sanitizeObjectId(newHospitalId);

        if (!cleanBookingId) {
            return res.status(400).json({ success: false, message: "Valid Booking ID is required." });
        }
        if (!cleanNewHospitalId) {
            return res.status(400).json({ success: false, message: "Valid target Hospital ID is required for re-routing." });
        }

        const booking = await Booking.findById(cleanBookingId);
        if (!booking) return res.status(404).json({ success: false, message: "Transit booking not found." });

        const oldHospitalId = booking.hospitalId;
        const oldHospital = oldHospitalId ? await Hospital.findById(oldHospitalId) : null;
        const newHospital = await Hospital.findById(cleanNewHospitalId);

        if (!newHospital) return res.status(404).json({ success: false, message: "New target hospital not found in database." });

        // Update target Hospital Destination
        booking.hospitalId = cleanNewHospitalId;
        booking.trackingTimeline.push({
            status: 'Re-Routed',
            timestamp: new Date(),
            note: `Re-routed from ${oldHospital ? oldHospital.name : 'Unassigned/Trauma Center'} to ${newHospital.name}. Reason: ${reason || 'Mechanical/Clinical decision'}`
        });
        await booking.save();

        // =========================================================================
        // 🚨 ADMISSION RECORD SWAP
        // Find the active pre-arrival Appointment record and transfer it to the new hospital
        // =========================================================================
        const activeAdmission = await Appointment.findOne({ 
            transactionId: booking.bookingId, // Mapped via booking ID reference
            status: 'Hospital-Pending'
        });

        if (activeAdmission) {
            // Update hospital reference in the admission document
            activeAdmission.hospitalId = cleanNewHospitalId;
            await activeAdmission.save();

            // 🟢 Send cancellation/removal notification to Old Hospital
            if (oldHospitalId) {
                await notifyAdminsAndVendor(
                    oldHospitalId,
                    'hospital',
                    "ℹ️ Emergency Case Diverted",
                    `Incoming patient from Ambulance #${booking.bookingId} has been re-routed to another hospital.`
                );
            }

            // 🟢 Send new incoming notification to New Hospital
            await notifyAdminsAndVendor(
                cleanNewHospitalId,
                'hospital',
                "🚨 Emergency Case Re-Routed to You!",
                `An incoming emergency patient from Ambulance #${booking.bookingId} has been diverted to your facility. Reason: ${reason || 'Emergency Re-route'}`,
                { appointmentId: activeAdmission._id.toString(), type: 'emergency_re_routed' }
            );
        }

        res.json({ 
            success: true, 
            message: `Successfully re-routed to ${newHospital.name}. Pre-arrival data transferred.`, 
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
        const driverId = req.user.id; // Logged-in Driver ID

        // Parallel processing: Live stats count aur Reviews count ek sath fetch karein
        const [stats, reviews, totalTrips] = await Promise.all([
            // Trip counts based on serviceType
            Booking.aggregate([
                { $match: { ambulanceId: new mongoose.Types.ObjectId(driverId) } },
                { $group: {
                    _id: null,
                    emergency: { $sum: { $cond: [{ $in: ["$serviceType", ["Accident emergency", "Quick Response"]] }, 1, 0] } },
                    medical: { $sum: { $cond: [{ $eq: ["$serviceType", "Medical Ambulance"] }, 1, 0] } },
                    referral: { $sum: { $cond: [{ $eq: ["$serviceType", "Referral Ambulance"] }, 1, 0] } }
                }}
            ]),
            // Fetch live reviews for rating calculation
            Review.find({ targetId: driverId, targetType: 'Ambulance' }).select('rating').lean(),
            // Count total completed/delivered trips
            Booking.countDocuments({ ambulanceId: driverId, status: 'Delivered' })
        ]);

        // Calculate dynamic average rating
        let averageRating = 4.8; // Default fallback if no reviews exist in DB yet
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            averageRating = Number((totalRating / reviews.length).toFixed(1));
        }

        const counts = stats[0] || { emergency: 0, medical: 0, referral: 0 };

        res.json({
            success: true,
            data: {
                emergencyTrips: counts.emergency, // Emergency trips count
                medicalTrips: counts.medical,     // Medical trips count
                referralTrips: counts.referral,   // Referral trips count
                totalTrips: totalTrips,           // Total delivered trips
                rating: averageRating,             // 👈 LIVE DYNAMIC RATING FOR DRIVER
                totalReviews: reviews.length      // Total reviews count
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

// --- 1. ARRIVED AT DROP-OFF (Figma Screen 12 - Generate Hospital OTP) ---
const arrivedAtDropOff = async (req, res) => {
    try {
        const { id } = req.params;
        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        // Generate a random 4-digit OTP for the Hospital Staff to provide
        const hospitalOtp = Math.floor(1000 + Math.random() * 9000).toString();
        booking.dropOffOtp = hospitalOtp;
        booking.status = 'Arrived'; // Set back to Arrived at Hospital state
        
        booking.trackingTimeline.push({
            status: 'Arrived at Dropoff',
            timestamp: new Date(),
            note: `Ambulance reached destination hospital (${booking.hospitalId ? 'Hospital' : 'Trauma Center'}). Awaiting handover OTP.`
        });

        await booking.save();

        // Print in server log for easy testing/debugging
        console.log(`[HANDOVER OTP] Booking ID: ${booking.bookingId} | Hospital OTP: ${hospitalOtp}`);

        res.json({ 
            success: true, 
            message: "Arrived at hospital. Verification OTP generated.",
            dev_otp: "1111" // Static bypass code for Sandbox
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

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ success: false, message: "Booking record not found." });

        // Bypass check for development '1111'
        const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
        const isStaticOtpMatch = isDev && String(otp).trim() === '1111';

        if (!isStaticOtpMatch && String(booking.dropOffOtp).trim() !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: "Invalid Hospital OTP. Please request a new code from staff." });
        }

        booking.isDropOffVerified = true;
        booking.status = 'En-Route'; // Proceed to Handoff screen
        
        booking.trackingTimeline.push({
            status: 'Dropoff OTP Verified',
            timestamp: new Date(),
            note: "Hospital staff confirmed handover via OTP."
        });

        await booking.save();
        res.json({ success: true, message: "OTP Verified. Please fill the Handoff Form.", data: booking });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 3. AMBULANCE SOS TRIGGER (Figma Screen 18 - Police / Vehicle Breakdown) ---
const triggerAmbulanceSos = async (req, res) => {
    try {
        const { id } = req.params;
        const { sosType, lat, lng } = req.body; // sosType: 'Police Required', 'Vehicle Breakdown', 'Control Room'

        const booking = await Booking.findById(id);
        
        if (booking) {
            booking.trackingTimeline.push({
                status: 'SOS Alert',
                timestamp: new Date(),
                note: `Driver triggered SOS alert: ${sosType}. Location logged at Lat: ${lat}, Lng: ${lng}`
            });
            await booking.save();
        }

        // Trigger push notification to System Admins regarding active SOS
        await notifyAdminsAndVendor(
            null,
            'admin',
            `🚨 AMBULANCE SOS: ${sosType}`,
            `Driver on booking ID #${booking ? booking.bookingId : 'N/A'} requires urgent ${sosType} assistance.`
        );

        res.json({ success: true, message: `${sosType} Alert logged and control room notified.` });
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

        // Locate active arriving booking linked to this driver
        const booking = await Booking.findOne({ 
            _id: bookingId, 
            ambulanceId: driverId, 
            status: 'Arrived' 
        });

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Booking must be in 'Arrived' state to report a No-Show." 
            });
        }

        // --- DYNAMIC SUB-TYPE MAPPING ---
        const serviceTypeToVendorMap = {
            'Accident emergency': 'Ambulance-Accident',
            'Medical Ambulance': 'Ambulance-Medical',
            'Quick Response': 'Ambulance-Medical',
            'Referral Ambulance': 'Ambulance-Referral'
        };

        const targetVendorType = serviceTypeToVendorMap[booking.serviceType] || 'Ambulance-Medical';

        const totalPaid = booking.pricing?.total || 0;
        let noShowFee = 0;

        // Fetch the specific dynamic admin no-show rules for this ambulance subtype
        const config = await NoShowConfig.findOne({ vendorType: targetVendorType, isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage' 
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        // Set status to Cancelled and apply dynamic no-show fee
        booking.status = 'Cancelled';
        booking.cancelledBy = 'Driver';
        booking.cancellationReason = comments || "Ambulance Driver arrived on spot but customer was unreachable.";
        booking.pricing.noShowFeeApplied = noShowFee;
        booking.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';

        booking.trackingTimeline.push({
            status: 'No-Show',
            timestamp: new Date(),
            note: `Ambulance driver reported spot No-Show on ${booking.serviceType}. Penalty fee applied: ₹${noShowFee}.`
        });

        // Release ambulance availability status back to available
        await Ambulance.findByIdAndUpdate(driverId, { $set: { availableForEmergency: true } });

        await booking.save();

        // 🚀 CRITICAL WORKFLOW SYNC FIX: Update status in linked Hospital Appointment
        if (booking.bookingId) {
            await Appointment.findOneAndUpdate(
                { transactionId: booking.bookingId },
                { 
                    $set: { 
                        status: 'No-Show',
                        'tracking.status': 'No-Show'
                    } 
                }
            );
        }

        res.json({ 
            success: true, 
            message: `Ambulance Spot No-Show logged successfully for ${booking.serviceType}.`, 
            noShowFeeApplied: noShowFee,
            data: booking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {getMyActiveTrip,getDriverReferralCases,getSystemCms, getIncomingRequests, acceptBooking, updateTripStatus, uploadIncidentPhoto,
    finalizeTripHandoff,verifyPickupOtp, arrivedAtDropOff, verifyDropOffOtp, triggerAmbulanceSos,
    rejectBooking, reRouteAmbulance,getDriverDashboardStats,
    getDriverTripHistory, changeDriverPassword, getDriverNotifications, markAllNotificationsAsRead, reportAmbulanceNoShow
 };