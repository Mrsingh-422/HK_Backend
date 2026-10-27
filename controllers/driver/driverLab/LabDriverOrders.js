const LabBooking = require('../../../models/LabBooking');
const Driver = require('../../../models/Driver');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const User = require('../../../models/User');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const NoShowConfig = require('../../../models/NoShowConfig');
const mongoose = require('mongoose');
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest'); // For handling profile update requests
const { deleteFile } = require('../../../utils/fileHandler');
const { sendPushNotification } = require('../../../utils/notification');
const { verifyFirebasePhoneToken } = require('../../../utils/firebaseAuthHelper');

// Razorpay Utilities integration
const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay');

// ==========================================
// 💡 RECALCULATE PRICING ENGINE (Updated to use discountPrice & offerPrice)
// ==========================================
const recalculateBookingPrice = async (bookingId) => {
    const booking = await LabBooking.findById(bookingId)
        .populate('items.tests.testId')
        .populate('items.packages.packageId');
        
    if (!booking) return null;

    let singlePatientCost = 0;
    
    // Add individual test costs (using schema's discountPrice or amount fallback)
    if (booking.items.tests) {
        booking.items.tests.forEach(t => {
            if (t.testId) {
                singlePatientCost += Number(t.testId.discountPrice || t.testId.amount || 0);
            }
        });
    }

    // Add individual package costs (using schema's offerPrice or mrp fallback)
    if (booking.items.packages) {
        booking.items.packages.forEach(p => {
            if (p.packageId) {
                singlePatientCost += Number(p.packageId.offerPrice || p.packageId.mrp || 0);
            }
        });
    }

    const patientCount = booking.patients.length || 1;
    const subtotal = singlePatientCost * patientCount;
    
    const tax = Math.round(subtotal * 0.05); 
    const grandTotal = subtotal + tax;

    booking.totalPrice = grandTotal;
    
    if (!booking.billSummary) {
        booking.billSummary = {};
    }
    booking.billSummary.itemTotal = subtotal;
    booking.billSummary.taxAmount = tax;
    booking.billSummary.totalAmount = grandTotal;

    await booking.save();
    return booking;
};

// ==========================================
// 1. AUTHENTICATION & PASSWORD OPERATIONS
// ==========================================

// Forgot Password - Send OTP (Figma Screen 10)
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const driver = await Driver.findOne({ username: email, vendorType: 'Lab' });
        if (!driver) return res.status(404).json({ message: "Phlebotomist account not found" });

        driver.token = "1111"; // Static OTP
        await driver.save();

        res.json({ success: true, message: "OTP sent to registered email", debugOtp: "1111" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Verify Forgot Password OTP (Figma Screen 10)
const verifyForgotOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const driver = await Driver.findOne({ username: email, token: otp });
        if (!driver) return res.status(400).json({ success: false, message: "Invalid OTP" });

        res.json({ success: true, message: "OTP verified successfully. Proceed to reset." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Reset Password (Figma Screen 10)
const resetPassword = async (req, res) => {
    try {
        const { email, password } = req.body;
        const driver = await Driver.findOne({ username: email });
        if (!driver) return res.status(404).json({ message: "Phlebotomist account not found" });

        driver.password = await bcrypt.hash(String(password), 10);
        driver.token = null;
        await driver.save();

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Change Profile Password (Figma Screen 18)
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
        const driverId = req.user.id;
        const { name, address, alternateNumber } = req.body;
       
        const updates = { name, address, alternateNumber };
 
        if (req.files && req.files.profilePic) {
            updates.profilePic = req.files.profilePic[0].path;
        } else if (req.file) {
            updates.profilePic = req.file.path;
        }

        // 🚨 DISK CLEANUP: Delete unapproved files from any existing PENDING request
        const existingPending = await ProfileUpdateRequest.findOne({ vendorId: driverId, vendorModel: 'Driver', status: 'Pending' });
        if (existingPending) {
            if (updates.profilePic && existingPending.updatedFields?.profilePic) {
                deleteFile(existingPending.updatedFields.profilePic);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }
 
        const request = await ProfileUpdateRequest.create({
            vendorId: driverId,
            vendorModel: 'Driver',
            updatedFields: updates,
            status: 'Pending'
        });
 
        res.json({ 
            success: true, 
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.", 
            data: request 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const getLatestDriverProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Driver'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// Switch Duty Availability Status (Figma Screen 4, 5)
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; 
        const driver = await Driver.findByIdAndUpdate(req.user.id, { status }, { new: true });
        res.json({ success: true, message: `Status updated to ${status}`, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// ==========================================
// 2. WORKFLOW & DIAGNOSTIC MANAGEMENT
// ==========================================

// @desc    Get Lab Phlebotomist Dashboard Overview (Counts In-Transit & Collection Tasks)
// @route   GET /driver/lab/dashboard
// @access  Private (Driver)
const getLabDashboard = async (req, res) => {
    try {
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ success: false, message: "Phlebotomist account not found" });

        // 🚨 BUG FIX: Include both 'Sample Collected' and 'Sample on the way to lab' in active tasks
        const activeCount = await LabBooking.countDocuments({
            phlebotomistId: driverId,
            status: { 
                $in: [
                    'Phlebotomist Assigned', 
                    'Arrived', 
                    'Sample Collected', 
                    'Sample on the way to lab' 
                ] 
            }
        });

        res.status(200).json({
            success: true,
            data: {
                driver: {
                    name: driver.name,
                    address: driver.address || "Tdi City Mohali, Punjab",
                    profilePic: driver.profilePic,
                    isOnline: driver.status !== 'Offline',
                    status: driver.status
                },
                activeServicesCount: activeCount
            }
        });
    } catch (error) {
        console.error("Get Lab Dashboard Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get All Lab Assigned Orders (Maintains visibility during sample transit & deposit)
// @route   GET /driver/lab/orders/list?tab=Active
// @access  Private (Driver)
const getDriverOrders = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;
        const { tab } = req.query; // 'Active' | 'Complete' | 'Cancelled'
        
        let query = { phlebotomistId };

        // 🚨 BUG FIX: Correctly map both new statuses into the respective tabs
        if (tab === 'Active') {
            query.status = { 
                $in: [
                    'Phlebotomist Assigned', 
                    'Arrived', 
                    'Sample Collected', 
                    'Sample on the way to lab' 
                ] 
            };
        } else if (tab === 'Complete') {
            query.status = { 
                $in: [
                    'Sample Delivered to Lab', 
                    'Sample Deposited', 
                    'Testing', 
                    'Report Generated', 
                    'Completed' 
                ] 
            };
        } else if (tab === 'Cancelled') {
            query.status = { $in: ['Cancelled', 'No-Show'] };
        }

        const orders = await LabBooking.find(query)
            .select('bookingId status collectionType address appointmentDate appointmentTime totalPrice billSummary createdAt sampleTransitStartedAt sampleDeliveredToLabAt')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ 
            success: true, 
            count: orders.length, 
            data: orders 
        });
    } catch (error) { 
        console.error("Get Driver Orders Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// Get Single Lab Booking Detail (Figma Screen 23)
const getOrderDetail = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const order = await LabBooking.findById(bookingId)
            .populate('userId', 'name phone address')
            .populate('items.tests.testId', 'testName discountPrice amount')
            .populate('items.packages.packageId', 'packageName offerPrice mrp');

        if (!order) return res.status(404).json({ message: "Booking not found" });
        res.json({ success: true, data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Respond to Assigned Order (Figma Screen 9 "Accept" Action)
const respondToOrder = async (req, res) => {
    try {
        const { action } = req.body; 
        const { orderId } = req.params;
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        if (action === 'Accept' && driver.status !== 'Available') {
            return res.status(400).json({ success: false, message: "You are currently Busy with another trip." });
        }

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (action === 'Accept') {
            order.status = 'Phlebotomist Assigned'; 
            await Driver.findByIdAndUpdate(driverId, { status: 'Busy' });
            await order.save();
        } else {
            await LabBooking.findByIdAndUpdate(orderId, {
                $addToSet: { rejectedBy: driverId },
                phlebotomistId: null,
                status: 'Confirmed'
            });
        }
        res.json({ success: true, message: `Order ${action}ed successfully` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Start Trip Delivery (Figma Screen 9 "Start Service" Button)
const startDelivery = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        order.status = 'Phlebotomist Assigned'; 
        order.startedAt = new Date();
        await order.save();

        res.json({ success: true, message: "Sample collection trip started!", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 1. ARRIVED AT PATIENT HOME (Returns Patient Phone for Firebase SMS)
// Endpoint: PATCH /driver/lab/orders/arrive/:orderId
// ==========================================
const arriveAtLocation = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        const order = await LabBooking.findById(orderId).populate('userId', 'fcmToken name phone');
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation" });
        }

        order.arrivedAt = new Date();
        order.status = 'Arrived';
        await order.save();

        // Customer contact details
        const patientPhone = order.address?.phone || order.userId?.phone;
        const cleanPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";
        const formattedPatientPhone = `+91${cleanPhone}`;

        // Alert patient that phlebotomist has arrived
        if (order.userId) {
            await sendPushNotification(
                order.userId._id,
                'user',
                "Phlebotomist Arrived! 🩸",
                `Phlebotomist ${driver?.name || ''} has arrived for diagnostic blood collection. Please share the SMS verification OTP with the staff.`,
                { bookingId: order._id.toString(), type: 'lab_phlebotomist_arrived' }
            );
        }

        res.json({ 
            success: true, 
            message: "Phlebotomist arrived at patient location. Trigger Firebase SMS OTP to patient's phone.",
            patientPhone: formattedPatientPhone, // 👈 Phlebotomist App uses this to trigger Firebase SMS
            bookingId: order.bookingId 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// @desc    Verify Doorstep Sample Collection via Firebase Token OR Patient App OTP
// @route   POST /driver/lab/orders/verify-otp
// @access  Private (Driver)
const verifySampleCollection = async (req, res) => {
    try {
        const { orderId, idToken, otp } = req.body;
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId).populate('userId', 'phone');
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ success: false, message: "Unauthorized. You are not assigned to this booking." });
        }

        const patientPhone = order.address?.phone || order.userId?.phone;
        const cleanPatientPhone = patientPhone ? patientPhone.trim().replace(/\D/g, "").slice(-10) : "";

        // 1. Firebase Phone Auth Verification
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Firebase idToken is required for sample collection verification." 
                });
            }

            const verification = await verifyFirebasePhoneToken(idToken, cleanPatientPhone);
            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        } 
        // 2. Direct 6-Digit OTP Handshake (Accepts patient app live OTP or dev 123456)
        else if (otp) {
            const incomingOtp = String(otp).trim();
            const bookedOtp = order.tracking?.otp ? String(order.tracking.otp).trim() : null;
            const isMatch = (incomingOtp === '123456' || (bookedOtp && bookedOtp === incomingOtp));

            if (!isMatch) {
                return res.status(400).json({ success: false, message: "Invalid OTP code entered." });
            }
        } else {
            return res.status(400).json({ success: false, message: "Verification idToken or OTP code is required." });
        }

        order.status = 'Sample Collected';
        order.collectedAt = new Date();
        await order.save();

        res.status(200).json({ 
            success: true, 
            message: "Sample collected and verified successfully! Please deposit sample at lab.", 
            data: order 
        });
    } catch (error) { 
        console.error("Verify Sample Collection Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};
// @desc    Phlebotomist starts journey from patient location to lab with collected samples
// @route   PATCH /driver/lab/orders/transit-to-lab/:orderId
// @access  Private (Driver)
const startSampleTransitToLab = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(orderId);
        const query = {
            ...(isObjectId ? { _id: orderId } : { bookingId: String(orderId).trim() }),
            phlebotomistId: driverId
        };

        const order = await LabBooking.findOne(query)
            .populate('userId', 'name phone fcmToken')
            .populate('labId', 'name');

        if (!order) {
            return res.status(404).json({ success: false, message: "Active booking order not found for this phlebotomist." });
        }

        if (order.status !== 'Sample Collected') {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot start transit to lab. Current status is '${order.status}'. Please collect sample first.` 
            });
        }

        // Update status to 'Sample on the way to lab'
        order.status = 'Sample on the way to lab';
        order.sampleTransitStartedAt = new Date();
        await order.save();

        const driverName = req.user?.name || "Phlebotomist";

        // Notify Patient
        if (order.userId) {
            try {
                await sendPushNotification(
                    order.userId._id,
                    'user',
                    "🧪 Sample On The Way To Lab",
                    `Phlebotomist ${driverName} is now carrying your collected diagnostic sample to ${order.labId?.name || 'the testing laboratory'}.`,
                    {
                        type: 'LAB_SAMPLE_IN_TRANSIT',
                        serviceType: 'Lab',
                        bookingId: String(order.bookingId),
                        id: String(order._id),
                        status: 'Sample on the way to lab',
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                );
            } catch (e) {
                console.error("Sample Transit Push Error:", e.message);
            }
        }

        res.status(200).json({ 
            success: true, 
            message: "Sample is now on the way to the laboratory.", 
            data: order 
        });
    } catch (error) {
        console.error("Start Sample Transit Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Phlebotomist deposits sample at lab reception & releases driver status to Available
// @route   POST /driver/lab/orders/deliver-lab/:orderId
// @access  Private (Driver)
const deliverSampleToLab = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { labDepositName } = req.body; 
        const driverId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(orderId);
        const query = {
            ...(isObjectId ? { _id: orderId } : { bookingId: String(orderId).trim() }),
            phlebotomistId: driverId
        };

        const order = await LabBooking.findOne(query)
            .populate('userId', 'name phone fcmToken')
            .populate('labId', 'name');

        if (!order) return res.status(404).json({ success: false, message: "Order not found or unauthorized." });

        // Update status to 'Sample Delivered to Lab'
        order.status = 'Sample Delivered to Lab';
        order.labDepositName = labDepositName || order.labId?.name || "Lab Sample Processing Center";
        order.depositedAt = new Date();
        order.sampleDeliveredToLabAt = new Date();
        await order.save();

        // Release Phlebotomist Driver back to Available
        await Driver.findByIdAndUpdate(driverId, { $set: { status: 'Available', isOnline: true } });

        // Notify Patient
        if (order.userId) {
            try {
                await sendPushNotification(
                    order.userId._id,
                    'user',
                    "🏥 Sample Delivered to Lab",
                    `Your diagnostic sample has been safely delivered to ${order.labDepositName}. Testing will begin shortly.`,
                    {
                        type: 'LAB_SAMPLE_DELIVERED',
                        serviceType: 'Lab',
                        bookingId: String(order.bookingId),
                        id: String(order._id),
                        status: 'Sample Delivered to Lab',
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                );
            } catch (e) {
                console.error("Sample Delivered Push Error:", e.message);
            }
        }

        res.status(200).json({ 
            success: true, 
            message: "Sample delivered to lab successfully. Phlebotomist is now Available!", 
            data: order 
        });
    } catch (error) { 
        console.error("Deliver Sample To Lab Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Create Fresh Diagnostic Booking from Patient's House (Links real Patient User ID)
// @route   POST /driver/lab/orders/create
// @access  Private (Driver)
const createBookingAtHome = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;
        const driver = await Driver.findById(phlebotomistId);
        if (!driver) return res.status(404).json({ success: false, message: "Phlebotomist profile not found" });

        const { 
            name, dob, phone, gender, address, city, pincode, 
            testsSelected, 
            packagesSelected 
        } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ success: false, message: "Patient Name and Phone number are required." });
        }

        const cleanPhone = String(phone).trim().replace(/\D/g, "").slice(-10);

        // 1. Find or create the Patient User Account so it doesn't link to Driver's ID
        let targetPatientUser = await User.findOne({ phone: cleanPhone });
        if (!targetPatientUser) {
            const tempPassword = await bcrypt.hash('Patient@123', 10);
            targetPatientUser = await User.create({
                name: name.trim(),
                phone: cleanPhone,
                countryCode: '+91',
                password: tempPassword,
                role: 'user',
                isPhoneVerified: true,
                profileStatus: 'Approved'
            });
        }

        const bookingId = "ORD-" + Math.random().toString(36).substring(2, 10).toUpperCase();

        let newOrder = await LabBooking.create({
            bookingId,
            userId: targetPatientUser._id, // 👈 Saved actual patient user account
            labId: driver.vendorId,        // Lab vendor
            bookingType: "Direct",
            patients: [{
                patientId: "Self",
                name: name.trim(),
                age: dob ? Math.max(1, new Date().getFullYear() - new Date(dob).getFullYear()) : 30,
                gender: gender || "Male",
                relation: "Self"
            }],
            items: {
                tests: Array.isArray(testsSelected) ? testsSelected.map(id => ({ testId: id })) : [],
                packages: Array.isArray(packagesSelected) ? packagesSelected.map(id => ({ packageId: id })) : []
            },
            collectionType: "Home Collection",
            address: {
                name: name.trim(),
                phone: cleanPhone,
                houseNo: address || "",
                city: city || "",
                pincode: pincode || "",
                addressType: "Home"
            },
            status: "Phlebotomist Assigned",
            phlebotomistId
        });

        newOrder = await recalculateBookingPrice(newOrder._id);

        res.status(201).json({ 
            success: true, 
            message: "Diagnostic booking registered and linked to patient account successfully!", 
            data: newOrder 
        });
    } catch (error) { 
        console.error("Create Booking At Home Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Add Family Members to Existing Doorstep Booking (Auto-generates required patientId)
// @route   POST /driver/lab/orders/add-family/:bookingId
// @access  Private (Driver)
const addFamilyToBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        let { familyList } = req.body; 

        if (typeof familyList === 'string') {
            try { familyList = JSON.parse(familyList); } catch (e) {}
        }

        if (!Array.isArray(familyList) || familyList.length === 0) {
            return res.status(400).json({ success: false, message: "Valid non-empty familyList array is required." });
        }

        let order = await LabBooking.findById(bookingId);
        if (!order) return res.status(404).json({ success: false, message: "Booking not found." });

        // Ensure patientId is never null/undefined to prevent schema validation failure
        const formattedMembers = familyList.map((m, idx) => ({
            patientId: m.patientId ? String(m.patientId).trim() : `Fam-${Date.now()}-${idx + 1}`,
            name: m.name ? String(m.name).trim() : "Family Member",
            age: Number(m.age) || 30,
            gender: m.gender || "Male",
            relation: m.relation || "Family"
        }));

        if (!Array.isArray(order.patients)) {
            order.patients = [];
        }

        order.patients.push(...formattedMembers);
        await order.save();

        order = await recalculateBookingPrice(bookingId);

        res.status(200).json({ 
            success: true, 
            message: `${formattedMembers.length} family member(s) added successfully. Price updated.`, 
            data: order 
        });
    } catch (error) { 
        console.error("Add Family To Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// Add New Tests/Packages Dynamically
const appendItemsToBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { testIds, packageIds } = req.body; 

        let order = await LabBooking.findById(bookingId);
        if (!order) return res.status(404).json({ message: "Booking not found" });

        if (testIds) {
            const mappedTests = testIds.map(id => ({ testId: id }));
            order.items.tests.push(...mappedTests);
        }

        if (packageIds) {
            const mappedPkgs = packageIds.map(id => ({ packageId: id }));
            order.items.packages.push(...mappedPkgs);
        }

        await order.save();

        order = await recalculateBookingPrice(bookingId);

        res.json({ success: true, message: "Items successfully appended to booking", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// Support Config
const getAdminContact = async (req, res) => {
    res.json({
        success: true,
        data: {
            phone: "+91 9876543210",
            email: "help@gmail.com"
        }
    });
};

// @desc    Reassign Lab Order due to Driver Emergency (Blocks if blood sample is already in driver possession)
// @route   POST /driver/lab/orders/reassign-emergency
// @access  Private (Driver)
const reassignLabOrderDueToEmergency = async (req, res) => {
    try {
        const { bookingId, reason } = req.body;
        const driverId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            ...(isObjectId ? { _id: bookingId } : { bookingId: String(bookingId).trim() }),
            phlebotomistId: driverId
        };

        const order = await LabBooking.findOne(query);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found or unauthorized operation." });
        }

        // 🚨 SECURITY GUARD: Prevent driver from abandoning an order once physical blood sample is drawn!
        if (order.status === 'Sample Collected' || order.status === 'Sample on the way to lab') {
            return res.status(400).json({
                success: false,
                message: "Security Block: Patient sample has already been collected and is in your possession. You cannot drop this duty. Please deposit the sample at the laboratory or contact your lab supervisor immediately."
            });
        }

        const labId = order.labId;

        order.phlebotomistId = null;
        order.status = 'Confirmed'; 
        order.cancelReason = reason || "Emergency Release by Phlebotomist";
        
        if (!Array.isArray(order.rejectedBy)) {
            order.rejectedBy = [];
        }
        order.rejectedBy.push(driverId);
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { $set: { status: 'Available', isOnline: true } });

        // Alert Lab Vendor to reassign another staff
        if (labId) {
            try {
                await sendPushNotification(
                    labId,
                    'lab',
                    "⚠️ Phlebotomist Emergency Reported!",
                    `Phlebotomist reported emergency for Order #${order.bookingId}: "${reason || 'Emergency'}". Order returned to pool for reassignment.`,
                    { orderId: order._id.toString(), type: 'driver_emergency_dropped' }
                );
            } catch (e) {}
        }

        res.status(200).json({ 
            success: true, 
            message: "Lab collection duty released and Lab Vendor notified.", 
            data: order 
        });
    } catch (error) { 
        console.error("Reassign Lab Order Emergency Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Get Phlebotomist Service History (Includes Sample Delivered to Lab orders)
// @route   GET /driver/lab/orders/history
// @access  Private (Driver)
const getDriverHistory = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;

        // 🚨 BUG FIX: Include 'Sample Delivered to Lab' and in-lab statuses in history
        const bookings = await LabBooking.find({
            phlebotomistId,
            status: { 
                $in: [
                    'Sample Delivered to Lab', 
                    'Sample Deposited', 
                    'Testing', 
                    'Report Generated', 
                    'Completed', 
                    'Cancelled', 
                    'No-Show'
                ] 
            }
        })
        .populate('userId', 'name phone')
        .sort({ updatedAt: -1 })
        .lean();

        const formattedHistory = bookings.map(bObj => {
            const formattedDate = bObj.appointmentDate 
                ? moment(bObj.appointmentDate).format('DD-MMMM-YYYY') 
                : moment(bObj.createdAt).format('DD-MMMM-YYYY');

            return {
                bookingId: bObj._id,
                orderId: bObj.bookingId || "N/A",
                patientName: bObj.patients && bObj.patients.length > 0 ? bObj.patients[0].name : "Self",
                mobileNo: bObj.address ? bObj.address.phone : (bObj.userId ? bObj.userId.phone : ""),
                location: bObj.address 
                    ? `${bObj.address.houseNo || ''}, ${bObj.address.city || ''}, ${bObj.address.pincode || ''}`.replace(/^, |, $/g, '') 
                    : "N/A",
                date: formattedDate,
                time: bObj.appointmentTime || "",
                status: bObj.status,
                totalPrice: bObj.totalPrice || bObj.billSummary?.totalAmount || 0,
                cancelReason: bObj.cancelReason || bObj.noShowComments || null,
                deliveredAt: bObj.sampleDeliveredToLabAt || bObj.depositedAt || null
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

// Get Terms & Conditions Document
const getTermsAndConditions = async (req, res) => {
    try {
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

// Get About Page Document
const getAboutContent = async (req, res) => {
    try {
        const aboutText = `
            Health Kangaroo - One Stop Healthcare Solution
            
            Our Phlebotomist panel ensures seamless home diagnostic collections with dynamic tracking systems, verified OTP validations, and automated laboratory deposits workflows.
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

// ==========================================
// 5. RAZORPAY DOORSTEP PAYMENT FLOW
// ==========================================

const createDoorstepOrder = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const driverId = req.user.id;

        const booking = await LabBooking.findOne({ _id: bookingId, phlebotomistId: driverId });
        if (!booking) return res.status(404).json({ success: false, message: "Active booking not found" });

        const amountToPay = booking.totalPrice || 100; 

        const receiptId = `receipt_doorstep_${bookingId.substring(18)}_${Date.now()}`;
        const order = await createRazorpayOrder(amountToPay, receiptId);

        res.status(200).json({
            success: true,
            orderId: order.id,
            amount: amountToPay,
            currency: "INR",
            keyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error("Doorstep Payment Order Creation Failure:", error);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

const verifyDoorstepPayment = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const driverId = req.user.id;

        const booking = await LabBooking.findOne({ _id: bookingId, phlebotomistId: driverId });
        if (!booking) return res.status(404).json({ success: false, message: "Active booking not found" });

        const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);

        if (isValid) {
            const paymentDetails = await fetchAndMapRazorpayPayment(razorpay_payment_id, razorpay_signature);
            
            booking.paymentStatus = 'Paid';
            booking.paymentMethod = paymentDetails ? paymentDetails.method : 'Online';
            if (paymentDetails) {
                booking.paymentDetails = paymentDetails;
            } else {
                booking.paymentDetails = {
                    razorpayPaymentId: razorpay_payment_id,
                    razorpayOrderId: razorpay_order_id,
                    razorpaySignature: razorpay_signature,
                    status: 'captured',
                    paidAt: new Date()
                };
            }
            
            await booking.save();

            res.status(200).json({
                success: true,
                message: "Doorstep QR Payment verified and logged successfully!",
                data: booking
            });
        } else {
            res.status(400).json({
                success: false,
                message: "Invalid signature, verification failed."
            });
        }
    } catch (error) {
        console.error("Signature Verification Error:", error);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

const collectCashPayment = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const driverId = req.user.id;

        const booking = await LabBooking.findOne({ _id: bookingId, phlebotomistId: driverId });
        if (!booking) return res.status(404).json({ success: false, message: "Active booking not found" });

        booking.paymentStatus = 'Paid';
        booking.paymentMethod = 'Cash';
        booking.paymentDetails = {
            method: 'Cash',
            amount: booking.totalPrice || 0,
            status: 'captured',
            paidAt: new Date()
        };
        await booking.save();

        res.status(200).json({
            success: true,
            message: "Cash Payment collected and marked paid successfully!",
            data: booking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 💡 6. NEW ADD-ONS: ACTIVE TESTS & PACKAGES LISTINGS (Screenshot 9, 10)
// ==========================================

// A. List Available Lab Tests (Figma Screenshot 9)
const getAvailableTests = async (req, res) => {
    try {
        const driverId = req.user.id;
        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

        const { search } = req.query;
        let query = { labId: driver.vendorId, isActive: true };

        // Support dynamic text search matching Screenshot 9
        if (search) {
            query.testName = { $regex: search, $options: 'i' };
        }

        const tests = await LabTest.find(query);
        res.json({ success: true, count: tests.length, data: tests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// B. List Available Lab Packages (Figma Screenshot 10 Selection support)
const getAvailablePackages = async (req, res) => {
    try {
        const driverId = req.user.id;
        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

        const { search } = req.query;
        let query = { labId: driver.vendorId, isActive: true };

        if (search) {
            query.packageName = { $regex: search, $options: 'i' };
        }

        const packages = await LabPackage.find(query);
        res.json({ success: true, count: packages.length, data: packages });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// C. Get Single Package Detail with Populated Included Master Tests (Figma Screenshot 10 Checklist)
const getPackageDetail = async (req, res) => {
    try {
        const { packageId } = req.params;
        const packageData = await LabPackage.findById(packageId)
            .populate('tests', 'testName sampleType mainCategory'); // Populates test list included

        if (!packageData) {
            return res.status(404).json({ success: false, message: "Lab Package details not found" });
        }

        res.json({ success: true, data: packageData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// Reject Lab Order with Reasons Form (Figma Screen 26 style)
// endpoint: PATCH /driver/lab/orders/reject-reason/:orderId
const rejectOrderWithReason = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { cancelReason, additionalComments } = req.body;
        const driverId = req.user.id;

        const order = await LabBooking.findByIdAndUpdate(orderId, {
            $addToSet: { rejectedBy: driverId },
            phlebotomistId: null,
            status: 'Confirmed', // Pool back to original pool
            cancelReason,
            noShowComments: additionalComments // Map custom comments safely
        }, { new: true });

        // Phlebotomist Driver status released back to Available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Collection duty rejected and pooled back successfully", data: order });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const reportNoResponse = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { noShowComments } = req.body; 
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        const totalPaid = order.billSummary?.totalAmount || 0;
        let noShowFee = 0;

        const config = await NoShowConfig.findOne({ vendorType: 'Lab', isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage'
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        order.status = 'No-Show';
        order.noShowComments = noShowComments || "Patient not responding";
        order.cancelReason = "No Show - Patient Unreachable";
        
        if (!order.billSummary) order.billSummary = {};
        order.billSummary.noShowFeeApplied = noShowFee;
        order.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';

        await order.save();

        // Release Phlebotomist status back to available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ 
            success: true, 
            message: "Home Collection No-Show logged successfully. Driver released.", 
            noShowFeeApplied: noShowFee,
            data: order 
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
    updateProfile,getLatestDriverProfileRequest,
    toggleDriverStatus,
    getLabDashboard,
    getDriverOrders,
    getOrderDetail,
    respondToOrder,
    startDelivery,
    arriveAtLocation,
    verifySampleCollection,
    startSampleTransitToLab,deliverSampleToLab,
    reportNoResponse,
    createBookingAtHome,
    addFamilyToBooking,
    appendItemsToBooking,
    getAdminContact,
    reassignLabOrderDueToEmergency,
    getDriverHistory,
    getTermsAndConditions,
    getAboutContent,
    createDoorstepOrder,
    verifyDoorstepPayment,
    collectCashPayment,

    // Missing listings exports shamil
    getAvailableTests,
    getAvailablePackages,
    getPackageDetail,
    rejectOrderWithReason
};