const LabBooking = require('../../../models/LabBooking');
const Driver = require('../../../models/Driver');
const LabTest = require('../../../models/LabTest'); // 👈 Added Schema
const LabPackage = require('../../../models/LabPackage'); // 👈 Added Schema
const bcrypt = require('bcryptjs');
const moment = require('moment');
const NoShowConfig = require('../../../models/NoShowConfig');
const mongoose = require('mongoose');
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest'); // For handling profile update requests
const { deleteFile } = require('../../../utils/fileHandler');
const { sendPushNotification } = require('../../../utils/notification');

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

// Get Lab Phlebotomist Dashboard Overview (Figma Screen 2, 3 Map Card)
const getLabDashboard = async (req, res) => {
    try {
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ success: false, message: "Phlebotomist account not found" });

        // Count active collections
        const activeCount = await LabBooking.countDocuments({
            phlebotomistId: driverId,
            status: { $in: ['Phlebotomist Assigned', 'Sample Collected'] }
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

// Get All Lab Assigned Orders (Upgraded with dynamic status-filtering tabs)
// endpoint: GET /driver/lab/orders/list?tab=Active
const getDriverOrders = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;
        const { tab } = req.query; // Expects: 'Active' | 'Complete' | 'Cancelled' | undefined (All)
        
        let query = { phlebotomistId };

        // Figma tab level filters application
        if (tab === 'Active') {
            query.status = { $in: ['Phlebotomist Assigned', 'Sample Collected', 'Arrived'] };
        } else if (tab === 'Complete') {
            query.status = { $in: ['Sample Deposited', 'Completed'] };
        } else if (tab === 'Cancelled') {
            query.status = 'Cancelled';
        }

        const orders = await LabBooking.find(query)
            .select('bookingId status collectionType address appointmentDate appointmentTime totalPrice billSummary createdAt')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: orders.length, data: orders });
    } catch (error) { 
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

// Reach Patient Location (Figma Screen 2/3 "Arrive" Action)
const arriveAtLocation = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        const order = await LabBooking.findById(orderId).populate('userId', 'fcmToken name');
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ success: false, message: "Unauthorized operation" });
        }

        // 🎲 Dynamic Cryptographic 4-Digit OTP
        const dynamicOtp = Math.floor(1000 + Math.random() * 9000).toString();

        if (!order.tracking) order.tracking = {};
        order.tracking.otp = dynamicOtp;
        order.arrivedAt = new Date();
        order.status = 'Arrived';
        await order.save();

        // 🚨 SEND REAL-TIME PUSH NOTIFICATION TO PATIENT WITH OTP
        if (order.userId) {
            await sendPushNotification(
                order.userId._id,
                'user',
                "Phlebotomist Arrived!",
                `Phlebotomist ${driver?.name || ''} has arrived for sample collection. Share OTP: ${dynamicOtp} to start collection.`,
                { bookingId: order._id.toString(), otp: dynamicOtp, type: 'sample_collection_otp' }
            );
        }

        console.log(`[LAB OTP]: Generated Sample OTP for Order #${order.bookingId}: ${dynamicOtp}`);

        res.json({ 
            success: true, 
            message: "Arrived at location. Verification OTP sent to patient.",
            debugOtp: process.env.NODE_ENV === 'production' ? undefined : dynamicOtp 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// Verify OTP and Collect Blood Sample
const verifySampleCollection = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const driverId = req.user.id;

        if (!otp) {
            return res.status(400).json({ success: false, message: "Sample collection OTP is required." });
        }

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        // Strict Dynamic OTP Check (Static '2468' bypass removed)
        if (order.tracking?.otp !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: "Invalid OTP. Please collect correct OTP from patient." });
        }

        order.status = 'Sample Collected';
        order.collectedAt = new Date();
        order.tracking.otp = null; // Invalidate OTP after use
        await order.save();

        res.json({ 
            success: true, 
            message: "Sample collected successfully. Please deposit at processing lab.", 
            data: order 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// Delivered Sample to Lab (Figma Screen 6 & 12)
const deliverSampleToLab = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { labDepositName } = req.body; 
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

// ==========================================
// 3. DYNAMIC BOOKING & PATIENT ADDITIONS (Figma 14, 15, 16, 17, 24)
// ==========================================

// Create Fresh Diagnostic Booking from Patient's House (Figma Screen 14, 15)
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

        const bookingId = "ORD-" + Math.random().toString(36).substring(2, 10).toUpperCase();

        // 🚨 FIXED: labId is driver's vendorId, not driver himself
        let newOrder = await LabBooking.create({
            bookingId,
            userId: req.user.id, // Fallback link
            labId: driver.vendorId, // 👈 Target Lab assigned
            bookingType: "Direct",
            patients: [{
                patientId: "Self",
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

        newOrder = await recalculateBookingPrice(newOrder._id);

        res.status(201).json({ success: true, message: "Diagnostic booking registered successfully!", data: newOrder });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// Add Family Members to Existing Booking
const addFamilyToBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { familyList } = req.body; 

        let order = await LabBooking.findById(bookingId);
        if (!order) return res.status(404).json({ message: "Booking not found" });

        order.patients.push(...familyList);
        await order.save();

        order = await recalculateBookingPrice(bookingId);

        res.json({ success: true, message: "Family members added successfully", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

// REASSIGN LAB ORDER DUE TO EMERGENCY (With Vendor Push Alert)
// Endpoint: POST /driver/lab/orders/reassign-emergency
const reassignLabOrderDueToEmergency = async (req, res) => {
    try {
        const { bookingId, reason } = req.body;
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        const order = await LabBooking.findById(bookingId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized." });
        }

        const labId = order.labId; // Target Lab Vendor

        order.phlebotomistId = null;
        order.status = 'Confirmed'; 
        order.cancelReason = reason || "Emergency Release";
        order.rejectedBy.push(driverId);
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        // 🚨 CRITICAL FIX: Alert Lab Vendor that duty has been dropped
        if (labId) {
            await sendPushNotification(
                labId,
                'lab',
                "⚠️ Phlebotomist Emergency Reported!",
                `Phlebotomist ${driver?.name || ''} dropped Order #${order.bookingId} due to emergency: "${reason || 'N/A'}". Please re-assign another staff immediately.`,
                { orderId: order._id.toString(), type: 'driver_emergency_dropped' }
            );
        }

        res.json({ success: true, message: "Lab collection duty released and Vendor notified.", data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 4. MISSING HISTORY & LEGAL APIs
// ==========================================

// Get Phlebotomist Service History
const getDriverHistory = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;

        const bookings = await LabBooking.find({
            phlebotomistId,
            status: { $in: ['Sample Deposited', 'Completed', 'Cancelled'] }
        })
        .populate('userId', 'name phone')
        .sort({ updatedAt: -1 });

        const formattedHistory = bookings.map(b => {
            const bObj = b.toObject();
            
            const formattedDate = bObj.appointmentDate 
                ? moment(bObj.appointmentDate).format('DD-MMMM-YYYY') 
                : "";

            return {
                bookingId: bObj._id,
                orderId: bObj.bookingId || "N/A",
                patientName: bObj.patients && bObj.patients.length > 0 ? bObj.patients[0].name : "Self",
                mobileNo: bObj.address ? bObj.address.phone : (bObj.userId ? bObj.userId.phone : ""),
                location: bObj.address 
                    ? `${bObj.address.houseNo}, ${bObj.address.city}, ${bObj.address.pincode}` 
                    : "N/A",
                date: formattedDate,
                time: bObj.appointmentTime || "",
                status: bObj.status,
                totalPrice: bObj.totalPrice || 0,
                cancelReason: bObj.cancelReason || bObj.noShowComments || null
            };
        });

        res.json({
            success: true,
            totalOrders: formattedHistory.length, 
            data: formattedHistory
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
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
    deliverSampleToLab,
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