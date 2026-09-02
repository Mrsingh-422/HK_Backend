// controllers/admin/Ambulance/AmbulanceAdmin.js
const Booking = require('../../../models/AmbulanceBooking');
const Ambulance = require('../../../models/Ambulance');
const Hospital = require('../../../models/Hospital');
const User = require('../../../models/User');
const Appointment = require('../../../models/Appointment');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { getDistance } = require('../../../utils/helpers');
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification');

const generateCaseRef = (type) => {
    const prefix = type === 'Accident emergency' ? 'ACC' : (type === 'Referral Ambulance' ? 'REF' : 'MED');
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    const timeSlice = Date.now().toString().slice(-4);
    return `HK-${new Date().getFullYear()}-${prefix}-${timeSlice}${randomHex}`;
};

// ==========================================
// 1. GET ALL AMBULANCES (With Filters & Search)
// Endpoint: GET /admin/ambulance/ambulance-lists
// ==========================================
const adminGetAllAmbulances = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;
        const { profileStatus, search, vehicleType, isOnline } = req.query;

        const query = {};

        if (profileStatus && profileStatus !== 'All') {
            query.profileStatus = profileStatus;
        }
        if (vehicleType) {
            query.vehicleType = vehicleType;
        }
        if (isOnline !== undefined) {
            query.isOnline = isOnline === 'true';
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { vehicleNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const ambulances = await Ambulance.find(query)
            .select('name phone email vehicleNumber vehicleType profileStatus isActive isOnline availableForEmergency location country state city')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Ambulance.countDocuments(query);

        res.json({
            success: true,
            count: ambulances.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: ambulances
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. GET APPROVED AMBULANCE LIST
// Endpoint: GET /admin/ambulance/approved-list
// ==========================================
const adminGetApprovedAmbulances = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const ambulances = await Ambulance.find(query)
            .select('name phone email vehicleNumber vehicleType profileStatus isActive isOnline availableForEmergency location')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Ambulance.countDocuments(query);

        res.json({
            success: true,
            count: ambulances.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: ambulances
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET SINGLE AMBULANCE DETAILS (KYC & Documents Audit)
// Endpoint: GET /admin/ambulance/details/:id
// ==========================================
const adminGetAmbulanceDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const ambulance = await Ambulance.findById(id).populate('hospitalId', 'name address phone');

        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        const totalCompletedTrips = await Booking.countDocuments({ ambulanceId: id, status: 'Delivered' });

        res.json({
            success: true,
            data: {
                ...ambulance.toObject(),
                totalCompletedTrips
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. GET AMBULANCE BOOKINGS (With Filters)
// Endpoint: GET /admin/ambulance/bookings
// ==========================================
const adminGetAmbulanceBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;
        const { status, userId, ambulanceId, serviceType, search } = req.query;

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        if (ambulanceId) query.ambulanceId = ambulanceId;
        if (serviceType) query.serviceType = serviceType;

        if (search) {
            query.$or = [
                { bookingId: { $regex: search, $options: 'i' } },
                { caseReference: { $regex: search, $options: 'i' } },
                { 'patientDetails.name': { $regex: search, $options: 'i' } }
            ];
        }

        const bookings = await Booking.find(query)
            .populate('userId', 'name phone email')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone')
            .populate('hospitalId', 'name address')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Booking.countDocuments(query);

        res.json({
            success: true,
            count: bookings.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bookings
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. GET SINGLE BOOKING FULL DETAILS & AUDIT
// Endpoint: GET /admin/ambulance/booking-details/:id
// ==========================================
const adminGetBookingDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const isObjectId = mongoose.isValidObjectId(id);

        const query = isObjectId 
            ? { _id: id } 
            : { bookingId: String(id).trim() };

        const booking = await Booking.findOne(query)
            .populate('userId', 'name phone email profilePic')
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone location driverInfo')
            .populate('hospitalId', 'name address location phone hospitalImage')
            .populate('pickupHospitalId', 'name address location phone');

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        res.json({
            success: true,
            data: booking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. TOGGLE ACTIVE / INACTIVE (Suspend Driver)
// Endpoint: PATCH /admin/ambulance/status/active-inactive/:ambulanceId
// ==========================================
const toggleActiveInactiveAmbulance = async (req, res) => {
    try {
        const { ambulanceId } = req.params;
        const ambulance = await Ambulance.findById(ambulanceId);

        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        ambulance.isActive = !ambulance.isActive;
        if (!ambulance.isActive) {
            ambulance.isOnline = false;
            ambulance.availableForEmergency = false;
        }
        await ambulance.save();

        return res.json({
            success: true,
            message: `Ambulance status updated to ${ambulance.isActive ? 'Active' : 'Inactive'}.`,
            data: {
                ambulanceId: ambulance._id,
                isActive: ambulance.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 7. 🚨 ADMIN COMMAND CENTER: ACTIVE EMERGENCIES & BREAKDOWNS
// Endpoint: GET /admin/ambulance/active-emergencies
// ==========================================
const adminGetActiveEmergencies = async (req, res) => {
    try {
        // Fetch ongoing critical cases (Accidental SOS, Searching, In-Transit, Breakdown alerts)
        const activeTrips = await Booking.find({
            status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
        })
        .populate('userId', 'name phone')
        .populate('ambulanceId', 'name vehicleNumber phone location availableForEmergency')
        .populate('hospitalId', 'name address')
        .sort({ createdAt: -1 })
        .lean();

        // Separate Breakdown Alerts for highlighting on Admin UI
        const emergencies = activeTrips.map(trip => {
            const hasBreakdown = trip.trackingTimeline?.some(t => t.status === 'SOS Alert');
            return {
                ...trip,
                hasBreakdownAlert: hasBreakdown
            };
        });

        res.json({
            success: true,
            count: emergencies.length,
            breakdownAlertsCount: emergencies.filter(e => e.hasBreakdownAlert).length,
            data: emergencies
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 8. 🚨 ADMIN FORCE RE-ASSIGN AMBULANCE (Breakdown / Manual Override)
// Endpoint: PATCH /admin/ambulance/reassign-booking/:bookingId
// ==========================================
const adminReassignAmbulance = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { newAmbulanceId, reason } = req.body;

        if (!newAmbulanceId) {
            return res.status(400).json({ success: false, message: "New Ambulance ID is required for reassignment." });
        }

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId ? { _id: bookingId } : { bookingId };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        if (booking.status === 'Delivered' || booking.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: `Cannot reassign trip in '${booking.status}' state.` });
        }

        const newAmbulance = await Ambulance.findById(newAmbulanceId);
        if (!newAmbulance || !newAmbulance.isActive) {
            return res.status(400).json({ success: false, message: "Target ambulance is invalid or inactive." });
        }

        const oldAmbulanceId = booking.ambulanceId;

        // 1. Release old ambulance (mark as breakdown or available)
        if (oldAmbulanceId) {
            await Ambulance.findByIdAndUpdate(oldAmbulanceId, { 
                $set: { availableForEmergency: false, isOnline: false } // Kept offline due to breakdown
            });

            await sendPushNotification(
                oldAmbulanceId,
                'ambulance',
                "Trip Reassigned by Admin",
                `Booking #${booking.bookingId} has been reassigned to another driver.`,
                { bookingId: booking._id.toString(), type: 'trip_reassigned' }
            );
        }

        // 2. Assign to New Ambulance
        booking.ambulanceId = newAmbulance._id;
        booking.status = 'Confirmed';
        
        // 6-digit dynamic pickup OTP
        const freshOtp = Math.floor(100000 + Math.random() * 900000).toString();
        booking.otp = freshOtp;

        booking.trackingTimeline.push({
            status: 'Reassigned by Admin',
            timestamp: new Date(),
            note: `Admin reassigned ride to ${newAmbulance.name} (${newAmbulance.vehicleNumber}). Reason: ${reason || 'Breakdown / Fast Response'}`
        });

        await booking.save();

        // 3. Lock new ambulance
        newAmbulance.availableForEmergency = false;
        await newAmbulance.save();

        // 4. Sync Hospital Pre-Admission Record
        if (booking.bookingId) {
            await Appointment.findOneAndUpdate(
                { transactionId: booking.bookingId },
                { $set: { ambulanceId: newAmbulance._id } }
            );
        }

        // 5. Notify New Driver & User
        await sendPushNotification(
            newAmbulance._id,
            'ambulance',
            "🚨 Urgent Booking Assigned by Control Room!",
            `You have been dispatched to emergency booking #${booking.bookingId}. Pickup OTP is ${freshOtp}.`,
            { bookingId: booking._id.toString(), type: 'admin_dispatched_booking' }
        );

        await sendPushNotification(
            booking.userId,
            'user',
            "New Ambulance Dispatched!",
            `Your emergency request has been reassigned to ${newAmbulance.name} (${newAmbulance.vehicleNumber}). Share OTP: ${freshOtp} on arrival.`,
            { bookingId: booking._id.toString(), otp: freshOtp, type: 'ambulance_reassigned' }
        );

        res.json({
            success: true,
            message: `Successfully reassigned booking #${booking.bookingId} to ${newAmbulance.name}.`,
            data: booking
        });

    } catch (error) {
        console.error("Admin Reassign Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 9. 🗺️ LIVE FLEET COMMAND MAP (All Ambulances on Map)
// Endpoint: GET /admin/ambulance/live-fleet
// ==========================================
const adminGetLiveFleetMap = async (req, res) => {
    try {
        const ambulances = await Ambulance.find({ isActive: true })
            .select('name phone vehicleNumber vehicleType location isOnline availableForEmergency profileStatus')
            .lean();

        const fleetData = await Promise.all(ambulances.map(async (amb) => {
            let activeBooking = null;

            if (!amb.availableForEmergency) {
                activeBooking = await Booking.findOne({
                    ambulanceId: amb._id,
                    status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
                }).select('bookingId serviceType status pickupLocation hospitalId').lean();
            }

            return {
                ...amb,
                dutyStatus: !amb.isOnline ? 'Offline' : (!amb.availableForEmergency ? 'Busy / On Trip' : 'Available'),
                activeTrip: activeBooking
            };
        }));

        res.json({
            success: true,
            totalAmbulances: fleetData.length,
            onlineCount: fleetData.filter(a => a.isOnline).length,
            busyCount: fleetData.filter(a => !a.availableForEmergency && a.isOnline).length,
            data: fleetData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 10. 📞 108 EMERGENCY CALL MANUAL DISPATCH (With Hospital Pre-Admission Sync)
// Endpoint: POST /admin/ambulance/dispatch-call
// ==========================================
const adminDispatchEmergencyCall = async (req, res) => {
    try {
        const {
            patientName,
            patientPhone,
            pickupAddress,
            pickupLat,
            pickupLng,
            ambulanceId,
            hospitalId,
            serviceType,
            emergencyDescription
        } = req.body;

        if (!patientName || !patientPhone || !pickupAddress || !ambulanceId) {
            return res.status(400).json({
                success: false,
                message: "Patient Name, Phone, Pickup Address, and Target Ambulance ID are required."
            });
        }

        const targetAmbulance = await Ambulance.findById(ambulanceId);
        if (!targetAmbulance || !targetAmbulance.isActive) {
            return res.status(400).json({ success: false, message: "Selected ambulance is invalid or inactive." });
        }

        // Find or create user for phone caller
        let user = await User.findOne({ phone: String(patientPhone).trim().slice(-10) });
        if (!user) {
            const tempPassword = await require('bcryptjs').hash('EmergencyUser@123', 10);
            user = await User.create({
                name: patientName,
                phone: String(patientPhone).trim().slice(-10),
                countryCode: '+91',
                password: tempPassword,
                role: 'user',
                isPhoneVerified: true,
                profileStatus: 'Approved'
            });
        }

        const tempBookingId = `HK-CALL-${Date.now().toString().slice(-6)}`;
        const dynamicPickupOtp = Math.floor(100000 + Math.random() * 900000).toString();

        const booking = await Booking.create({
            bookingId: tempBookingId,
            caseReference: generateCaseRef(serviceType || 'Accident emergency'),
            userId: user._id,
            ambulanceId: targetAmbulance._id,
            hospitalId: hospitalId && mongoose.isValidObjectId(hospitalId) ? hospitalId : null,
            serviceType: serviceType || 'Accident emergency',
            triageLevel: 'Emergency',
            pickupLocation: {
                address: pickupAddress,
                lat: Number(pickupLat || 30.7046),
                lng: Number(pickupLng || 76.7179)
            },
            patientDetails: {
                name: patientName,
                emergencyDescription: emergencyDescription || "Dispatched via Control Room 108 helpline"
            },
            pricing: {
                total: 0 // Free emergency dispatch
            },
            isFreeCase: true,
            paymentStatus: 'Paid',
            paymentMethod: 'Online',
            status: 'Confirmed',
            otp: dynamicPickupOtp,
            trackingTimeline: [{
                status: 'Confirmed',
                timestamp: new Date(),
                note: `Emergency dispatched directly from Control Room desk to ${targetAmbulance.name}.`
            }]
        });

        targetAmbulance.availableForEmergency = false;
        await targetAmbulance.save();

        // 🚨 CRITICAL SYNC: Auto-Create Hospital Pre-Admission Record!
        if (booking.hospitalId) {
            const hospitalBookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            await Appointment.create({
                userId: user._id,
                hospitalId: booking.hospitalId,
                ambulanceId: targetAmbulance._id,
                bookingType: 'Admission',
                bedBookingType: 'Emergency-Bed',
                status: 'Hospital-Pending',
                bookingId: hospitalBookingId,
                transactionId: booking.bookingId,
                triageLevel: 'Emergency',
                patients: [{
                    patientName: patientName,
                    patientAge: 30,
                    gender: "Male",
                    reasonForVisit: emergencyDescription || "108 Call-Center Emergency Case"
                }],
                startDate: new Date(),
                pricingBreakdown: { baseFee: 0, subtotal: 0 },
                totalAmount: 0
            });

            // Alert Destination Hospital
            await notifyAdminsAndVendor(
                booking.hospitalId,
                'hospital',
                "🚨 New 108 Emergency Case Dispatched!",
                `Incoming patient ${patientName} arriving via Ambulance #${booking.bookingId}. Prepare trauma ward.`,
                { bookingId: booking._id.toString(), type: 'incoming_emergency_case' }
            );
        }

        // Notify Driver
        await sendPushNotification(
            targetAmbulance._id,
            'ambulance',
            "🚨 URGENT: 108 Emergency Call Dispatched!",
            `New emergency pickup for ${patientName} at ${pickupAddress}. Pickup OTP: ${dynamicPickupOtp}.`,
            { bookingId: booking._id.toString(), type: 'control_room_dispatch' }
        );

        res.status(201).json({
            success: true,
            message: "Emergency ambulance dispatched successfully and Hospital Pre-Admission synchronized.",
            bookingId: tempBookingId,
            pickupOtp: dynamicPickupOtp,
            data: booking
        });

    } catch (error) {
        console.error("Admin Dispatch Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    adminGetAllAmbulances,
    adminGetApprovedAmbulances,
    adminGetAmbulanceDetails,
    adminGetAmbulanceBookings,
    adminGetBookingDetails,
    toggleActiveInactiveAmbulance,
    adminGetActiveEmergencies,
    adminReassignAmbulance,
    adminGetLiveFleetMap,
    adminDispatchEmergencyCall
};