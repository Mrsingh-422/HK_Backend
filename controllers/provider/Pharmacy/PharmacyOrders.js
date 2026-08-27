const PharmacyBooking = require('../../../models/PharmacyBooking');
const Driver = require('../../../models/Driver');
const PharmacyPrescriptionRequest = require("../../../models/PharmacyPrescriptionRequest");
const mongoose = require('mongoose');
const Medicine = require('../../../models/Medicine');
const moment = require('moment');
const Wallet = require('../../../models/Wallet');
const HsnMaster = require('../../../models/HsnMaster'); // Import HSN Master model
const MedicineInventory = require('../../../models/MedicineInventory');

// 🔢 Helper: Indian Currency Number to Words Converter
const numberToWordsIndian = (num) => {
    if (!num || isNaN(num) || num <= 0) return "RUPEES ZERO ONLY";
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const inWords = (n) => {
        if (n === 0) return '';
        let str = '';
        if (n >= 10000000) { str += inWords(Math.floor(n / 10000000)) + 'Crore '; n %= 10000000; }
        if (n >= 100000) { str += inWords(Math.floor(n / 100000)) + 'Lakh '; n %= 100000; }
        if (n >= 1000) { str += inWords(Math.floor(n / 1000)) + 'Thousand '; n %= 1000; }
        if (n >= 100) { str += inWords(Math.floor(n / 100)) + 'Hundred '; n %= 100; }
        if (n > 0) {
            if (n < 20) str += a[n];
            else str += b[Math.floor(n / 10)] + ' ' + a[n % 10];
        }
        return str;
    };

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);
    let result = 'RUPEES ' + inWords(rupees).trim();
    if (paise > 0) result += ' AND ' + inWords(paise).trim() + ' PAISE';
    return (result + ' ONLY').toUpperCase();
};


// NEW: GET PHARMACY DASHBOARD STATS
// Endpoint: GET /provider/pharmacy/orders/dashboard-stats
const getPharmacyDashboardStats = async (req, res) => {
    try {
        const pharmacyId = req.user.id;

        const stats = await PharmacyBooking.aggregate([
            { $match: { pharmacyId: new mongoose.Types.ObjectId(pharmacyId) } },
            {
                $group: {
                    _id: null,
                    pendingRequests: { $sum: { $cond: [{ $in: ["$status", ["Placed", "Pending"]] }, 1, 0] } },
                    priorityRequests: { 
                        $sum: { 
                            $cond: [
                                { 
                                    $and: [
                                        { $in: ["$status", ["Placed", "Pending"]] }, 
                                        { $gt: ["$billSummary.rapidDeliveryCharge", 0] }
                                    ] 
                                }, 
                                1, 
                                0
                            ] 
                        } 
                    },
                    activeOrders: { $sum: { $cond: [{ $in: ["$status", ["Packed", "Shipped", "Accepted", "OutForDelivery"]] }, 1, 0] } },
                    completedOrders: { $sum: { $cond: [{ $in: ["$status", ["Delivered", "Completed"]] }, 1, 0] } },
                    totalEarnings: { $sum: { $cond: [{ $in: ["$status", ["Delivered", "Completed"]] }, "$billSummary.totalAmount", 0] } },
                    
                    // 🚨 2. NEW: Pending Returns Badge Counter
                    pendingReturns: { $sum: { $cond: [{ $eq: ["$returnDetails.status", "Requested"] }, 1, 0] } }
                }
            }
        ]);

        const wallet = await Wallet.findOne({ vendorId: pharmacyId });

        const result = stats[0] || {
            pendingRequests: 0,
            priorityRequests: 0,
            activeOrders: 0,
            completedOrders: 0,
            totalEarnings: 0,
            pendingReturns: 0
        };

        res.json({
            success: true,
            data: {
                pendingRequests: result.pendingRequests,
                priorityRequests: result.priorityRequests,
                activeOrders: result.activeOrders,
                completedOrders: result.completedOrders,
                totalEarnings: result.totalEarnings,
                walletBalance: wallet?.balance || 0,
                pendingReturns: result.pendingReturns // 👈 Returns Tab Badge Counter
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// Endpoint: GET /provider/pharmacy/orders/list
// Endpoint: GET /provider/pharmacy/orders/list?returnStatus=Requested
const getPharmacyOrders = async (req, res) => {
    try {
        const { orderType, status, isPriority, returnStatus } = req.query; 
        let query = { pharmacyId: req.user.id };
        
        if (orderType) query.orderType = orderType;
        if (status) query.status = status;

        if (isPriority === 'true') {
            query['billSummary.rapidDeliveryCharge'] = { $gt: 0 };
        } else if (isPriority === 'false') {
            query['billSummary.rapidDeliveryCharge'] = 0;
        }

        // 🚨 1. NEW: RETURN / REPLACEMENT FILTER
        // returnStatus = 'Requested' (Pending returns), 'Approved', 'Rejected', ya 'All'
        if (returnStatus) {
            if (returnStatus === 'All') {
                query['returnDetails.status'] = { $ne: 'None' }; // Sabhi return wale orders
            } else {
                query['returnDetails.status'] = returnStatus; // e.g. 'Requested'
            }
        }

        const orders = await PharmacyBooking.find(query)
            .select('-deliveryOTP -paymentDetails.razorpaySignature -paymentDetails.razorpayOrderId -rejectedBy -__v')
            .populate('userId', 'name phone')
            .populate('driverId', 'name phone profilePic vehicleNumber')
            .populate({
                path: 'pharmacyId',
                select: 'name documents.cinNumber documents.gstNumber documents.drugLicenseNumber documents.signatureImage'
            })
            .populate({
                path: 'items.comboOfferId',
                select: 'campaignDisplayName buyQty getFreeQty projectedPromoMargin'
            })
            .sort({ createdAt: -1 })
            .lean();

        // Add root-level helper flags for frontend badge rendering
        const enrichedOrders = orders.map(order => {
            const hasComboApplied = order.items.some(item => item.isComboApplied === true);
            const isReturnRequested = order.returnDetails && order.returnDetails.status === 'Requested';
            
            return {
                ...order,
                hasComboApplied,
                isReturnRequested // 👈 Helper: True if pending return action required
            };
        });

        res.json({ 
            success: true, 
            count: enrichedOrders.length,
            data: enrichedOrders 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. GET AVAILABLE DRIVERS (Figma: Assign Delivery Boy list)
// Endpoint: GET /provider/pharmacy/orders/available-drivers
const getAvailableDrivers = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        // Sirf wahi drivers jo is pharmacy se linked hain aur 'Available' hain
        const drivers = await Driver.find({
            vendorId: pharmacyId,
            status: 'Available'
        }).select('name phone profilePic status vehicleNumber vehicleType');

        res.json({ success: true, data: drivers });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. MANUAL ASSIGN DRIVER
// Endpoint: POST /provider/pharmacy/orders/assign-manual
const assignDriverManual = async (req, res) => {
    try {
        const { orderId, driverId } = req.body;
        
        const driver = await Driver.findById(driverId);
        if (!driver || driver.status !== 'Available') {
            return res.status(400).json({ message: "Driver is no longer available" });
        }

        const order = await PharmacyBooking.findByIdAndUpdate(orderId, {
            driverId,
            deliveryStatus: 'Assigned',
            status: 'Shipped', // Jab driver assign ho jaye toh status Shipped kar sakte hain
            assignedAt: new Date()
        }, { new: true });

        // Driver ko Busy mark karein
        await Driver.findByIdAndUpdate(driverId, { status: 'Busy' });

        res.json({ success: true, message: "Driver assigned successfully", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. AUTO-ASSIGN LOGIC (Background Process)
const triggerAutoAssignment = async (orderId) => {
    const order = await PharmacyBooking.findById(orderId);
    if (!order || order.deliveryStatus !== 'PendingAssignment') return;

    const nextDriver = await Driver.findOne({
        vendorId: order.pharmacyId,
        status: 'Available',
        _id: { $nin: order.rejectedBy }
    });

    if (nextDriver) {
        order.driverId = nextDriver._id;
        order.deliveryStatus = 'Assigned';
        order.assignedAt = new Date();
        await order.save();

        // 2 Minute Timer
        setTimeout(async () => {
            const checkOrder = await PharmacyBooking.findById(orderId);
            // 🚨 Check lagaya gaya hai ki agar driver ne abhi tak accept nahi kiya aur reassign nahi hua
            if (checkOrder && checkOrder.deliveryStatus === 'Assigned' && String(checkOrder.driverId) === String(nextDriver._id)) {
                checkOrder.rejectedBy.push(checkOrder.driverId);
                checkOrder.driverId = null;
                checkOrder.deliveryStatus = 'PendingAssignment';
                await checkOrder.save();
                triggerAutoAssignment(orderId); 
            }
        }, 120000); 
    }
};

// 5. REASSIGN DRIVER (Jab tak driver accept na kare)
// Endpoint: POST /provider/pharmacy/orders/reassign
const reassignDriverManual = async (req, res) => {
    try {
        const { orderId, newDriverId, isReturnReassignment = false } = req.body;
        const pharmacyId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        const newDriver = await Driver.findById(newDriverId);
        if (!newDriver || newDriver.status !== 'Available') {
            return res.status(400).json({ message: "New driver is not available" });
        }

        // --- CASE A: REASSIGN FOR RETURN PICKUP ---
        if (isReturnReassignment || (order.returnDetails && order.returnDetails.status === 'Approved')) {
            if (order.returnDetails.pickupStatus === 'PickedUp' || order.returnDetails.pickupStatus === 'DeliveredToStore') {
                return res.status(400).json({ message: "Cannot reassign. Parcel is already collected by current driver." });
            }

            if (order.returnDetails.pickupDriverId) {
                await Driver.findByIdAndUpdate(order.returnDetails.pickupDriverId, { status: 'Available' });
            }

            order.returnDetails.pickupDriverId = newDriverId;
            order.returnDetails.pickupStatus = 'Assigned';
            await order.save();

            await Driver.findByIdAndUpdate(newDriverId, { status: 'Busy' });

            await sendPushNotification(newDriverId, 'driver', "Reassigned Return Pickup!", `You are now assigned to collect return for Order #${order.orderId}.`);

            return res.json({ success: true, message: "Return pickup reassigned to new driver successfully!", data: order });
        }

        // --- CASE B: REASSIGN FOR NORMAL DELIVERY ---
        const restrictedStatuses = ['Accepted', 'PickedUp', 'OutForDelivery', 'Delivered'];
        if (restrictedStatuses.includes(order.deliveryStatus)) {
            return res.status(400).json({ 
                message: `Cannot reassign. Order is already ${order.deliveryStatus} by the current driver.` 
            });
        }

        if (order.driverId) {
            await Driver.findByIdAndUpdate(order.driverId, { status: 'Available' });
            if (!order.rejectedBy.includes(order.driverId)) {
                order.rejectedBy.push(order.driverId);
            }
        }

        order.driverId = newDriverId;
        order.deliveryStatus = 'Assigned';
        order.assignedAt = new Date();
        await order.save();

        await Driver.findByIdAndUpdate(newDriverId, { status: 'Busy' });

        res.json({ 
            success: true, 
            message: "Order reassigned to new driver successfully", 
            data: order 
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// UPDATE ORDER STATUS (e.g. Packed, Shipped, Delivered, Cancelled)
// Endpoint: PATCH /provider/pharmacy/orders/status/:orderId
const updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, deliveryStatus } = req.body;
        const pharmacyId = req.user.id;

        // 🔍 DEBUG LOG: API triggers parameters printing
        console.log(`\x1b[36m[DEBUG] updateOrderStatus: Deployed for orderId: "${orderId}", status: "${status}", deliveryStatus: "${deliveryStatus}"\x1b[0m`);

        // Coordinate dynamic checks
        const isObjectId = mongoose.Types.ObjectId.isValid(orderId.trim());
        const query = { pharmacyId };

        if (isObjectId) {
            query._id = orderId.trim();
        } else {
            query.orderId = orderId.trim();
        }

        const order = await PharmacyBooking.findOne(query);
        if (!order) {
            console.warn(`\x1b[33m[DEBUG] updateOrderStatus: Order not found in DB with query:`, query, `\x1b[0m`);
            return res.status(400).json({ 
                success: false, 
                message: `Business Error: Order not found or unauthorized to update status for order: '${orderId}'` 
            });
        }

        // Apply fields dynamically if present in request body
        if (status) order.status = status;
        if (deliveryStatus) order.deliveryStatus = deliveryStatus;

        // Save order changes
        await order.save();
        console.log(`\x1b[32m[DEBUG] updateOrderStatus: Order status successfully saved to DB.\x1b[0m`);

        res.json({
            success: true,
            message: `Order status successfully updated to '${order.status}'`,
            data: order
        });
    } catch (error) {
        // 🚨 CRITICAL: Print exact error stack trace to your backend terminal
        console.error("\x1b[31m[CRITICAL] updateOrderStatus Error Details:\x1b[0m", error);
        
        // If validation fails (e.g. invalid enum value), return 400 Bad Request
        const statusCode = error.name === 'ValidationError' ? 400 : 500;
        res.status(statusCode).json({ 
            success: false, 
            errorName: error.name,
            message: error.message 
        });
    }
};



////////////////////////////////////////////
////// ai prescription requests ////////////
////////////////////////////////////////////

// 1. GET PENDING REQUESTS FOR CURRENT PHARMACY (फार्मासिस्ट डैशबोर्ड के लिए)
const getProviderPrescriptionRequests = async (req, res) => {
    try {
        const pharmacyId = req.user.id; // Logged-in pharmacist/pharmacy
        const { status } = req.query; // Filter option (e.g., 'Pending Review', 'Reviewing', etc.)

        let query = { pharmacyId };
        if (status) {
            query.status = status;
        }

        const requests = await PharmacyPrescriptionRequest.find(query)
            .populate('userId', 'name phone email')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET SPECIFIC PRESCRIPTION REQUEST DETAILS (समीक्षा करने के लिए)
const getProviderPrescriptionRequestDetails = async (req, res) => {
    try {
        const { requestId } = req.params;
        const pharmacyId = req.user.id;

        const request = await PharmacyPrescriptionRequest.findOne({ requestId, pharmacyId })
            .populate('userId', 'name phone email gender age');

        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        res.json({
            success: true,
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. START REVIEW (स्टेटस को 'Pending Review' से 'Reviewing' में बदलने के लिए)
const startPrescriptionReview = async (req, res) => {
    try {
        const { requestId } = req.params;
        const pharmacyId = req.user.id;

        const request = await PharmacyPrescriptionRequest.findOne({ requestId, pharmacyId });
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        if (request.status === 'Pending Review') {
            request.status = 'Reviewing';
            await request.save();
        }

        res.json({
            success: true,
            message: "Prescription review started successfully",
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// 2. PHARMACIST PORTAL: SUBMIT REVIEW & BILL (Vendor reviews, matches prices, and adds verifiedBill)
const submitPharmacistReview = async (req, res) => {
    try {
        const { requestId } = req.params;
        const pharmacyId = req.user.id; // Logged-in Pharmacy ID
        const { items, deliveryCharge } = req.body; 

        // 🚨 FIXED: Added pharmacyId check to prevent IDOR attacks
        const request = await PharmacyPrescriptionRequest.findOne({ requestId, pharmacyId });
        if (!request) {
            return res.status(404).json({ 
                success: false, 
                message: "Review request not found or you are not authorized to bill this prescription." 
            });
        }

        if (request.status !== 'Pending Review' && request.status !== 'Reviewing') {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot generate bill. Current status is already '${request.status}'.` 
            });
        }

        let itemTotal = 0;
        let taxableTotal = 0;
        let cgstTotal = 0;
        let sgstTotal = 0;
        const verifiedItems = [];

        for (const item of items) {
            const qty = Number(item.quantity || 1);
            const subtotal = Number(item.pricePerUnit || 0) * qty;
            itemTotal += subtotal;

            let verifiedMrp = Number(item.mrp || 0);
            let verifiedHsn = null;

            if (mongoose.isValidObjectId(item.medicineId)) {
                const inventory = await MedicineInventory.findOne({
                    pharmacyId: request.pharmacyId,
                    medicineId: item.medicineId
                }).select('mrp hsn_number').lean();

                if (inventory) {
                    if (!verifiedMrp) verifiedMrp = Number(inventory.mrp || 0);
                    if (inventory.hsn_number) verifiedHsn = inventory.hsn_number;
                }
            }

            // Dynamic live HSN tax mapping
            let cgstPercent = 0;
            let sgstPercent = 0;
            if (verifiedHsn && verifiedHsn.trim() !== "" && verifiedHsn.toUpperCase() !== "N/A") {
                const hsnConfig = await HsnMaster.findOne({ hsnCode: verifiedHsn.trim(), isActive: true });
                if (hsnConfig) {
                    const totalGst = hsnConfig.totalGstPercent;
                    cgstPercent = totalGst / 2;
                    sgstPercent = totalGst / 2;
                }
            }

            const totalGstPercent = cgstPercent + sgstPercent;
            const itemTaxableAmount = subtotal / (1 + (totalGstPercent / 100));
            const itemCgstAmount = itemTaxableAmount * (cgstPercent / 100);
            const itemSgstAmount = itemTaxableAmount * (sgstPercent / 100);

            taxableTotal += itemTaxableAmount;
            cgstTotal += itemCgstAmount;
            sgstTotal += itemSgstAmount;

            verifiedItems.push({
                medicineId: mongoose.isValidObjectId(item.medicineId) ? item.medicineId : null,
                name: item.name,
                mrp: verifiedMrp,
                pricePerUnit: Number(item.pricePerUnit || 0),
                quantity: qty,
                totalPrice: subtotal,
                
                hsn_number: verifiedHsn || "",
                taxableAmount: Number(itemTaxableAmount.toFixed(2)),
                cgstPercent,
                sgstPercent,
                cgstAmount: Number(itemCgstAmount.toFixed(2)),
                sgstAmount: Number(itemSgstAmount.toFixed(2))
            });
        }

        const totalAmount = itemTotal + Number(deliveryCharge || 0);

        request.verifiedBill = {
            items: verifiedItems,
            itemTotal,
            taxableTotal: Number(taxableTotal.toFixed(2)),
            cgstTotal: Number(cgstTotal.toFixed(2)),       
            sgstTotal: Number(sgstTotal.toFixed(2)),       
            deliveryCharge: Number(deliveryCharge || 0),
            totalAmount: Math.round(totalAmount)
        };
        request.status = 'Bill Generated';
        await request.save();

        res.json({
            success: true,
            message: "Invoice successfully generated and sent to client.",
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const rejectPrescriptionRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body;
        const pharmacyId = req.user.id;

        const request = await PharmacyPrescriptionRequest.findOne({ requestId, pharmacyId });
        if (!request) {
            return res.status(404).json({ success: false, message: "Prescription request not found or unauthorized." });
        }

        // 🚨 FIXED: Prevent rejecting paid/in-process orders
        if (request.status === 'Paid') {
            return res.status(400).json({ 
                success: false, 
                message: "Action Blocked: This prescription request is already paid and converted to an active order." 
            });
        }

        request.status = 'Rejected';
        request.rejectReason = reason || "Prescription verification failed or medicines out of stock.";
        await request.save();

        res.json({
            success: true,
            message: "Prescription request has been rejected successfully.",
            rejectReason: request.rejectReason,
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};





// =========================================================================
// 🚀 NEW: TRACK ALL PHARMACY DRIVERS & THEIR LIVE ACTIVE ORDERS
// Endpoint: GET /provider/pharmacy/orders/track-drivers
const trackPharmacyDrivers = async (req, res) => {
    try {
        const pharmacyId = req.user.id;

        // 🚨 HIDE SENSITIVE DRIVER DATA (Token, Aadhaar, Password)
        const drivers = await Driver.find({ vendorId: pharmacyId })
            .select('-token -aadhaarNumber -password -__v') // 👈 Sanitized for Vendor
            .lean();

        const driversTrackingData = [];

        for (let driver of drivers) {
            let currentActiveOrder = null;

            if (driver.status === 'Busy') {
                currentActiveOrder = await PharmacyBooking.findOne({
                    pharmacyId,
                    driverId: driver._id,
                    status: { $in: ['Packed', 'Shipped', 'Accepted', 'OutForDelivery'] }
                })
                .select('-deliveryOTP -paymentDetails.razorpaySignature -paymentDetails.razorpayOrderId -rejectedBy -__v') // 👈 Order sanitized
                .populate('userId', 'name phone')
                .lean();
            }

            driversTrackingData.push({
                ...driver,
                currentActiveOrder: currentActiveOrder || null
            });
        }

        res.json({
            success: true,
            count: driversTrackingData.length,
            data: driversTrackingData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🚀 NEW: GET PHARMACY ORDER INVOICE DETAILS (For Printing / PDF Generation)
// Endpoint: GET /provider/pharmacy/orders/invoice/:orderId
const getPharmacyOrderInvoiceDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const pharmacyId = req.user.id;

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            pharmacyId
        })
        .select('-deliveryOTP -rejectedBy -paymentDetails.razorpaySignature -paymentDetails.razorpayOrderId -__v')
        // 🚨 3. FULL POPULATE: CIN, GST, TAN, PAN, DL, FSSAI, Signature for Vendor Receipt
        .populate({
            path: 'pharmacyId',
            select: 'name address city state country phone email documents.cinNumber documents.gstNumber documents.tanNumber documents.panNumber documents.drugLicenseNumber documents.foodLicenseNumber documents.signatureImage documents.drugLicenses documents.drugLicenseType'
        })
        .populate('userId', 'name phone')
        .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order details not found." });
        }

        // Extract 2-digit State Code from GSTIN
        const gst = order.pharmacyId?.documents?.gstNumber || "";
        if (order.pharmacyId) {
            order.pharmacyId.stateCode = gst.length >= 2 ? gst.substring(0, 2) : "N/A";
        }

        let calculatedTaxableTotal = 0;
        let calculatedCgstTotal = 0;
        let calculatedSgstTotal = 0;
        const gstSlabBreakdown = {};

        const enrichedItems = await Promise.all(order.items.map(async (item) => {
            const itemQty = Number(item.quantity || 1);
            const itemTotalPrice = Number(item.price || 0) * itemQty;
            const hsn = item.hsn_number || "30049099";

            let batchNo = item.batch_number || "N/A";
            let expDate = item.expiry_date || "N/A";
            let packin = item.packaging || "10 TAB";

            if (item.medicineId && (batchNo === "N/A" || expDate === "N/A")) {
                const inv = await MedicineInventory.findOne({
                    pharmacyId: order.pharmacyId?._id || order.pharmacyId,
                    medicineId: item.medicineId
                }).sort({ expiry_date: 1 }).lean();

                if (inv) {
                    if (inv.batch_number) batchNo = inv.batch_number;
                    if (inv.expiry_date) expDate = moment(inv.expiry_date).format('MM/YY');
                    if (inv.packaging) packin = inv.packaging;
                }
            }

            let cgstP = item.cgstPercent;
            let sgstP = item.sgstPercent;
            if (cgstP === undefined || sgstP === undefined) {
                const isSupplement = hsn.startsWith('21');
                cgstP = isSupplement ? 9 : 6;
                sgstP = isSupplement ? 9 : 6;
            }

            const totalGstP = cgstP + sgstP;
            const taxableAmt = item.taxableAmount || Number((itemTotalPrice / (1 + (totalGstP / 100))).toFixed(2));
            const cgstAmt = item.cgstAmount || Number((taxableAmt * (cgstP / 100)).toFixed(2));
            const sgstAmt = item.sgstAmount || Number((taxableAmt * (sgstP / 100)).toFixed(2));

            calculatedTaxableTotal += taxableAmt;
            calculatedCgstTotal += cgstAmt;
            calculatedSgstTotal += sgstAmt;

            const slabKey = `${totalGstP}%`;
            if (!gstSlabBreakdown[slabKey]) {
                gstSlabBreakdown[slabKey] = { gstClass: slabKey, taxable: 0, cgst: 0, sgst: 0 };
            }
            gstSlabBreakdown[slabKey].taxable = Number((gstSlabBreakdown[slabKey].taxable + taxableAmt).toFixed(2));
            gstSlabBreakdown[slabKey].cgst = Number((gstSlabBreakdown[slabKey].cgst + cgstAmt).toFixed(2));
            gstSlabBreakdown[slabKey].sgst = Number((gstSlabBreakdown[slabKey].sgst + sgstAmt).toFixed(2));

            return {
                ...item,
                batch_number: batchNo,
                expiry_date: expDate,
                packaging: packin,
                hsn_number: hsn,
                discount: 0.00,
                taxableAmount: taxableAmt,
                cgstPercent: cgstP,
                sgstPercent: sgstP,
                cgstAmount: cgstAmt,
                sgstAmount: sgstAmt,
                itemTotalAmount: itemTotalPrice
            };
        }));

        order.items = enrichedItems;

        if (!order.billSummary.taxableTotal) {
            order.billSummary.taxableTotal = Number(calculatedTaxableTotal.toFixed(2));
            order.billSummary.cgstTotal = Number(calculatedCgstTotal.toFixed(2));
            order.billSummary.sgstTotal = Number(calculatedSgstTotal.toFixed(2));
        }

        order.billSummary.amountInWords = numberToWordsIndian(order.billSummary.totalAmount);
        order.billSummary.gstClassBreakdown = Object.values(gstSlabBreakdown);

        res.json({
            success: true,
            message: "Invoice data fetched successfully matching GST receipt.",
            data: order
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



// =====================================================================================
// ================ pharmacy returns and replacements ====================================
// =====================================================================================
// REVIEW RETURN / REPLACEMENT REQUEST (Pharmacist Action)
// Endpoint: PUT /provider/pharmacy/orders/return-action/:orderId
const handleReturnRequestAction = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { action, rejectionReason } = req.body; // action: 'Approved' | 'Rejected'
        const pharmacyId = req.user.id;

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            pharmacyId
        });

        if (!order || !order.returnDetails || order.returnDetails.status !== 'Requested') {
            return res.status(400).json({ success: false, message: "No active pending return request found for this order." });
        }

        if (action === 'Approved') {
            // 🚨 STOCK RESTORATION: Agar Return approve hua toh medicines stock me wapas jud jayengi
            for (const item of order.items) {
                if (!item.medicineId) continue;
                let inventory = await MedicineInventory.findOne({ pharmacyId, medicineId: item.medicineId });
                if (inventory) {
                    inventory.stock_quantity += Number(item.quantity || 1);
                    inventory.is_available = true;
                    await inventory.save();
                }
            }

            order.returnDetails.status = 'Approved';
            order.returnDetails.resolvedAt = new Date();
            order.status = order.returnDetails.requestType === 'Return' ? 'Cancelled' : 'Shipped'; // If replacement, new shipment triggers
            order.paymentStatus = order.returnDetails.requestType === 'Return' ? 'Refund-Initiated' : order.paymentStatus;
            await order.save();

            return res.json({
                success: true,
                message: `Return request approved successfully. Stock restored to your inventory.`,
                data: order.returnDetails
            });
        } 
        
        if (action === 'Rejected') {
            if (!rejectionReason) {
                return res.status(400).json({ success: false, message: "Rejection reason is required." });
            }

            order.returnDetails.status = 'Rejected';
            order.returnDetails.rejectionReason = rejectionReason;
            order.returnDetails.resolvedAt = new Date();
            await order.save();

            return res.json({
                success: true,
                message: "Return request rejected.",
                data: order.returnDetails
            });
        }

        return res.status(400).json({ success: false, message: "Invalid action. Choose 'Approved' or 'Rejected'." });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. APPROVE RETURN & ASSIGN PICKUP DRIVER (In One Step)
// Endpoint: POST /provider/pharmacy/orders/return/assign-driver
const approveReturnAndAssignDriver = async (req, res) => {
    try {
        const { orderId, driverId } = req.body;
        const pharmacyId = req.user.id;

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            pharmacyId
        });

        if (!order || !order.returnDetails || order.returnDetails.status !== 'Requested') {
            return res.status(400).json({ success: false, message: "No active pending return request found." });
        }

        const driver = await Driver.findById(driverId);
        if (!driver || driver.status !== 'Available') {
            return res.status(400).json({ success: false, message: "Selected driver is not available." });
        }

        const generatedReturnOTP = Math.floor(1000 + Math.random() * 9000).toString();

        order.returnDetails.status = 'Approved';
        order.returnDetails.pickupDriverId = driverId;
        order.returnDetails.pickupStatus = 'Assigned';
        order.returnDetails.returnOTP = generatedReturnOTP;
        order.returnDetails.resolvedAt = new Date();
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { status: 'Busy' });

        // 🚨 1. Notify Driver
        await sendPushNotification(
            driverId,
            'driver',
            "New Return Pickup Task Assigned!",
            `You have been assigned to pick up return package for Order #${order.orderId}.`,
            { orderId: order._id.toString(), type: 'return_pickup_task' }
        );

        // 🚨 2. Notify Patient with Return OTP
        await sendPushNotification(
            order.userId,
            'user',
            "Return Request Approved!",
            `Your return request is approved. Pickup driver ${driver.name} is on the way. Share OTP ${generatedReturnOTP} upon collection.`,
            { orderId: order._id.toString(), returnOTP: generatedReturnOTP, type: 'return_approved' }
        );

        res.json({
            success: true,
            message: "Return request approved, pickup driver assigned, and OTP sent to customer!",
            data: {
                orderId: order.orderId,
                returnStatus: order.returnDetails.status,
                pickupStatus: order.returnDetails.pickupStatus,
                assignedDriver: { id: driver._id, name: driver.name, phone: driver.phone }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. REJECT RETURN REQUEST
// Endpoint: POST /provider/pharmacy/orders/return/reject
const rejectReturnRequest = async (req, res) => {
    try {
        const { orderId, rejectionReason } = req.body;
        const pharmacyId = req.user.id;

        if (!rejectionReason || rejectionReason.trim() === "") {
            return res.status(400).json({ success: false, message: "Rejection reason is required." });
        }

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            pharmacyId
        });

        if (!order || !order.returnDetails || order.returnDetails.status !== 'Requested') {
            return res.status(400).json({ success: false, message: "No active pending return request found." });
        }

        order.returnDetails.status = 'Rejected';
        order.returnDetails.rejectionReason = rejectionReason.trim();
        order.returnDetails.resolvedAt = new Date();
        await order.save();

        res.json({
            success: true,
            message: "Return request rejected.",
            data: order.returnDetails
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// FINAL PHARMACIST STORE VERIFICATION & RESTOCK ACTION
// Endpoint: POST /provider/pharmacy/orders/return/confirm-store-receipt
const confirmStoreReturnReceipt = async (req, res) => {
    try {
        const { orderId, decision, remarks, rejectionReason } = req.body; 
        const pharmacyId = req.user.id;

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            pharmacyId
        });

        if (!order || !order.returnDetails || order.returnDetails.status !== 'CollectedByDriver') {
            return res.status(400).json({ 
                success: false, 
                message: "Order parcel must be physically collected by driver before final store verification." 
            });
        }

        // =========================================================================
        // CASE 1: RETURN APPROVED (Restores stock & queues Admin Refund)
        // =========================================================================
        if (decision === 'Approve_And_Restock') {
            for (const item of order.items) {
                if (!item.medicineId) continue;
                await MedicineInventory.findOneAndUpdate(
                    { pharmacyId, medicineId: item.medicineId },
                    { $inc: { stock_quantity: Number(item.quantity || 1) }, $set: { is_available: true } }
                );
            }

            order.returnDetails.status = 'Completed';
            order.returnDetails.pickupStatus = 'DeliveredToStore';
            order.returnDetails.vendorVerificationNote = remarks || "Package verified and accepted at store.";
            order.returnDetails.storeReceivedAt = new Date();
            order.status = 'Cancelled';
            
            // Queue for Admin Razorpay Payout
            order.paymentStatus = order.paymentMethod === 'Online' ? 'Refund-Initiated' : 'Refunded';
            await order.save();

            return res.json({
                success: true,
                message: "Return confirmed! Stock restored to inventory and refund sent to Admin queue.",
                data: order
            });
        }

        // =========================================================================
        // CASE 2: REPLACEMENT APPROVED (🚨 FIXED: Native Stock Deduct without undefined helper crash)
        // =========================================================================
        if (decision === 'Approve_And_Replace') {
            for (const item of order.items) {
                if (!item.medicineId) continue;
                const inv = await MedicineInventory.findOne({ 
                    pharmacyId, 
                    medicineId: item.medicineId,
                    is_available: true,
                    stock_quantity: { $gte: Number(item.quantity || 1) }
                });

                if (!inv) {
                    return res.status(400).json({
                        success: false,
                        message: `Cannot process Replacement: '${item.name}' is OUT OF STOCK. Please choose 'Approve_And_Restock' (Return & Refund) instead.`
                    });
                }
            }

            // Deduct replacement stock atomically
            for (const item of order.items) {
                if (!item.medicineId) continue;
                await MedicineInventory.findOneAndUpdate(
                    { pharmacyId, medicineId: item.medicineId },
                    { $inc: { stock_quantity: -Number(item.quantity || 1) } }
                );
            }

            const freshDeliveryOTP = Math.floor(1000 + Math.random() * 9000).toString();

            order.returnDetails.status = 'Completed';
            order.returnDetails.pickupStatus = 'DeliveredToStore';
            order.returnDetails.vendorVerificationNote = remarks || "Replacement product packed and ready for dispatch.";
            order.returnDetails.storeReceivedAt = new Date();
            
            order.status = 'Packed'; 
            order.deliveryStatus = 'PendingAssignment';
            order.deliveryOTP = freshDeliveryOTP;
            order.driverId = null; 
            await order.save();

            return res.json({
                success: true,
                message: "Replacement confirmed & stock deducted! Fresh Delivery OTP generated. Please assign a driver.",
                data: {
                    orderId: order.orderId,
                    status: order.status,
                    deliveryStatus: order.deliveryStatus,
                    newDeliveryOTP: order.deliveryOTP
                }
            });
        }

        // =========================================================================
        // CASE 3: STORE REJECTION
        // =========================================================================
        if (decision === 'Reject_Damaged') {
            if (!rejectionReason) {
                return res.status(400).json({ success: false, message: "Rejection reason is required." });
            }

            order.returnDetails.status = 'Rejected';
            order.returnDetails.rejectionReason = rejectionReason;
            order.returnDetails.storeReceivedAt = new Date();
            await order.save();

            return res.json({
                success: true,
                message: "Return parcel rejected at store desk.",
                data: order
            });
        }

        return res.status(400).json({ success: false, message: "Invalid decision option." });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = { getPharmacyDashboardStats, getPharmacyOrders, getAvailableDrivers, assignDriverManual, triggerAutoAssignment,reassignDriverManual,updateOrderStatus,

    submitPharmacistReview,getProviderPrescriptionRequests, getProviderPrescriptionRequestDetails, startPrescriptionReview,rejectPrescriptionRequest, trackPharmacyDrivers, getPharmacyOrderInvoiceDetails,
     handleReturnRequestAction,approveReturnAndAssignDriver, rejectReturnRequest,confirmStoreReturnReceipt
 };