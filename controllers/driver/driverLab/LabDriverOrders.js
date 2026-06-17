const LabBooking = require('../../../models/LabBooking');
const Driver = require('../../../models/Driver');
const bcrypt = require('bcryptjs');

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

// Update Profile Details
const updateProfile = async (req, res) => {
    try {
        const { name, phone, email, address } = req.body;
        const updateData = { name, phone, username: email, address };

        if (req.files && req.files.profilePic) {
            updateData.profilePic = req.files.profilePic[0].path;
        }

        const driver = await Driver.findByIdAndUpdate(req.user.id, updateData, { new: true });
        res.json({ success: true, message: "Profile updated successfully", data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Switch Duty Availability Status (Figma Screen 4, 5)
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'Available' or 'Offline'
        const driver = await Driver.findByIdAndUpdate(req.user.id, { status }, { new: true });
        res.json({ success: true, message: `Status updated to ${status}`, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// ==========================================
// 2. WORKFLOW & DIAGNOSTIC MANAGEMENT
// ==========================================

// Get All Lab Assigned Orders (Figma Screen 9)
const getDriverOrders = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;
        const orders = await LabBooking.find({ phlebotomistId })
            .select('bookingId status collectionType address appointmentDate appointmentTime createdAt')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Get Single Lab Booking Detail (Figma Screen 23)
const getOrderDetail = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const order = await LabBooking.findById(bookingId)
            .populate('userId', 'name phone address')
            .populate('items.tests.testId', 'name price')
            .populate('items.packages.packageId', 'name price');

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

        order.status = 'Phlebotomist Assigned'; // Keep assigned but log start
        order.startedAt = new Date();
        await order.save();

        res.json({ success: true, message: "Sample collection trip started!", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Reach Patient Location (Figma Screen 2/3 "Arrive" Action)
const arriveAtLocation = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        if (!order.tracking) {
            order.tracking = {};
        }
        order.tracking.otp = '1111'; // Set Static OTP
        order.arrivedAt = new Date();
        await order.save();

        res.json({ success: true, message: "Arrived at location. Static OTP generated.", debugOtp: '1111' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Verify OTP and Collect Blood Sample (Figma Screen 2, 3, 10, 11)
const verifySampleCollection = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        if (otp !== '1111' && order.tracking?.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        order.status = 'Sample Collected';
        order.collectedAt = new Date();
        await order.save();

        res.json({ success: true, message: "Sample collected successfully. Please proceed to HK Lab.", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Delivered Sample to Lab (Figma Screen 6 & 12)
const deliverSampleToLab = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { labDepositName } = req.body; // e.g. "HK Lab"
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        order.status = 'Sample Deposited';
        order.labDepositName = labDepositName || "HK Lab";
        order.depositedAt = new Date();
        await order.save();

        // Release Phlebotomist Driver back to Available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Sample delivered to lab successfully. You are now Available!", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// No Response / No Show Action (Figma Screen 21 "No Response" button)
const reportNoResponse = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { noShowComments } = req.body; // e.g. "No Show after 3 calls"
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        order.status = 'Cancelled';
        order.noShowComments = noShowComments || "Patient not responding";
        order.cancelReason = "No Show - Patient Unreachable";
        await order.save();

        // Release Phlebotomist
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "No Response reported. Booking cancelled.", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// ==========================================
// 3. DYNAMIC BOOKING & PATIENT ADDITIONS (Figma 14, 15, 16, 17, 24)
// ==========================================

// Create Fresh Diagnostic Booking from Patient's House (Figma Screen 14, 15)
const createBookingAtHome = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;
        const { 
            name, dob, phone, gender, address, city, pincode, 
            testsSelected, // Array of LabTest ObjectIds
            packagesSelected // Array of LabPackage ObjectIds
        } = req.body;

        // Custom bookingId generator
        const bookingId = "ORD-" + Math.random().toString(36).substring(2, 10).toUpperCase();

        const newOrder = await LabBooking.create({
            bookingId,
            userId: req.user.id, // Phlebotomist handles creation
            labId: req.user.id, // Auto-link to logged-in phlebotomist's lab / profile
            bookingType: "Direct",
            patients: [{
                name,
                age: dob ? new Date().getFullYear() - new Date(dob).getFullYear() : 30,
                gender,
                relation: "Self"
            }],
            items: {
                tests: testsSelected ? testsSelected.map(id => ({ testId: id })) : [],
                packages: packagesSelected ? packagesSelected.map(id => ({ packageId: id })) : []
            },
            collectionType: "Home Collection",
            address: {
                name,
                phone,
                houseNo: address,
                city,
                pincode,
                addressType: "Home"
            },
            status: "Phlebotomist Assigned",
            phlebotomistId
        });

        res.status(201).json({ success: true, message: "Diagnostic booking registered successfully!", data: newOrder });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Add Family Members to Existing Booking (Figma Screen 23, 24)
const addFamilyToBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { familyList } = req.body; // Array of objects: [{"name":"Yash User", "age":32, "gender":"Male"}]

        const order = await LabBooking.findById(bookingId);
        if (!order) return res.status(404).json({ message: "Booking not found" });

        // Append to patients array
        order.patients.push(...familyList);
        await order.save();

        res.json({ success: true, message: "Family members added successfully", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Add New Tests/Packages Dynamically (Figma Screen 16, 17)
const appendItemsToBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { testIds, packageIds } = req.body; // Arrays of ObjectIds

        const order = await LabBooking.findById(bookingId);
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
        res.json({ success: true, message: "Items successfully appended to booking", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// Support Config (Figma Screen 10)
const getAdminContact = async (req, res) => {
    res.json({
        success: true,
        data: {
            phone: "+91 9876543210",
            email: "help@gmail.com"
        }
    });
};

// Reassign Order due to Emergency
const reassignLabOrderDueToEmergency = async (req, res) => {
    try {
        const { bookingId, reason } = req.body;
        const driverId = req.user.id;

        const order = await LabBooking.findById(bookingId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized." });
        }

        order.phlebotomistId = null;
        order.status = 'Confirmed'; 
        order.cancelReason = reason || "Emergency Release";
        order.rejectedBy.push(driverId);
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Lab collection duty released for reassignment.", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    forgotPassword,
    verifyForgotOtp,
    resetPassword,
    changePassword,
    updateProfile,
    toggleDriverStatus,
    getDriverOrders,
    getOrderDetail,
    respondToOrder,
    startDelivery,
    arriveAtLocation,
    verifySampleCollection,
    deliverSampleToLab,
    reportNoResponse,
    createBookingAtHome,
    addFamilyToBooking,
    appendItemsToBooking,
    getAdminContact,
    reassignLabOrderDueToEmergency
};