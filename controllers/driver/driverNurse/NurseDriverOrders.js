const NurseBooking = require('../../../models/NurseBooking');
const Driver = require('../../../models/Driver');
const Wallet = require('../../../models/Wallet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const NoShowConfig = require('../../../models/NoShowConfig');
const mongoose = require('mongoose');
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest'); // For handling profile update requests
const { deleteFile } = require('../../../utils/fileHandler');
const { sendPushNotification } = require('../../../utils/notification');
const { verifyFirebasePhoneToken } = require('../../../utils/firebaseAuthHelper');

// ==========================================
// 1. LOGIN & FORGOT PASSWORD FLOW
// ==========================================

// Forgot Password - Send OTP (Figma Screen 10)
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const driver = await Driver.findOne({ username: email, vendorType: 'Nurse' });
        if (!driver) return res.status(404).json({ message: "Nurse account not found with this email" });

        // Static OTP for testing
        driver.token = "1111"; // Temp storage of reset OTP
        await driver.save();

        res.json({ success: true, message: "OTP sent to your registered email", debugOtp: "1111" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Verify Forgot Password OTP (Figma Screen 10)
const verifyForgotOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const driver = await Driver.findOne({ username: email, token: otp });
        if (!driver) return res.status(400).json({ success: false, message: "Invalid OTP" });

        res.json({ success: true, message: "OTP verified successfully. You can now reset your password." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Reset Password (Figma Screen 10)
const resetPassword = async (req, res) => {
    try {
        const { email, password } = req.body;
        const driver = await Driver.findOne({ username: email });
        if (!driver) return res.status(404).json({ message: "Nurse account not found" });

        driver.password = await bcrypt.hash(String(password), 10);
        driver.token = null; // Clear OTP token
        await driver.save();

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// ==========================================
// 2. PROFILE & STATUS MANAGEMENT
// ==========================================

// Change Profile Password (Figma Screen 6)
const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const driver = await Driver.findById(req.user.id).select('+password');

        if (!(await bcrypt.compare(String(oldPassword), driver.password))) {
            return res.status(400).json({ success: false, message: "Old password does not match" });
        }

        driver.password = await bcrypt.hash(String(newPassword), 10);
        await driver.save();

        res.json({ success: true, message: "Password changed successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateProfile = async (req, res) => {
    try {
        const { name, address, alternateNumber } = req.body;
        const updateData = { name, address, alternateNumber };
 
       
        if (req.file) {
            updateData.profilePic = req.file.path;
        }
 
        const driver = await Driver.findByIdAndUpdate(
            req.user.id,
            updateData,
            { new: true, runValidators: true }
        );
 
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver not found" });
        }
 
        res.json({ success: true, message: "Profile updated successfully", data: driver });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 

// Switch Online / Offline Status (Figma Screen 3)
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'Available' or 'Offline'
        const driver = await Driver.findByIdAndUpdate(req.user.id, { status }, { new: true });
        res.json({ success: true, message: `Driver status updated to ${status}`, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// @desc    Get Nurse Field Staff Dashboard Overview (Active Jobs, Cash to Collect & Completed Count)
// @route   GET /driver/nurse/dashboard
// @access  Private (Driver)
const getNurseDashboard = async (req, res) => {
    try {
        const staffId = req.user.id;

        const driver = await Driver.findById(staffId).select('-password -token');
        if (!driver) {
            return res.status(404).json({ success: false, message: "Staff driver account not found." });
        }

        const todayStart = moment().startOf('day').toDate();

        // 1. Count Active Assigned Services
        const activeCount = await NurseBooking.countDocuments({
            assignedStaffId: staffId,
            status: { $in: ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] }
        });

        // 2. Count Today's Completed Services
        const completedCount = await NurseBooking.countDocuments({
            assignedStaffId: staffId,
            status: 'Completed',
            completedAt: { $gte: todayStart }
        });

        // 3. Calculate Pending Cash on Delivery (COD) to Collect from active trips
        const activeCodBookings = await NurseBooking.find({
            assignedStaffId: staffId,
            paymentMethod: 'COD',
            paymentStatus: 'Pending',
            status: { $in: ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] }
        }).select('totalPrice priceBreakdown').lean();

        const pendingCashToCollect = activeCodBookings.reduce((sum, b) => {
            return sum + Number(b.totalPrice || b.priceBreakdown?.totalPrice || 0);
        }, 0);

        res.status(200).json({
            success: true,
            data: {
                driver: {
                    id: driver._id,
                    name: driver.name,
                    phone: driver.phone,
                    address: driver.address || "Field Operations Desk",
                    profilePic: driver.profilePic || null,
                    vehicleNumber: driver.vehicleNumber || "",
                    vehicleType: driver.vehicleType || "Scooter",
                    isOnline: driver.status !== 'Offline',
                    status: driver.status
                },
                metrics: {
                    activeServicesCount: activeCount,
                    completedTodayCount: completedCount,
                    pendingCashToCollect: Math.round(pendingCashToCollect)
                }
            }
        });

    } catch (error) {
        console.error("Get Nurse Driver Dashboard Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get All Assigned Services for Nurse Field Staff (Enriched with COD/Online, Venue & Timing)
// @route   GET /driver/nurse/orders/list
// @access  Private (Driver)
const getNurseBookings = async (req, res) => {
    try {
        const staffId = req.user.id;
        const { statusFilter } = req.query; // 'All', 'Active', 'Complete', 'Cancelled'
        
        let query = { assignedStaffId: staffId };

        if (statusFilter && statusFilter !== 'All') {
            if (statusFilter === 'Active') {
                query.status = { $in: ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] };
            } else if (statusFilter === 'Complete') {
                query.status = 'Completed';
            } else if (statusFilter === 'Cancelled') {
                query.status = { $in: ['Cancelled', 'No-Show'] };
            }
        }

        const bookings = await NurseBooking.find(query)
            .populate('userId', 'name phone profilePic gender dob')
            .populate('serviceId', 'title description procedureIncluded servicesOffered')
            .populate('packageId', 'packageName description')
            .sort({ createdAt: -1 })
            .lean();

        const formattedBookings = bookings.map(booking => {
            const rawMethod = String(booking.paymentMethod || '').trim().toUpperCase();
            const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
            const isPaid = booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Done';

            const isHospital = booking.assessmentLocation === 'At Hospital';
            let destinationLabel = "Home Address";
            if (isHospital && booking.hospitalDetails) {
                destinationLabel = `${booking.hospitalDetails.hospitalName || 'Hospital'} (${booking.hospitalDetails.wardName || 'Ward'} - Bed: ${booking.hospitalDetails.bedNumber || 'Bed'})`;
            } else if (booking.address && booking.address.houseNo) {
                destinationLabel = `${booking.address.houseNo}, ${booking.address.city || ''} - ${booking.address.pincode || ''}`.replace(/^, |, $/g, '');
            }

            const primaryPatient = (Array.isArray(booking.patients) && booking.patients.length > 0)
                ? booking.patients[0]
                : { name: booking.userId?.name || "Patient", relation: "Self" };

            let formattedScheduleDate = "";
            if (booking.schedule?.startDate) {
                const sDate = moment(booking.schedule.startDate).format("DD MMM YYYY");
                if (booking.schedule.duration === 'For Multiple Days' && booking.schedule.endDate && !moment(booking.schedule.startDate).isSame(booking.schedule.endDate, 'day')) {
                    const eDate = moment(booking.schedule.endDate).format("DD MMM YYYY");
                    formattedScheduleDate = `${sDate} - ${eDate}`;
                } else {
                    formattedScheduleDate = sDate;
                }
            }

            const travelDeliveryFee = Number(
                booking.priceBreakdown?.travelFee !== undefined 
                    ? booking.priceBreakdown.travelFee 
                    : (booking.priceBreakdown?.deliveryCharge || 0)
            );

            return {
                ...booking,
                userName: booking.userId?.name || "Patient",
                patientName: primaryPatient.name || primaryPatient.patientName || "Patient",
                primaryPatientRelation: primaryPatient.relation || "Self",
                patientCount: Array.isArray(booking.patients) ? booking.patients.length : 1,
                
                // Payment Identifiers for Staff
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: booking.paymentStatus || 'Pending',
                isCod,
                isPaid,
                collectCashAmount: isCod && !isPaid ? Number(booking.totalPrice || 0) : 0,
                paymentDisplayLabel: isCod ? "Collect Cash on Visit (COD)" : (isPaid ? "Paid Online" : "Online (Pending)"),

                // Venue & Timings
                destinationLabel,
                assessmentLocation: booking.assessmentLocation || "At Home",
                formattedScheduleDate,
                formattedScheduleTime: booking.schedule?.startTime ? moment(booking.schedule.startTime, ["HH:mm", "hh:mm A"]).format("hh:mm A") : "09:00 AM",

                // Charges breakdown
                travelFee: travelDeliveryFee,
                deliveryCharge: travelDeliveryFee,
                totalAmount: Number(booking.totalPrice || booking.priceBreakdown?.totalPrice || 0)
            };
        });

        res.status(200).json({ 
            success: true, 
            count: formattedBookings.length, 
            data: formattedBookings 
        });

    } catch (error) { 
        console.error("Get Driver Nurse Bookings Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Get Detailed Nurse Booking for Field Staff (Includes Prescription Image & Daily Sessions)
// @route   GET /driver/nurse/orders/detail/:bookingId
// @access  Private (Driver)
const getBookingDetail = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const staffId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId 
            ? { _id: bookingId } 
            : { bookingId: String(bookingId).trim() };

        const booking = await NurseBooking.findOne(query)
            .populate('userId', 'name phone email profilePic gender dob')
            .populate('nurseId', 'name phone email city address rating')
            .populate('selectedConsumables.consumableId', 'itemName size mrp unitType')
            .populate('serviceId', 'title description procedureIncluded servicesOffered')
            .populate('packageId', 'packageName description')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        const rawMethod = String(booking.paymentMethod || '').trim().toUpperCase();
        const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
        const isPaid = booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Done';

        const isHospital = booking.assessmentLocation === 'At Hospital';
        let destinationLabel = "Home Address";
        if (isHospital && booking.hospitalDetails) {
            destinationLabel = `${booking.hospitalDetails.hospitalName || 'Hospital'} (${booking.hospitalDetails.wardName || 'Ward'} - Bed: ${booking.hospitalDetails.bedNumber || 'Bed'})`;
        } else if (booking.address && booking.address.houseNo) {
            destinationLabel = `${booking.address.houseNo}, ${booking.address.city || ''} - ${booking.address.pincode || ''}`.replace(/^, |, $/g, '');
        }

        const primaryPatient = (Array.isArray(booking.patients) && booking.patients.length > 0)
            ? booking.patients[0]
            : { name: booking.userId?.name || "Patient", relation: "Self" };

        const travelDeliveryFee = Number(
            booking.priceBreakdown?.travelFee !== undefined 
                ? booking.priceBreakdown.travelFee 
                : (booking.priceBreakdown?.deliveryCharge || 0)
        );

        let formattedScheduleDate = "";
        if (booking.schedule?.startDate) {
            const sDate = moment(booking.schedule.startDate).format("DD MMM YYYY");
            if (booking.schedule.duration === 'For Multiple Days' && booking.schedule.endDate && !moment(booking.schedule.startDate).isSame(booking.schedule.endDate, 'day')) {
                const eDate = moment(booking.schedule.endDate).format("DD MMM YYYY");
                formattedScheduleDate = `${sDate} - ${eDate}`;
            } else {
                formattedScheduleDate = sDate;
            }
        }

        res.status(200).json({
            success: true,
            data: {
                ...booking,
                userName: booking.userId?.name || "Patient",
                patientName: primaryPatient.name || primaryPatient.patientName || "Patient",
                primaryPatientRelation: primaryPatient.relation || "Self",
                patientCount: Array.isArray(booking.patients) ? booking.patients.length : 1,

                // Payment Status
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: booking.paymentStatus || 'Pending',
                isCod,
                isPaid,
                collectCashAmount: isCod && !isPaid ? Number(booking.totalPrice || 0) : 0,
                paymentDisplayLabel: isCod ? "Collect Cash on Visit (COD)" : (isPaid ? "Paid Online" : "Online (Pending)"),

                // Venue & Address
                assessmentLocation: booking.assessmentLocation || "At Home",
                hospitalDetails: booking.hospitalDetails || null,
                destinationLabel,

                // Timings & OTPs
                formattedScheduleDate,
                formattedScheduleTime: booking.schedule?.startTime ? moment(booking.schedule.startTime, ["HH:mm", "hh:mm A"]).format("hh:mm A") : "09:00 AM",
                serviceOTP: booking.serviceOTP,
                completionOTP: booking.completionOTP,

                // Medical / Prescription Reference
                prescriptionImage: booking.prescriptionImage || null,
                dailySessions: booking.dailySessions || [],

                // Financial Breakdown
                travelFee: travelDeliveryFee,
                deliveryCharge: travelDeliveryFee,
                priceBreakdown: {
                    ...booking.priceBreakdown,
                    travelFee: travelDeliveryFee,
                    deliveryCharge: travelDeliveryFee,
                    originalTravelFee: Number(booking.priceBreakdown?.originalTravelFee || travelDeliveryFee || 45)
                }
            }
        });

    } catch (error) { 
        console.error("Get Driver Booking Detail Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Field Staff Accepts or Rejects Assigned Duty (Deadlock Fixed & Real-Time Sync)
// @route   PATCH /driver/nurse/orders/respond/:bookingId
// @access  Private (Driver)
const respondToBooking = async (req, res) => {
    try {
        const { action, reason } = req.body; // 'Accept' or 'Reject'
        const { bookingId } = req.params;
        const staffId = req.user.id;

        if (!action || !['Accept', 'Reject'].includes(action)) {
            return res.status(400).json({ success: false, message: "Action must be either 'Accept' or 'Reject'." });
        }

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId 
            ? { _id: bookingId } 
            : { bookingId: String(bookingId).trim() };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        // =========================================================================
        // 1. ACCEPT DUTY
        // =========================================================================
        if (action === 'Accept') {
            // Check if staff is actively in-transit or on-site with ANOTHER patient
            const activeOtherJob = await NurseBooking.findOne({
                assignedStaffId: staffId,
                _id: { $ne: booking._id },
                status: { $in: ['On-The-Way', 'Arrived', 'Service-Started'] }
            });

            if (activeOtherJob) {
                return res.status(400).json({ 
                    success: false, 
                    message: "You are currently busy executing another service. Finish current task first." 
                });
            }

            booking.status = 'Assigned';
            booking.assignedStaffId = staffId;
            await booking.save();

            // Lock staff status to Busy
            await Driver.findByIdAndUpdate(staffId, { $set: { status: 'Busy', isOnline: true } });

            // Notify Patient that staff has accepted duty
            if (booking.userId) {
                try {
                    await sendPushNotification(
                        booking.userId,
                        'user',
                        "Nurse Confirmed Your Duty! 👩‍⚕️",
                        `Nurse ${req.user.name || ''} has accepted your service booking #${booking.bookingId}.`,
                        { bookingId: booking._id.toString(), type: 'nurse_accepted_duty' }
                    );
                } catch (e) {}
            }

            return res.status(200).json({ 
                success: true, 
                message: "Service duty accepted successfully.", 
                data: booking 
            });
        }

        // =========================================================================
        // 2. REJECT DUTY
        // =========================================================================
        if (action === 'Reject') {
            const dropReason = reason || "Staff declined assignment.";

            booking.rejectedBy.push(staffId);
            booking.assignedStaffId = null;
            booking.status = 'Confirmed'; // Pool back for bureau reassignment
            booking.cancelReason = dropReason;
            await booking.save();

            // Release staff driver back to Available
            await Driver.findByIdAndUpdate(staffId, { $set: { status: 'Available', isOnline: true } });

            // Alert Nurse Bureau to reassign immediately
            if (booking.nurseId) {
                try {
                    await sendPushNotification(
                        booking.nurseId,
                        'nurse',
                        "⚠️ Staff Nurse Declined Duty!",
                        `Nurse staff ${req.user.name || ''} declined booking #${booking.bookingId}. Please assign another staff.`,
                        { bookingId: booking._id.toString(), type: 'staff_declined_duty' }
                    );
                } catch (e) {}
            }

            return res.status(200).json({ 
                success: true, 
                message: "Duty declined. Booking pooled back for reassignment.", 
                data: booking 
            });
        }

    } catch (error) { 
        console.error("Respond To Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Field Staff Rejects or Drops Assigned Booking (Pools Back & Alerts Nurse Bureau Instantly)
// @route   PATCH /driver/nurse/orders/reject-reason/:bookingId
// @access  Private (Driver)
const rejectBookingWithReason = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { cancelReason, additionalComments } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        const dropReason = cancelReason || "Staff unavailable due to emergency";

        // Pool booking back to Confirmed with no assigned staff
        booking.rejectedBy.push(staffId);
        booking.assignedStaffId = null;
        booking.status = 'Confirmed';
        booking.cancelReason = dropReason;
        booking.additionalComments = additionalComments || "";
        await booking.save();

        // Free driver back to Available
        await Driver.findByIdAndUpdate(staffId, { $set: { status: 'Available', isOnline: true } });

        // 🚨 Alert Nurse Bureau that assigned staff rejected the duty
        if (booking.nurseId) {
            try {
                await sendPushNotification(
                    booking.nurseId,
                    'nurse',
                    "⚠️ Staff Nurse Dropped Booking!",
                    `Nurse staff ${req.user.name || ''} dropped duty for booking #${booking.bookingId} (${dropReason}). Please reassign immediately.`,
                    { bookingId: booking._id.toString(), type: 'staff_dropped_duty' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: "Booking duty released and Nurse Bureau notified for reassignment.",
            data: booking
        });

    } catch (error) { 
        console.error("Reject Booking With Reason Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// @desc    Field Staff starts transit to Patient Location (Status: 'On-The-Way')
// @route   PATCH /driver/nurse/orders/start-journey/:bookingId
// @access  Private (Driver)
const startServiceJourney = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const staffId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId 
            ? { _id: bookingId } 
            : { bookingId: String(bookingId).trim() };

        const booking = await NurseBooking.findOne(query).populate('userId', 'fcmToken name phone');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        if (booking.assignedStaffId && String(booking.assignedStaffId) !== String(staffId)) {
            return res.status(403).json({ success: false, message: "Unauthorized: You are not assigned to this booking." });
        }

        booking.status = 'On-The-Way';
        booking.startedAt = new Date();
        await booking.save();

        // Ensure driver status is Busy
        await Driver.findByIdAndUpdate(staffId, { $set: { status: 'Busy', isOnline: true } });

        // Alert Patient that nurse is on the way
        if (booking.userId) {
            try {
                await sendPushNotification(
                    booking.userId._id,
                    'user',
                    "Nurse is On The Way! 🛵",
                    `Nurse ${req.user.name || ''} has started transit to your location.`,
                    { bookingId: booking._id.toString(), type: 'nurse_on_the_way' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: "Journey started. Status updated to 'On-The-Way'.",
            data: booking
        });

    } catch (error) {
        console.error("Start Journey Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Field Staff Arrives at Location (Venue-Aware Notification & SMS Phone Return)
// @route   PATCH /driver/nurse/orders/arrive/:bookingId
// @access  Private (Driver)
const arriveAtLocation = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const staffId = req.user.id;

        const staff = await Driver.findById(staffId);
        const booking = await NurseBooking.findById(bookingId).populate('userId', 'fcmToken name phone');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

        if (booking.assignedStaffId && String(booking.assignedStaffId) !== String(staffId)) {
            return res.status(403).json({ success: false, message: "Unauthorized operation." });
        }

        booking.status = 'Arrived';
        booking.arrivedAt = new Date();
        await booking.save();

        const patientPhone = booking.address?.phone || booking.userId?.phone;
        const cleanPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";
        const formattedPatientPhone = `+91${cleanPhone}`;

        // Dynamic Venue-Aware Notification (Hospital vs Home)
        const isHospital = booking.assessmentLocation === 'At Hospital';
        const notifTitle = isHospital ? "Nurse Arrived at Hospital Ward! 🏥" : "Nurse Arrived at Your Doorstep! 👩‍⚕️";
        const notifBody = isHospital 
            ? `Nurse ${staff?.name || ''} has arrived at ${booking.hospitalDetails?.hospitalName || 'the hospital'}. Share Start OTP (${booking.serviceOTP || ''}) to begin.`
            : `Nurse ${staff?.name || ''} has arrived. Please share the Start OTP (${booking.serviceOTP || ''}) to begin care session.`;

        if (booking.userId) {
            try {
                await sendPushNotification(
                    booking.userId._id,
                    'user',
                    notifTitle,
                    notifBody,
                    { bookingId: booking._id.toString(), type: 'nurse_arrived', serviceOTP: booking.serviceOTP }
                );
            } catch (e) {}
        }

        res.status(200).json({ 
            success: true, 
            message: "Nurse arrived at location. Patient alerted to share Start OTP.",
            patientPhone: formattedPatientPhone,
            bookingId: booking.bookingId 
        });
    } catch (error) { 
        console.error("Arrive At Location Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Verify Start OTP (Firebase ID Token or Dynamic 4-Digit serviceOTP) & Begin Care Session
// @route   POST /driver/nurse/orders/verify-start-otp
// @access  Private (Driver)
const verifyOtpAndStartService = async (req, res) => {
    try {
        const { bookingId, idToken, otp } = req.body;
        const staffId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId 
            ? { _id: bookingId } 
            : { bookingId: String(bookingId).trim() };

        const booking = await NurseBooking.findOne(query).populate('userId', 'phone name fcmToken');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        if (booking.assignedStaffId && String(booking.assignedStaffId) !== String(staffId)) {
            return res.status(403).json({ success: false, message: "Unauthorized operation." });
        }

        const patientPhone = booking.address?.phone || booking.userId?.phone;
        const cleanPatientPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";

        // 1. Production Mode: Real Firebase Phone ID Token Verification
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ success: false, message: "Firebase idToken is required to start service." });
            }
            const verification = await verifyFirebasePhoneToken(idToken, cleanPatientPhone);
            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        } 
        // 2. OTP Code Verification (Accepts actual booking.serviceOTP or dev fallback '123456')
        else if (otp) {
            const cleanIncomingOtp = String(otp).trim();
            const savedOtp = String(booking.serviceOTP || '').trim();

            if (cleanIncomingOtp !== '123456' && cleanIncomingOtp !== savedOtp) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Invalid Start OTP code. Please enter the code displayed on patient's screen." 
                });
            }
        } else {
            return res.status(400).json({ success: false, message: "Verification OTP or idToken is required." });
        }

        booking.status = 'Service-Started';
        booking.startedAt = new Date();
        await booking.save();

        // Notify Patient that care session has officially started
        if (booking.userId) {
            try {
                await sendPushNotification(
                    booking.userId._id,
                    'user',
                    "Nursing Session Started! ⏱️",
                    `Nurse ${req.user.name || ''} has verified OTP and started the care session.`,
                    { bookingId: booking._id.toString(), type: 'nurse_service_started' }
                );
            } catch (e) {}
        }

        res.status(200).json({ 
            success: true, 
            message: "Start OTP verified successfully. Care timer started!", 
            data: booking 
        });

    } catch (error) { 
        console.error("Verify Start OTP Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Add Live Notes & Progress Photos During Session Timer (Clean Web URLs)
// @route   PATCH /driver/nurse/orders/progress-update/:bookingId
// @access  Private (Driver)
const addProgressUpdate = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { progressNotes } = req.body;
        const staffId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId 
            ? { _id: bookingId } 
            : { bookingId: String(bookingId).trim() };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        if (booking.assignedStaffId && String(booking.assignedStaffId) !== String(staffId)) {
            return res.status(403).json({ success: false, message: "Unauthorized: You are not assigned to this booking." });
        }

        if (progressNotes) {
            booking.serviceNotes = progressNotes.trim();
        }

        // Clean & Normalize Progress Photos to standard web-accessible URLs
        if (req.files && req.files.progressPhotos && req.files.progressPhotos.length > 0) {
            const cleanPhotoUrls = req.files.progressPhotos.map(file => {
                return `/uploads/nurse_progress/${file.filename}`;
            });
            if (!booking.progressPhotos) booking.progressPhotos = [];
            booking.progressPhotos.push(...cleanPhotoUrls);
        }

        await booking.save();

        res.status(200).json({ 
            success: true, 
            message: "Progress update and photos recorded successfully.", 
            data: booking 
        });
    } catch (error) { 
        console.error("Add Progress Update Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 3. SUBMIT SUMMARY & PREPARE COMPLETION
// Endpoint: POST /driver/nurse/orders/submit-completion/:bookingId
// ==========================================
const submitServiceCompletion = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { 
            serviceNotes, 
            usedConsumable, 
            consumablesSelected, 
            totalConsumableCharges, 
            earlyCompleteNotes, 
            extraServicePayment 
        } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId).populate('userId', 'fcmToken name phone');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.assignedStaffId && booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        booking.serviceNotes = serviceNotes;
        booking.usedConsumable = usedConsumable === 'true' || usedConsumable === true;
        booking.totalConsumableCharges = Number(totalConsumableCharges || 0);
        booking.earlyCompleteNotes = earlyCompleteNotes;
        booking.extraServicePayment = Number(extraServicePayment || 0);

        if (consumablesSelected) {
            booking.consumablesSelected = typeof consumablesSelected === 'string' 
                ? JSON.parse(consumablesSelected) 
                : consumablesSelected;
        }

        if (req.files?.handmadeInvoice && req.files.handmadeInvoice[0]) {
            booking.handmadeInvoice = req.files.handmadeInvoice[0].path.replace(/\\/g, "/");
        }

        await booking.save();

        const patientPhone = booking.address?.phone || booking.userId?.phone;
        const cleanPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";
        const formattedPatientPhone = `+91${cleanPhone}`;

        res.json({ 
            success: true, 
            message: "Session summary compiled. Trigger Firebase SMS OTP to patient to finalize completion.",
            patientPhone: formattedPatientPhone 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Verify Completion OTP with Multi-Day Session History Archival, Doorstep Addons & Wallet Ledger
// @route   POST /driver/nurse/orders/verify-complete-otp
// @access  Private (Driver)
const verifyCompleteOtp = async (req, res) => {
    try {
        const { bookingId, idToken, otp } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId).populate('userId', 'phone name');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        if (booking.assignedStaffId && String(booking.assignedStaffId) !== String(staffId)) {
            return res.status(403).json({ success: false, message: "Unauthorized operation." });
        }

        const patientPhone = booking.address?.phone || booking.userId?.phone;
        const cleanPatientPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";

        // 1. Verify OTP or Firebase Token
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ success: false, message: "Firebase idToken is required." });
            }
            const verification = await verifyFirebasePhoneToken(idToken, cleanPatientPhone);
            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        } else if (otp) {
            const cleanIncomingOtp = String(otp).trim();
            const savedOtp = String(booking.completionOTP || '').trim();
            if (cleanIncomingOtp !== '123456' && cleanIncomingOtp !== savedOtp) {
                return res.status(400).json({ success: false, message: "Invalid Completion OTP code." });
            }
        }

        // 2. Doorstep Consumables & Extra Charges Synchronization
        const extraConsumables = Number(booking.totalConsumableCharges || 0);
        const extraService = Number(booking.extraServicePayment || 0);
        const onSpotAddons = extraConsumables + extraService;

        if (onSpotAddons > 0) {
            if (!booking.priceBreakdown) booking.priceBreakdown = {};
            booking.priceBreakdown.consumableTotal = Number(booking.priceBreakdown.consumableTotal || 0) + extraConsumables;
            booking.priceBreakdown.totalPrice = Number(booking.priceBreakdown.totalPrice || booking.totalPrice || 0) + onSpotAddons;
            booking.totalPrice = booking.priceBreakdown.totalPrice;
        }

        // 3. Multi-Day vs Single Day Lifecycle Evaluation
        const today = new Date();
        const hasMultipleDays = (booking.schedule?.duration === 'For Multiple Days' && booking.schedule?.endDate);
        const isMultiDayActive = hasMultipleDays && new Date(today.setHours(0,0,0,0)) < new Date(new Date(booking.schedule.endDate).setHours(0,0,0,0));

        // Archive today's session into dailySessions log
        const currentSessionNumber = (booking.dailySessions?.length || 0) + 1;
        if (!booking.dailySessions) booking.dailySessions = [];

        booking.dailySessions.push({
            sessionNumber: currentSessionNumber,
            sessionDate: new Date(),
            staffId: staffId,
            staffName: req.user.name || "Nurse Staff",
            startedAt: booking.startedAt || new Date(),
            completedAt: new Date(),
            serviceNotes: booking.serviceNotes || "",
            progressPhotos: booking.progressPhotos || [],
            extraConsumablesCharges: extraConsumables,
            extraServicePayment: extraService
        });

        if (isMultiDayActive) {
            // MULTI-DAY ACTIVE: Session completed for today, regenerate fresh OTPs for tomorrow's visit!
            booking.status = 'Assigned';
            booking.serviceOTP = Math.floor(1000 + Math.random() * 9000).toString();
            booking.completionOTP = Math.floor(1000 + Math.random() * 9000).toString();
            booking.serviceNotes = ""; // Reset note for next day
            booking.progressPhotos = []; // Reset photos for next day
        } else {
            // SINGLE DAY OR FINAL DAY: Complete the entire booking
            booking.status = 'Completed';
            booking.completedAt = new Date();

            if (booking.paymentMethod === 'COD') {
                booking.paymentStatus = 'Paid';
                if (!booking.paymentDetails) booking.paymentDetails = {};
                booking.paymentDetails.method = 'COD';
                booking.paymentDetails.status = 'captured';
                booking.paymentDetails.paidAt = new Date();
                booking.paymentDetails.amount = booking.priceBreakdown?.totalPrice || booking.totalPrice || 0;
            }
        }

        await booking.save();

        // 4. Release Staff Nurse back to Available state
        await Driver.findByIdAndUpdate(staffId, { $set: { status: 'Available', isOnline: true } });

        // 5. Notify Patient
        try {
            await sendPushNotification(
                booking.userId,
                'user',
                isMultiDayActive ? `Day ${currentSessionNumber} Nursing Session Completed! 👩‍⚕️` : "Nursing Care Service Completed! ✨",
                isMultiDayActive 
                    ? `Today's session finished. Tomorrow's Start OTP is: ${booking.serviceOTP}.`
                    : `Your nursing care service #${booking.bookingId} has been successfully completed.`,
                { bookingId: booking._id.toString(), type: 'nurse_session_completed' }
            );
        } catch (e) {}

        res.status(200).json({ 
            success: true, 
            message: isMultiDayActive 
                ? `Day ${currentSessionNumber} session completed! Tomorrow's fresh OTPs generated and staff released.` 
                : "Service completed successfully and marked as Paid!", 
            isMultiDayActive,
            sessionNumber: currentSessionNumber,
            nextSessionStartOtp: isMultiDayActive ? booking.serviceOTP : null,
            data: booking 
        });

    } catch (error) { 
        console.error("Verify Complete OTP Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// Support/Contact Admin Config (Figma Screen 9)
const getAdminContact = async (req, res) => {
    res.json({
        success: true,
        data: {
            phone: "+91 9876543210",
            email: "help@gmail.com"
        }
    });
};

// @desc    Get Completed / Cancelled Service History for Nurse Driver (Figma Match)
// @route   GET /driver/nurse/orders/history
// @access  Private (Driver)
const getDriverHistory = async (req, res) => {
    try {
        const staffId = req.user.id;

        const bookings = await NurseBooking.find({
            assignedStaffId: staffId,
            status: { $in: ['Completed', 'Cancelled', 'No-Show'] }
        })
        .populate('userId', 'name phone')
        .populate('serviceId', 'title')
        .populate('packageId', 'packageName')
        .sort({ updatedAt: -1 })
        .lean();

        const formattedHistory = bookings.map(b => {
            const rawMethod = String(b.paymentMethod || '').trim().toUpperCase();
            const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
            const isPaid = b.paymentStatus === 'Paid' || b.paymentStatus === 'Done';

            const formattedDate = b.schedule?.startDate 
                ? moment(b.schedule.startDate).format('DD-MMMM-YYYY') 
                : moment(b.createdAt).format('DD-MMMM-YYYY');
                
            const formattedTime = b.schedule?.startTime 
                ? (b.schedule.endTime ? `${b.schedule.startTime} - ${b.schedule.endTime}` : b.schedule.startTime)
                : "";

            const primaryPatient = (Array.isArray(b.patients) && b.patients.length > 0)
                ? b.patients[0]
                : { name: b.userId?.name || "Patient", relation: "Self" };

            const isHospital = b.assessmentLocation === 'At Hospital';
            let locationDisplay = "N/A";
            if (isHospital && b.hospitalDetails) {
                locationDisplay = `${b.hospitalDetails.hospitalName || 'Hospital'} (${b.hospitalDetails.wardName || 'Ward'})`;
            } else if (b.address && b.address.houseNo) {
                locationDisplay = `${b.address.houseNo}, ${b.address.sector || ''}, ${b.address.city || ''}`.replace(/^, |, $/g, '');
            }

            return {
                bookingId: b._id,
                orderId: b.bookingId || "N/A",
                serviceTitle: b.serviceDetails?.title || b.packageId?.packageName || b.serviceId?.title || "Nursing Care",
                patientName: primaryPatient.name || "Self",
                mobileNo: b.address?.phone || b.userId?.phone || "",
                location: locationDisplay,
                assessmentLocation: b.assessmentLocation || "At Home",
                date: formattedDate,
                time: formattedTime,
                status: b.status,
                totalPrice: Number(b.totalPrice || b.priceBreakdown?.totalPrice || 0),
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: b.paymentStatus || 'Pending',
                isCod,
                isPaid,
                cancelReason: b.cancelReason || b.additionalComments || null,
                completedAt: b.completedAt
            };
        });

        res.status(200).json({
            success: true,
            totalOrders: formattedHistory.length,
            data: formattedHistory
        });

    } catch (error) {
        console.error("Get Driver History Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// B. Get Terms & Conditions Page Document (Figma Screen 17)
const getTermsAndConditions = async (req, res) => {
    try {
        // Figma legal document template layout data
        const termsText = `
            The Detroit Medical Center
            STANDARD TERMS AND CONDITIONS

            1. Incorporation Into Agreements: These DMC Standard Terms and Conditions are incorporated into any arrangement entered into between the recipient of these Standard Terms and the Vendor...
            
            2. New Participants: Any new participants joining the DMC after initiation of this contract shall automatically be accorded the rights of this contract...

            3. Vendor Selection: The DMC reserves the right to reject any and all proposals and to waive any or all formalities in connection with bidding and selection of a Vendor...
        `;
        
        res.json({
            success: true,
            title: "Terms & Conditions",
            content: termsText
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// C. Get About Page Document (Figma Screen 15)
const getAboutContent = async (req, res) => {
    try {
        // Figma About Us learning history text
        const aboutText = `
            Beds and Britches, Etc. (B.A.B.E.)
            Learning History

            Organizations like ours try to learn from our experiences, both the successful and not so successful ones. This is a way of assessing our effectiveness and sharing information. It is an important process for the growth of any organization...
        `;

        res.json({
            success: true,
            title: "About Us",
            content: aboutText
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// REPORT NURSE NO-SHOW (With Bureau Wallet Compensation Credit)
// Endpoint: POST /driver/nurse/orders/no-show
// @desc    Report Patient No-Show by Staff Nurse (Accurate COD vs Online Financial Separation)
// @route   POST /driver/nurse/orders/no-show
// @access  Private (Driver)
const reportNurseNoShow = async (req, res) => {
    try {
        const { bookingId, comments } = req.body;
        const staffId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            $or: [
                ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(bookingId) }] : []),
                { bookingId: String(bookingId).trim() }
            ],
            assignedStaffId: new mongoose.Types.ObjectId(staffId),
            status: { $in: ['Arrived', 'On-The-Way'] }
        };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Active booking in 'Arrived' or 'On-The-Way' state not found for this nurse staff." 
            });
        }

        const totalPaid = Number(booking.priceBreakdown?.totalPrice || booking.totalPrice || 0);
        let noShowFee = 0;

        // Fetch No-Show Policy for Nurse
        const config = await NoShowConfig.findOne({ vendorType: 'Nurse', isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage'
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        booking.status = 'No-Show';
        if (!booking.priceBreakdown) booking.priceBreakdown = {};
        booking.priceBreakdown.noShowFeeApplied = noShowFee;

        // Financial Fix: Only initiate refund if payment was actually completed online
        if (booking.paymentMethod === 'COD' || booking.paymentStatus !== 'Paid') {
            booking.paymentStatus = 'Failed'; // No money collected, no refund queued
        } else {
            booking.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';
        }

        booking.cancelReason = comments || "Nurse arrived on location but patient was unreachable.";
        await booking.save();

        // Credit 100% No-Show Compensation to Nurse Bureau Wallet (if policy applies and booking was online paid)
        if (noShowFee > 0 && booking.nurseId && booking.paymentMethod !== 'COD') {
            const { creditVendorCompensation } = require('../../../utils/policyHelper');
            await creditVendorCompensation(
                booking.nurseId, 
                'Nurse', 
                noShowFee, 
                booking.bookingId || booking._id.toString(), 
                'No-Show Fee'
            );
        }

        // Release nurse staff status back to available
        await Driver.findByIdAndUpdate(staffId, { 
            $set: { status: 'Available', isOnline: true } 
        });

        // Send alert to patient
        if (booking.userId) {
            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "Home Visit No-Show Recorded",
                    booking.paymentMethod === 'COD'
                        ? "Nurse arrived at your address but could not reach you. Booking marked as No-Show."
                        : `Nurse arrived at your address but could not reach you. No-Show fee of ₹${noShowFee} was applied.`,
                    { bookingId: booking._id.toString(), type: 'nurse_no_show' }
                );
            } catch (e) {}
        }

        res.status(200).json({ 
            success: true, 
            message: `Nursing No-Show logged successfully. Staff driver released to Available.`, 
            noShowFeeApplied: noShowFee,
            data: booking 
        });
    } catch (error) {
        console.error("Report Nurse No-Show Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    forgotPassword,
    verifyForgotOtp,
    resetPassword,
    changePassword,
    updateProfile,
    toggleDriverStatus,
    getNurseDashboard,
    getNurseBookings,
    getBookingDetail,
    respondToBooking,
    rejectBookingWithReason,
    startServiceJourney,
    arriveAtLocation,
    verifyOtpAndStartService,
    addProgressUpdate,
    submitServiceCompletion,
    verifyCompleteOtp,
    getAdminContact,
    getDriverHistory,
    getTermsAndConditions,
    getAboutContent,reportNurseNoShow
};