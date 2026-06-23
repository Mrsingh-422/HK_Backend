const NurseBooking = require('../../../models/NurseBooking');
const Driver = require('../../../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

// Update Profile Details (Figma Screen 13)
const updateProfile = async (req, res) => {
    try {
        const { name, phone, email, address } = req.body;
        const updateData = { name, phone, username: email, address };

        if (req.file) {
            updateData.profilePic = req.file.path;
        }

        const driver = await Driver.findByIdAndUpdate(req.user.id, updateData, { new: true });
        res.json({ success: true, message: "Profile updated successfully", data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        booking.status = 'Arrived';
        booking.serviceOTP = '1111'; // Static OTP
        await booking.save();

        res.json({ success: true, message: "Arrived at location. Verification OTP generated.", otpSent: true, debugOtp: '1111' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Confirm Start OTP (Figma Screen 8)
const verifyOtpAndStartService = async (req, res) => {
    try {
        const { bookingId, otp } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        if (otp !== '1111' && booking.serviceOTP !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        booking.status = 'Service-Started';
        booking.startedAt = new Date(); // Start service duration timer
        await booking.save();

        res.json({ success: true, message: "Service started successfully!", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
            consumablesSelected, // Array format: [{"name":"Gloves", "price":200}]
            totalConsumableCharges, 
            earlyCompleteNotes, 
            extraServicePayment 
        } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        // Apply completion inputs
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

        if (req.files && req.files.handmadeInvoice) {
            booking.handmadeInvoice = req.files.handmadeInvoice[0].path;
        }

        // Trigger safe static completion OTP '1111'
        booking.completionOTP = '1111';
        await booking.save();

        res.json({ success: true, message: "Service data compiled. Please verify OTP to complete.", debugOtp: "1111" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Confirm Complete OTP (Figma Screen 2, 8)
const verifyCompleteOtp = async (req, res) => {
    try {
        const { bookingId, otp } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        if (otp !== '1111' && booking.completionOTP !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        // Multi-day checking
        const today = new Date();
        const endDate = new Date(booking.schedule.endDate);
        const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

        if (booking.schedule.duration === 'For Multiple Days' && todayDateOnly < endDateOnly) {
            booking.status = 'Assigned'; // Next shift scheduled
            booking.serviceOTP = null;
            booking.completionOTP = null;
        } else {
            booking.status = 'Completed';
            booking.completedAt = new Date();
            booking.serviceOTP = null;
            booking.completionOTP = null;
        }

        await booking.save();

        // Release nurse staff to Available
        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        res.json({ success: true, message: "Service completion verified successfully!", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

module.exports = {
    forgotPassword,
    verifyForgotOtp,
    resetPassword,
    changePassword,
    updateProfile,
    toggleDriverStatus,
    getNurseBookings,
    getBookingDetail,
    respondToBooking,
    rejectBookingWithReason,
    arriveAtLocation,
    verifyOtpAndStartService,
    addProgressUpdate,
    submitServiceCompletion,
    verifyCompleteOtp,
    getAdminContact
};