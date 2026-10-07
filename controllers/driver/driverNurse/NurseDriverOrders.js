const NurseBooking = require('../../../models/NurseBooking');
const Driver = require('../../../models/Driver');
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


// ==========================================
// 3. BOOKING ACTIONS & STATES
// ==========================================

const getNurseDashboard = async (req, res) => {
    try {
        const staffId = req.user.id;

        // 1. Fetch Staff Driver Details
        const driver = await Driver.findById(staffId);
        if (!driver) return res.status(404).json({ success: false, message: "Staff account not found" });

        // 2. Count active assigned services
        const activeCount = await NurseBooking.countDocuments({
            assignedStaffId: staffId,
            status: { $in: ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] }
        });

        res.json({
            success: true,
            data: {
                driver: {
                    name: driver.name,
                    address: driver.address || "Tdi City Mohali, Punjab",
                    profilePic: driver.profilePic,
                    isOnline: driver.status !== 'Offline', // Available aur Busy are considered Online
                    status: driver.status
                },
                activeServicesCount: activeCount // Figma: "My Services" button inside 2
            }
        });
    } catch (error) {
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

// @desc    Get Detailed Nurse Booking for Field Staff (Includes OTPs, Consumables, Hospital Venue & Payment)
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

// Accept Assigned Booking (Figma Screen 5 popup)
const respondToBooking = async (req, res) => {
    try {
        const { action } = req.body; // 'Accept' or 'Reject'
        const { bookingId } = req.params;
        const staffId = req.user.id;

        const driver = await Driver.findById(staffId);
        if (action === 'Accept' && driver.status !== 'Available') {
            return res.status(400).json({ success: false, message: "You are currently Busy with another patient." });
        }

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (action === 'Accept') {
            booking.status = 'Assigned';
            await Driver.findByIdAndUpdate(staffId, { status: 'Busy' });
            await booking.save();
        } else {
            // Reject Action without comments goes here
            await NurseBooking.findByIdAndUpdate(bookingId, {
                $addToSet: { rejectedBy: staffId },
                assignedStaffId: null,
                status: 'Confirmed'
            });
        }
        res.json({ success: true, message: `Booking ${action}ed successfully` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Reject Booking with Reasons Form (Figma Screen 15, 19)
const rejectBookingWithReason = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { cancelReason, additionalComments } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findByIdAndUpdate(bookingId, {
            $addToSet: { rejectedBy: staffId },
            assignedStaffId: null,
            status: 'Confirmed', // Pool back
            cancelReason,
            additionalComments
        }, { new: true });

        // Driver Free again
        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        res.json({ success: true, message: "Booking rejected and logged successfully", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 1. ARRIVED AT LOCATION (Returns Patient Phone for Firebase SMS)
// Endpoint: PATCH /driver/nurse/orders/arrive/:bookingId
// ==========================================
const arriveAtLocation = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const staffId = req.user.id;

        const staff = await Driver.findById(staffId);
        const booking = await NurseBooking.findById(bookingId).populate('userId', 'fcmToken name phone');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.assignedStaffId && booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation" });
        }

        booking.status = 'Arrived';
        booking.arrivedAt = new Date();
        await booking.save();

        const patientPhone = booking.address?.phone || booking.userId?.phone;
        const cleanPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";
        const formattedPatientPhone = `+91${cleanPhone}`;

        if (booking.userId) {
            await sendPushNotification(
                booking.userId._id,
                'user',
                "Nurse Arrived at Your Home! 👩‍⚕️",
                `Nurse ${staff?.name || ''} has arrived. Please share the SMS verification OTP to begin care session.`,
                { bookingId: booking._id.toString(), type: 'nurse_arrived' }
            );
        }

        res.json({ 
            success: true, 
            message: "Nurse arrived at location. Trigger Firebase SMS OTP to start service.",
            patientPhone: formattedPatientPhone,
            bookingId: booking.bookingId 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// ==========================================
// 2. VERIFY FIREBASE OTP & START CARE TIMER
// Endpoint: POST /driver/nurse/orders/verify-start-otp
// ==========================================
const verifyOtpAndStartService = async (req, res) => {
    try {
        const { bookingId, idToken, otp } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId).populate('userId', 'phone');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.assignedStaffId && booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation" });
        }

        const patientPhone = booking.address?.phone || booking.userId?.phone;
        const cleanPatientPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";

        // 🚨 Verify Firebase Phone Token
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ success: false, message: "Firebase idToken is required to start service." });
            }
            const verification = await verifyFirebasePhoneToken(idToken, cleanPatientPhone);
            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        } else if (otp) {
            if (otp !== '123456') return res.status(400).json({ success: false, message: "Invalid Dev OTP." });
        } else {
            return res.status(400).json({ success: false, message: "Verification idToken is required." });
        }

        booking.status = 'Service-Started';
        booking.startedAt = new Date();
        await booking.save();

        res.json({ success: true, message: "Care session verified via Firebase & timer started!", data: booking });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// Live Service Progress Operations (Figma Screen 23 - Notes / Photos)
const addProgressUpdate = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { progressNotes } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        if (progressNotes) booking.serviceNotes = progressNotes;
        if (req.files && req.files.progressPhotos) {
            const paths = req.files.progressPhotos.map(file => file.path);
            booking.progressPhotos.push(...paths);
        }

        await booking.save();
        res.json({ success: true, message: "Progress data updated", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

// @desc    Verify Completion OTP with Multi-Day Daily OTP Regeneration & Extra Consumables Sync
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

        if (booking.assignedStaffId && booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation." });
        }

        const patientPhone = booking.address?.phone || booking.userId?.phone;
        const cleanPatientPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";

        // 1. Verify Firebase Phone Token or Dev OTP
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ success: false, message: "Firebase idToken is required." });
            }
            const verification = await verifyFirebasePhoneToken(idToken, cleanPatientPhone);
            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        } else if (otp) {
            if (otp !== '123456' && booking.completionOTP !== otp) {
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
            console.log(`📦 [DEBUG: verifyCompleteOtp] Synced on-spot charges: +₹${onSpotAddons} (New Grand Total: ₹${booking.totalPrice})`);
        }

        // 3. Multi-Day vs Single Day Lifecycle Evaluation
        const today = new Date();
        const hasMultipleDays = (booking.schedule?.duration === 'For Multiple Days' && booking.schedule?.endDate);
        const isMultiDayActive = hasMultipleDays && new Date(today.setHours(0,0,0,0)) < new Date(new Date(booking.schedule.endDate).setHours(0,0,0,0));

        if (isMultiDayActive) {
            // 🚨 MULTI-DAY ACTIVE: Session completed for today, regenerate fresh OTPs for tomorrow's visit!
            booking.status = 'Assigned';
            booking.serviceOTP = Math.floor(1000 + Math.random() * 9000).toString();
            booking.completionOTP = Math.floor(1000 + Math.random() * 9000).toString();
            console.log(`🔄 [DEBUG: verifyCompleteOtp] Multi-day session active. Regenerated Tomorrow's Start OTP: ${booking.serviceOTP}, End OTP: ${booking.completionOTP}`);
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
        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        // 5. Notify Patient
        try {
            await sendPushNotification(
                booking.userId,
                'user',
                isMultiDayActive ? "Today's Nursing Session Completed! 👩‍⚕️" : "Nursing Care Service Completed! ✨",
                isMultiDayActive 
                    ? `Today's session finished. Tomorrow's Start OTP is: ${booking.serviceOTP}.`
                    : `Your nursing service session #${booking.bookingId} has been successfully completed.`,
                { bookingId: booking._id.toString(), type: 'nurse_session_completed' }
            );
        } catch (e) {}

        res.json({ 
            success: true, 
            message: isMultiDayActive 
                ? "Today's session completed! Tomorrow's fresh OTPs generated and staff released." 
                : "Service completed successfully and marked as Paid!", 
            isMultiDayActive,
            nextSessionStartOtp: isMultiDayActive ? booking.serviceOTP : null,
            data: booking 
        });

    } catch (error) { 
        console.error("Verify Complete OTP Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in complete OTP verification." }); 
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
const reportNurseNoShow = async (req, res) => {
    try {
        const { bookingId, comments } = req.body;
        const staffId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(bookingId) : new mongoose.Types.ObjectId() },
                { bookingId: String(bookingId).trim() }
            ],
            assignedStaffId: new mongoose.Types.ObjectId(staffId),
            status: 'Arrived'
        };

        const booking = await NurseBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Active booking in 'Arrived' state not found for this nurse staff." 
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
        booking.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';
        booking.cancelReason = comments || "Nurse arrived on location but patient was unreachable.";

        await booking.save();

        // 🚨 CRITICAL FIX: Credit 100% No-Show Compensation to Nurse Bureau Wallet
        if (noShowFee > 0 && booking.nurseId) {
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
        try {
            await sendPushNotification(
                booking.userId,
                'user',
                "Home Visit No-Show Recorded",
                `Nurse arrived at your address but could not reach you. No-Show fee of ₹${noShowFee} was applied.`,
                { bookingId: booking._id.toString(), type: 'nurse_no_show' }
            );
        } catch (e) {}

        res.json({ 
            success: true, 
            message: `Home Nursing No-Show logged. ₹${noShowFee} compensation credited to Nurse Bureau wallet.`, 
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