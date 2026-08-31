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

// Get Services List with Status Tabs (Figma Screen 5)
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
                query.status = 'Cancelled';
            }
        }

        // 'userId' और 'patients' को select और populate किया गया है
        const bookings = await NurseBooking.find(query)
            .select('bookingId status schedule assessmentLocation address totalPrice createdAt cancelReason userId patients')
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 });

        // रिस्पॉन्स डेटा को फॉर्मेट करना ताकि स्ट्रक्चर बदले बिना अतिरिक्त जानकारी जोड़ी जा सके
        const formattedBookings = bookings.map(booking => {
            const bookingObj = booking.toObject();

            // 1. User का नाम निकालना
            const userName = bookingObj.userId ? bookingObj.userId.name : null;

            // 2. Patient का नाम निकालना (पहले पेशेंट का नाम)
            const patientName = bookingObj.patients && bookingObj.patients.length > 0 
                ? bookingObj.patients[0].name 
                : null;

            // 3. Address से name हटाना
            if (bookingObj.address) {
                delete bookingObj.address.name;
            }

            return {
                ...bookingObj,
                userName,
                patientName
            };
        });

        res.json({ success: true, data: formattedBookings });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// Get Booking Detail (Figma Screen 7, 23)
const getBookingDetail = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await NurseBooking.findById(bookingId)
            .populate('userId', 'name phone')
            .populate('selectedConsumables.consumableId');

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        const bookingObj = booking.toObject();

        // 1. User का नाम निकालना
        const userName = bookingObj.userId ? bookingObj.userId.name : null;

        // 2. Patient का नाम निकालना (पहले पेशेंट का नाम)
        const patientName = bookingObj.patients && bookingObj.patients.length > 0 
            ? bookingObj.patients[0].name 
            : null;

        // 3. Address से name हटाना
        if (bookingObj.address) {
            delete bookingObj.address.name;
        }

        // स्ट्रक्चर में बिना बदलाव किए नए फील्ड्स जोड़ना
        const updatedBooking = {
            ...bookingObj,
            userName,
            patientName
        };

        res.json({ success: true, data: updatedBooking });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
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

// Send OTP to Start Service (Figma Screen 22)
const arriveAtLocation = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const staffId = req.user.id;

        const staff = await Driver.findById(staffId);
        const booking = await NurseBooking.findById(bookingId).populate('userId', 'fcmToken name');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.assignedStaffId && booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation" });
        }

        // 🎲 Dynamic 4-Digit Service Start OTP
        const dynamicStartOtp = Math.floor(1000 + Math.random() * 9000).toString();

        booking.status = 'Arrived';
        booking.serviceOTP = dynamicStartOtp;
        booking.arrivedAt = new Date();
        await booking.save();

        // 🚨 Push notification to patient with Start OTP
        if (booking.userId) {
            await sendPushNotification(
                booking.userId._id,
                'user',
                "Nurse Arrived at Your Location!",
                `Nurse ${staff?.name || ''} has arrived. Share Start OTP: ${dynamicStartOtp} to begin care session.`,
                { bookingId: booking._id.toString(), otp: dynamicStartOtp, type: 'nurse_start_otp' }
            );
        }

        res.json({ 
            success: true, 
            message: "Arrived at location. Start OTP sent to patient.", 
            debugOtp: process.env.NODE_ENV === 'production' ? undefined : dynamicStartOtp 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// Confirm Start OTP (Figma Screen 8)
const verifyOtpAndStartService = async (req, res) => {
    try {
        const { bookingId, otp } = req.body;
        const staffId = req.user.id;

        if (!otp) {
            return res.status(400).json({ success: false, message: "Start OTP is required." });
        }

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.assignedStaffId && booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation" });
        }

        // Strict OTP check (Static '1111' removed)
        if (booking.serviceOTP !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: "Invalid OTP. Please collect valid OTP from patient." });
        }

        booking.status = 'Service-Started';
        booking.startedAt = new Date();
        booking.serviceOTP = null; // Clear OTP
        await booking.save();

        res.json({ success: true, message: "Service timer started successfully!", data: booking });
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

// Complete Service & Submit Consumables Form (Figma Screen 2, 7)
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

        const booking = await NurseBooking.findById(bookingId).populate('userId', 'fcmToken name');
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

        // 🎲 Dynamic 4-Digit Completion OTP
        const dynamicCompleteOtp = Math.floor(1000 + Math.random() * 9000).toString();
        booking.completionOTP = dynamicCompleteOtp;
        await booking.save();

        // 🚨 Alert patient with Completion OTP
        if (booking.userId) {
            await sendPushNotification(
                booking.userId._id,
                'user',
                "Nursing Session Finished!",
                `Session completed. Share Completion OTP: ${dynamicCompleteOtp} with nurse to finalize.`,
                { bookingId: booking._id.toString(), otp: dynamicCompleteOtp, type: 'nurse_completion_otp' }
            );
        }

        res.json({ 
            success: true, 
            message: "Session summary compiled. Completion OTP sent to patient.", 
            debugOtp: process.env.NODE_ENV === 'production' ? undefined : dynamicCompleteOtp 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// Confirm Complete OTP (Figma Screen 2, 8)
const verifyCompleteOtp = async (req, res) => {
    try {
        const { bookingId, otp } = req.body;
        const staffId = req.user.id;

        if (!otp) {
            return res.status(400).json({ success: false, message: "Completion OTP is required." });
        }

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.assignedStaffId && booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        // Strict Check
        if (booking.completionOTP !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: "Invalid Completion OTP." });
        }

        const today = new Date();
        const hasMultipleDays = booking.schedule?.duration === 'For Multiple Days' && booking.schedule?.endDate;
        const isMultiDayActive = hasMultipleDays && new Date(today.setHours(0,0,0,0)) < new Date(new Date(booking.schedule.endDate).setHours(0,0,0,0));

        if (isMultiDayActive) {
            booking.status = 'Assigned'; // Next shift scheduled
        } else {
            booking.status = 'Completed';
            booking.completedAt = new Date();
        }

        booking.serviceOTP = null;
        booking.completionOTP = null;
        await booking.save();

        // Release nurse staff back to Available
        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        res.json({ success: true, message: "Service completion verified successfully!", data: booking });
    } catch (error) { 
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

// A. Get Driver Completed/Cancelled History (Figma Screen 13)
const getDriverHistory = async (req, res) => {
    try {
        const staffId = req.user.id;

        // Drawer History tab ke liye completed aur cancelled bookings fetch karna
        const bookings = await NurseBooking.find({
            assignedStaffId: staffId,
            status: { $in: ['Completed', 'Cancelled'] }
        })
        .populate('userId', 'name phone')
        .sort({ updatedAt: -1 });

        // Figma Screen 13 ke format me map karna
        const formattedHistory = bookings.map(b => {
            const bObj = b.toObject();
            
            // Format dynamic values
            const formattedDate = bObj.schedule && bObj.schedule.startDate 
                ? moment(bObj.schedule.startDate).format('DD-MMMM-YYYY') 
                : "";
                
            const formattedTime = bObj.schedule 
                ? `${bObj.schedule.startTime} - ${bObj.schedule.endTime}` 
                : "";

            return {
                bookingId: bObj._id,
                orderId: bObj.bookingId || "N/A",
                patientName: bObj.patients && bObj.patients.length > 0 ? bObj.patients[0].name : "Self",
                mobileNo: bObj.address ? bObj.address.phone : (bObj.userId ? bObj.userId.phone : ""),
                location: bObj.address 
                    ? `${bObj.address.houseNo}, ${bObj.address.sector}, ${bObj.address.city}` 
                    : "N/A",
                date: formattedDate,
                time: formattedTime,
                status: bObj.status,
                totalPrice: bObj.totalPrice,
                cancelReason: bObj.cancelReason || null
            };
        });

        res.json({
            success: true,
            totalOrders: formattedHistory.length, // Figma: "2 Orders" count header
            data: formattedHistory
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
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

const reportNurseNoShow = async (req, res) => {
    try {
        const { bookingId, comments } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findOne({ _id: bookingId, assignedStaffId: staffId, status: 'Arrived' });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking must be in 'Arrived' state to report No-Show." });
        }

        const totalPaid = booking.priceBreakdown?.totalPrice || 0;
        let noShowFee = 0;

        const config = await NoShowConfig.findOne({ vendorType: 'Nurse', isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage'
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        booking.status = 'No-Show';
        booking.priceBreakdown.noShowFeeApplied = noShowFee;
        booking.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';
        booking.cancelReason = comments || "Nurse arrived on location but patient was unreachable.";

        await booking.save();

        // Release nurse staff status back to available
        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        res.json({ 
            success: true, 
            message: "Home Nursing No-Show logged successfully. Driver released and refund initiated.", 
            noShowFeeApplied: noShowFee,
            data: booking
        });
    } catch (error) {
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