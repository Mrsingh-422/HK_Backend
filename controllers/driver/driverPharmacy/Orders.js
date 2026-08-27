// controllers/driver/driverPharmacy/Orders.js
const PharmacyBooking = require('../../../models/PharmacyBooking');
const Driver = require('../../../models/Driver');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
const MedicineInventory = require('../../../models/MedicineInventory');
const NoShowConfig = require('../../../models/NoShowConfig');


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


const updateProfile = async (req, res) => {
    try {
        // Extract only the fields allowed for update.
        // phone, email, password, and documents are excluded to prevent updates.
        const { name, address, alternateNumber } = req.body;
        const updateData = { name, address, alternateNumber };
 
        // Handle profile picture update if multi-file uploads are structured in req.files
        if (req.files && req.files.profilePic) {
            updateData.profilePic = req.files.profilePic[0].path;
        }
 
        // Update driver details while ignoring restricted fields
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

        const driver = await Driver.findById(driverId);
        const order = await PharmacyBooking.findById(orderId).populate('userId', 'fcmToken name');
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        order.deliveryStatus = 'OutForDelivery';
        order.status = 'Shipped';
        order.startedAt = new Date();
        await order.save();

        // 🚨 PATIENT ALERT: Order is on the way!
        if (order.userId) {
            await sendPushNotification(
                order.userId._id,
                'user',
                "Order Out for Delivery! 🚚",
                `Delivery partner ${driver?.name || ''} is on the way with your medicine parcel.`,
                { orderId: order._id.toString(), type: 'order_out_for_delivery' }
            );
        }

        res.json({ success: true, message: "Delivery route started!", data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// Arrived at Patient Location (Figma Screen 15 "Arrived" Button Action)
const arriveAtLocation = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        const order = await PharmacyBooking.findById(orderId).populate('userId', 'fcmToken name');
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation" });
        }

        // 🎲 Dynamic 4-Digit Delivery OTP
        const dynamicDeliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();

        order.deliveryStatus = 'ReachedLocation';
        order.deliveryOTP = dynamicDeliveryOtp;
        order.arrivedAt = new Date();
        await order.save();

        // 🚨 Push notification to patient with Delivery OTP
        if (order.userId) {
            await sendPushNotification(
                order.userId._id,
                'user',
                "Medicine Delivery Partner Arrived!",
                `Delivery partner ${driver?.name || ''} has arrived. Share Delivery OTP: ${dynamicDeliveryOtp} upon receiving medicine parcel.`,
                { orderId: order._id.toString(), otp: dynamicDeliveryOtp, type: 'pharmacy_delivery_otp' }
            );
        }

        res.json({ 
            success: true, 
            message: "Arrived at destination. Delivery OTP sent to customer.", 
            debugOtp: process.env.NODE_ENV === 'production' ? undefined : dynamicDeliveryOtp 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 2. VERIFY OTP & DELIVER (Fixed COD Payment Status auto-marking 'Paid')
// Endpoint: POST /driver/pharmacy/orders/verify-otp
const verifyOtpAndDeliver = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const driverId = req.user.id;

        if (!otp) {
            return res.status(400).json({ success: false, message: "Delivery OTP is required." });
        }

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized operation" });
        }

        // Strict OTP verification
        if (order.deliveryOTP !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: "Invalid Delivery OTP. Please collect valid OTP from customer." });
        }

        let deliveryProofs = [];
        if (req.files?.deliveryPic && req.files.deliveryPic.length > 0) {
            deliveryProofs = req.files.deliveryPic.map(f => f.path.replace(/\\/g, "/"));
        } else if (req.files?.pickupPhotos && req.files.pickupPhotos.length > 0) {
            deliveryProofs = req.files.pickupPhotos.map(f => f.path.replace(/\\/g, "/"));
        }

        if (deliveryProofs.length > 0) {
            order.deliveryProofPic = deliveryProofs[0];
            order.deliveryProofPics = deliveryProofs;
        }

        order.deliveryStatus = 'Delivered';
        order.status = 'Delivered';
        order.deliveredAt = new Date();
        order.deliveryOTP = null;

        // 🚨 CRITICAL FIX: If COD, mark payment as Paid upon successful delivery!
        if (order.paymentMethod === 'COD') {
            order.paymentStatus = 'Paid';
            if (!order.paymentDetails) order.paymentDetails = {};
            order.paymentDetails.status = 'captured';
            order.paymentDetails.paidAt = new Date();
            order.paymentDetails.method = 'COD';
        }

        await order.save();

        // Release driver back to Available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ 
            success: true, 
            message: "Medicine parcel delivered successfully & payment logged!", 
            data: order 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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

// REASSIGN PHARMACY ORDER DUE TO EMERGENCY (With Pharmacy Vendor Push Alert)
// Endpoint: POST /driver/pharmacy/reassign-emergency
const reassignOrderDueToEmergency = async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized." });
        }

        const pharmacyId = order.pharmacyId;

        order.driverId = null;
        order.deliveryStatus = 'PendingAssignment';
        order.rejectedBy.push(driverId);
        order.cancelReason = reason || "Emergency Release";
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        // 🚨 CRITICAL FIX: Alert Pharmacy Store that courier dropped parcel
        if (pharmacyId) {
            await sendPushNotification(
                pharmacyId,
                'pharmacy',
                "⚠️ Delivery Courier Emergency!",
                `Delivery partner ${driver?.name || ''} released Order #${order.orderId} due to emergency: "${reason || 'N/A'}". Please re-assign another driver.`,
                { orderId: order._id.toString(), type: 'courier_emergency_dropped' }
            );
        }

        res.json({ success: true, message: "Emergency reported. Order released and Pharmacy notified.", data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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


const reportPharmacyNoShow = async (req, res) => {
    try {
        const { orderId, comments } = req.body;
        const courierId = req.user.id;

        // 🚨 FIXED: Compatible with both Placed and Shipped active orders
        const order = await PharmacyBooking.findOne({ 
            _id: orderId, 
            driverId: courierId, 
            status: { $in: ['Placed', 'Shipped', 'Packed'] } 
        });

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: "Active delivery order not found for this driver." 
            });
        }

        const totalPaid = order.billSummary?.totalAmount || 0;
        let noShowFee = 0;

        const config = await NoShowConfig.findOne({ vendorType: 'Pharmacy', isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage'
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        order.status = 'No-Show';
        order.deliveryStatus = 'UserUnreachable';
        order.billSummary.noShowFeeApplied = noShowFee;
        order.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';
        order.cancelReason = comments || "Customer unreachable at delivery destination.";

        // Return reserved medicines back to pharmacy inventory
        for (const item of order.items) {
            if (item.medicineId) {
                await MedicineInventory.findOneAndUpdate(
                    { pharmacyId: order.pharmacyId, medicineId: item.medicineId },
                    { $inc: { stock_quantity: item.quantity || 1 }, $set: { is_available: true } }
                );
            }
        }

        // Release driver back to Available
        await Driver.findByIdAndUpdate(courierId, { status: 'Available' });

        await order.save();

        res.json({ 
            success: true, 
            message: "Medicine Delivery No-Show logged. Stock returned to inventory.", 
            noShowFeeApplied: noShowFee,
            data: order 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// =============================== RETURN PICKUP TASKS ==============================
// =========================================================================
// 1. GET DRIVER'S ASSIGNED RETURN TASKS
// Endpoint: GET /driver/pharmacy/return-pickups/my-tasks
const getMyReturnPickups = async (req, res) => {
    try {
        const driverId = req.user.id;

        const tasks = await PharmacyBooking.find({
            'returnDetails.pickupDriverId': driverId,
            'returnDetails.pickupStatus': { $in: ['Assigned', 'OutForPickup', 'ReachedLocation'] }
        })
        .populate('pharmacyId', 'name address phone')
        .populate('userId', 'name phone')
        .select('orderId address returnDetails items createdAt')
        .lean();

        res.json({
            success: true,
            count: tasks.length,
            data: tasks
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. UPDATE PICKUP TRIP STATUS (OutForPickup / ReachedLocation)
// Endpoint: PATCH /driver/pharmacy/return-pickups/status/:orderId
const updateReturnPickupStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { pickupStatus } = req.body; // 'OutForPickup' | 'ReachedLocation'
        const driverId = req.user.id;

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            'returnDetails.pickupDriverId': driverId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Pickup task not found or unauthorized." });
        }

        order.returnDetails.pickupStatus = pickupStatus;
        await order.save();

        res.json({
            success: true,
            message: `Pickup status updated to ${pickupStatus}`,
            data: order.returnDetails
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. VERIFY CUSTOMER RETURN OTP & COMPLETE PICKUP (Stock Restored & Refund Queued)
// Endpoint: POST /driver/pharmacy/return-pickups/verify-pickup
const verifyAndCompleteReturnPickup = async (req, res) => {
    try {
        const { orderId, returnOTP } = req.body;
        const driverId = req.user.id;

        if (!returnOTP) {
            return res.status(400).json({ success: false, message: "Customer Return OTP is required." });
        }

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            'returnDetails.pickupDriverId': driverId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Pickup task not found or unauthorized." });
        }

        // Verify Customer OTP
        if (order.returnDetails.returnOTP !== String(returnOTP).trim()) {
            return res.status(400).json({ success: false, message: "Invalid Return OTP. Please collect correct OTP from patient." });
        }

        // Capture multiple proof photos of collected item
        let collectedPhotos = [];
        if (req.files) {
            if (req.files.pickupPhotos && req.files.pickupPhotos.length > 0) {
                collectedPhotos = req.files.pickupPhotos.map(f => f.path.replace(/\\/g, "/"));
            } else if (req.files.deliveryPic && req.files.deliveryPic.length > 0) {
                collectedPhotos = req.files.deliveryPic.map(f => f.path.replace(/\\/g, "/"));
            }
        }

        order.returnDetails.pickupStatus = 'PickedUp';
        order.returnDetails.status = 'CollectedByDriver';
        order.returnDetails.driverCollectedPics = collectedPhotos;
        order.returnDetails.collectedAt = new Date();
        await order.save();

        // Release driver back to Available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({
            success: true,
            message: "Return package collected successfully with proof photos! Please handover the parcel to the pharmacy store.",
            data: {
                orderId: order.orderId,
                status: order.returnDetails.status,
                totalPhotosCaptured: order.returnDetails.driverCollectedPics.length,
                driverCollectedPics: order.returnDetails.driverCollectedPics
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// 3. 🚨 NEW: REPORT FAILED RETURN PICKUP (Doorstep Refusal / Customer Absent)
// Endpoint: POST /driver/pharmacy/return-pickups/report-failed
const reportFailedReturnPickup = async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        const driverId = req.user.id;

        if (!reason || reason.trim() === "") {
            return res.status(400).json({ success: false, message: "Failure reason is required (e.g. Customer unavailable)." });
        }

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            'returnDetails.pickupDriverId': driverId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Pickup task not found or unauthorized." });
        }

        order.returnDetails.pickupStatus = 'Cancelled';
        order.returnDetails.status = 'Requested'; // Reset back for re-assignment
        order.returnDetails.pickupDriverId = null;
        order.returnDetails.rejectionReason = `Pickup Failed by Driver: ${reason.trim()}`;
        await order.save();

        // 🚨 Free driver back to Available
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({
            success: true,
            message: "Pickup task released and reported. Driver is now Available.",
            data: order.returnDetails
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
    getAboutContent,
    reportPharmacyNoShow,

    getMyReturnPickups,
    updateReturnPickupStatus,
    verifyAndCompleteReturnPickup,
    reportFailedReturnPickup
};