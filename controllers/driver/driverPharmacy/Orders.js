const PharmacyBooking = require('../../../models/PharmacyBooking');
const Driver = require('../../../models/Driver');
const bcrypt = require('bcryptjs');
const moment = require('moment');

// ==========================================
// 1. AUTHENTICATION & PASSWORD OPERATIONS
// ==========================================

// Forgot Password - Send OTP (Figma Screen 11, 12)
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const driver = await Driver.findOne({ username: email, vendorType: 'Pharmacy' });
        if (!driver) return res.status(404).json({ message: "Pharmacy driver account not found" });

        driver.token = "1111"; // Static OTP
        await driver.save();

        res.json({ success: true, message: "OTP sent to your registered email", debugOtp: "1111" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Verify Forgot Password OTP (Figma Screen 11)
const verifyForgotOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const driver = await Driver.findOne({ username: email, token: otp });
        if (!driver) return res.status(400).json({ success: false, message: "Invalid OTP" });

        res.json({ success: true, message: "OTP verified successfully. You can now reset your password." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Reset Password (Figma Screen 11)
const resetPassword = async (req, res) => {
    try {
        const { email, password } = req.body;
        const driver = await Driver.findOne({ username: email });
        if (!driver) return res.status(404).json({ message: "Pharmacy driver account not found" });

        driver.password = await bcrypt.hash(String(password), 10);
        driver.token = null;
        await driver.save();

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Change Profile Password (Figma Screen 9)
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

// Update Profile Details (Figma Screen 21)
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
        res.json({ success: true, message: `Driver status updated to ${status}`, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// ==========================================
// 2. ORDER WORKFLOW MANAGEMENT
// ==========================================
// Get Pharmacy Driver Dashboard Overview (Figma Screen 2, 3 Map Card)
const getPharmacyDashboard = async (req, res) => {
    try {
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ success: false, message: "Pharmacy driver account not found" });

        // Count active deliveries (Delivered are completed, hence not counted in active)
        const activeCount = await PharmacyBooking.countDocuments({
            driverId,
            deliveryStatus: { $in: ['Accepted', 'OutForDelivery', 'ReachedLocation'] }
        });

        res.json({
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
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Orders List with Status Filters (Figma Screen 6)
const getDriverOrders = async (req, res) => {
    try {
        const driverId = req.user.id;
        const orders = await PharmacyBooking.find({ driverId })
            .select('orderId status deliveryStatus collectionType address billSummary createdAt')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Get Single Order Detail (Figma Screen 17, 18)
const getOrderDetail = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await PharmacyBooking.findById(orderId)
            .populate('userId', 'name phone')
            .populate('items.medicineId', 'name basePrice');

        if (!order) return res.status(404).json({ message: "Order not found" });
        res.json({ success: true, data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Accept / Reject Order Assignment (Figma Screen 6 "Accept" Action)
const respondToOrder = async (req, res) => {
    try {
        const { orderId, action } = req.body; 
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        if (action === 'Accept' && driver.status !== 'Available') {
            return res.status(400).json({ success: false, message: "You are currently Busy with another delivery." });
        }

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (action === 'Accept') {
            order.deliveryStatus = 'Accepted';
            await Driver.findByIdAndUpdate(driverId, { status: 'Busy' });
            await order.save();
        } else {
            await PharmacyBooking.findByIdAndUpdate(orderId, {
                $addToSet: { rejectedBy: driverId },
                driverId: null,
                deliveryStatus: 'PendingAssignment'
            });
        }

        res.json({ success: true, message: `Order ${action}ed successfully` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Start Trip (Figma Screen 6 "Start" Button Action)
const startDelivery = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        order.deliveryStatus = 'OutForDelivery';
        order.startedAt = new Date();
        await order.save();

        res.json({ success: true, message: "Delivery route started!", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Arrived at Patient Location (Figma Screen 15 "Arrived" Button Action)
const arriveAtLocation = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        order.deliveryStatus = 'ReachedLocation';
        order.deliveryOTP = '1111'; // Set static OTP
        order.arrivedAt = new Date();
        await order.save();

        res.json({ success: true, message: "Arrived at location. Static OTP sent to customer.", debugOtp: '1111' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Confirm OTP & Upload Proof photo to Deliver (Figma Screen 14, 15)
const verifyOtpAndDeliver = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        if (otp !== '1111' && order.deliveryOTP !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        // Apply Delivery Proof Photo
        if (req.files && req.files.deliveryPic) {
            order.deliveryProofPic = req.files.deliveryPic[0].path;
        }

        order.deliveryStatus = 'Delivered';
        order.status = 'Delivered';
        await order.save();

        // Release driver back to Available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Order Delivered Successfully!", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Return Order with Reason Form Submission (Figma Screen 13 "Return" Option)
const returnOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { returnReason } = req.body;
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        order.deliveryStatus = 'CancelledByDriver';
        order.status = 'Cancelled';
        order.returnReason = returnReason || "Returned to Store";
        await order.save();

        // Release driver back to Available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Order returned successfully. Driver is now Available.", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Support/Contact Admin Config (Figma Screen 10)
const getAdminContact = async (req, res) => {
    res.json({
        success: true,
        data: {
            phone: "+91 9876543210",
            email: "help@gmail.com"
        }
    });
};

// Reassign Order Due to Emergency (Figma Reassignment)
const reassignOrderDueToEmergency = async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized." });
        }

        order.driverId = null;
        order.deliveryStatus = 'PendingAssignment';
        order.rejectedBy.push(driverId);
        order.cancelReason = reason || "Emergency Release";
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Emergency reported. Delivery order released back to pool.", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 4. MISSING HISTORY & LEGAL APIs (Figma Sidebar Screens)
// ==========================================

// A. Get Pharmacy Driver Delivery History
const getDriverHistory = async (req, res) => {
    try {
        const driverId = req.user.id;

        // Delivered aur Cancelled bookings fetch karna
        const bookings = await PharmacyBooking.find({
            driverId,
            status: { $in: ['Delivered', 'Cancelled'] }
        })
        .populate('userId', 'name phone')
        .sort({ updatedAt: -1 });

        const formattedHistory = bookings.map(b => {
            const bObj = b.toObject();
            
            const formattedDate = bObj.createdAt 
                ? moment(bObj.createdAt).format('DD-MMMM-YYYY') 
                : "";

            return {
                bookingId: bObj._id,
                orderId: bObj.orderId || "N/A",
                patientName: bObj.address ? bObj.address.name : (bObj.userId ? bObj.userId.name : "Self"),
                mobileNo: bObj.address ? bObj.address.phone : (bObj.userId ? bObj.userId.phone : ""),
                location: bObj.address 
                    ? `${bObj.address.houseNo}, ${bObj.address.sector}, ${bObj.address.city}` 
                    : "N/A",
                date: formattedDate,
                time: bObj.appointmentTime || "",
                status: bObj.status,
                totalPrice: bObj.billSummary ? bObj.billSummary.totalAmount : 0,
                cancelReason: bObj.returnReason || bObj.cancelReason || null
            };
        });

        res.json({
            success: true,
            totalOrders: formattedHistory.length, // Figma list header
            data: formattedHistory
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// B. Get Terms & Conditions Document
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

// C. Get About Page Document
const getAboutContent = async (req, res) => {
    try {
        const aboutText = `
            Health Kangaroo - One Stop Healthcare Solution
            
            Our Pharmacy Delivery panel handles secure door-to-door medicine drops, customer signature verifications, dynamic trip routing, and return order management.
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


module.exports = { 
    forgotPassword,
    verifyForgotOtp,
    resetPassword,
    changePassword,
    updateProfile,
    toggleDriverStatus,
    getPharmacyDashboard,
    getDriverOrders, 
    getOrderDetail, 
    respondToOrder, 
    startDelivery,
    arriveAtLocation, 
    verifyOtpAndDeliver, 
    returnOrder,
    getAdminContact,
    reassignOrderDueToEmergency,
    getDriverHistory,
    getTermsAndConditions,
    getAboutContent
};