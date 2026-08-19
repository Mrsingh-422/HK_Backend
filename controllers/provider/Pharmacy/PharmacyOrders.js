const PharmacyBooking = require('../../../models/PharmacyBooking');
const Driver = require('../../../models/Driver');
const PharmacyPrescriptionRequest = require("../../../models/PharmacyPrescriptionRequest");
const mongoose = require('mongoose');
const Medicine = require('../../../models/Medicine');
const moment = require('moment');
const Wallet = require('../../../models/Wallet');
const HsnMaster = require('../../../models/HsnMaster'); // Import HSN Master model


// ==========================================
// NEW: GET PHARMACY DASHBOARD STATS
// ==========================================
// Endpoint: GET /provider/pharmacy/orders/dashboard-stats
const getPharmacyDashboardStats = async (req, res) => {
    try {
        const pharmacyId = req.user.id; // Logged-in pharmacy ID

        // Single Mongo Query to aggregate all metrics for performance
        const stats = await PharmacyBooking.aggregate([
            { $match: { pharmacyId: new mongoose.Types.ObjectId(pharmacyId) } },
            {
                $group: {
                    _id: null,
                    pendingRequests: { $sum: { $cond: [{ $in: ["$status", ["Placed", "Pending"]] }, 1, 0] } },
                    // 🚀 Priority Count: Pending orders where rapid delivery charge is applied
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
                    totalEarnings: { $sum: { $cond: [{ $in: ["$status", ["Delivered", "Completed"]] }, "$billSummary.totalAmount", 0] } }
                }
            }
        ]);

        // Fallback wallet query for verification of active balance
        const wallet = await Wallet.findOne({ vendorId: pharmacyId });

        const result = stats[0] || {
            pendingRequests: 0,
            priorityRequests: 0,
            activeOrders: 0,
            completedOrders: 0,
            totalEarnings: 0
        };

        res.json({
            success: true,
            data: {
                pendingRequests: result.pendingRequests,
                priorityRequests: result.priorityRequests, // Dashboard Priority Tab Badge Counter
                activeOrders: result.activeOrders,
                completedOrders: result.completedOrders,
                totalEarnings: result.totalEarnings,
                walletBalance: wallet?.balance || 0
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



// 1. DASHBOARD LISTING (Updated with Priority/Rapid Delivery Filter)
// Endpoint: GET /provider/pharmacy/orders/list
// 1. DASHBOARD LISTING (Enriched with Dynamic BOGO/Combo verification markers)
// Endpoint: GET /provider/pharmacy/orders/list
const getPharmacyOrders = async (req, res) => {
    try {
        const { orderType, status, isPriority } = req.query; 
        let query = { pharmacyId: req.user.id };
        
        if (orderType) query.orderType = orderType; // 'General' or 'Prescription'
        if (status) query.status = status;

        // Priority / Rapid Delivery filter logic
        if (isPriority === 'true') {
            query['billSummary.rapidDeliveryCharge'] = { $gt: 0 };
        } else if (isPriority === 'false') {
            query['billSummary.rapidDeliveryCharge'] = 0;
        }

        // Fetching orders and deeply populating BOGO campaign details per item [1]
        const orders = await PharmacyBooking.find(query)
            .populate('userId', 'name phone')
            .populate('driverId', 'name phone profilePic vehicleNumber')
            .populate({
                path: 'items.comboOfferId', // 🚀 Nested populate: fetches active BOGO rule variables [1]
                select: 'campaignDisplayName buyQty getFreeQty projectedPromoMargin'
            })
            .sort({ createdAt: -1 })
            .lean(); // .lean() converts document to plain JS object for dynamic property injection

        // Mapping orders to add high-level dashboard flags for easy UI badge rendering [1]
        const enrichedOrders = orders.map(order => {
            // Check if at-least one item in this order has BOGO/combo applied [1]
            const hasComboApplied = order.items.some(item => item.isComboApplied === true);
            
            return {
                ...order,
                hasComboApplied // 👈 Root-level helper: returns true if any item has active BOGO [1]
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

        // 2 Minute Timer: Agar driver respond nahi karta toh next ko bhejo
        setTimeout(async () => {
            const checkOrder = await PharmacyBooking.findById(orderId);
            if (checkOrder.deliveryStatus === 'Assigned') {
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
        const { orderId, newDriverId } = req.body;
        const pharmacyId = req.user.id;

        // 1. Order find karein
        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        // 2. Logic: Sirf tabhi reassign hoga jab tak driver ne Accept na kiya ho
        const restrictedStatuses = ['Accepted', 'PickedUp', 'OutForDelivery', 'Delivered'];
        if (restrictedStatuses.includes(order.deliveryStatus)) {
            return res.status(400).json({ 
                message: `Cannot reassign. Order is already ${order.deliveryStatus} by the current driver.` 
            });
        }

        // 3. Purane driver ko wapas free karein (Available)
        if (order.driverId) {
            await Driver.findByIdAndUpdate(order.driverId, { status: 'Available' });
            // Purane driver ko rejectedBy mein daal dein taaki auto-assign wapas uske paas na jaye
            if (!order.rejectedBy.includes(order.driverId)) {
                order.rejectedBy.push(order.driverId);
            }
        }

        // 4. Naya driver check karein
        const newDriver = await Driver.findById(newDriverId);
        if (!newDriver || newDriver.status !== 'Available') {
            return res.status(400).json({ message: "New driver is not available" });
        }

        // 5. Order update karein
        order.driverId = newDriverId;
        order.deliveryStatus = 'Assigned';
        order.assignedAt = new Date();
        await order.save();

        // 6. Naye driver ko Busy mark karein
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
        const { items, deliveryCharge } = req.body; 

        const request = await PharmacyPrescriptionRequest.findOne({ requestId });
        if (!request) {
            return res.status(404).json({ success: false, message: "Review request not found" });
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
            if (verifiedHsn && verifiedHsn.trim() !== "") {
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
            message: "Invoice successfully sent to client",
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
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        request.status = 'Rejected';
        request.rejectReason = reason || "Invalid Prescription Document"; // Now this will be saved successfully
        await request.save();

        res.json({
            success: true,
            message: "Prescription request has been rejected successfully",
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
// =========================================================================
const trackPharmacyDrivers = async (req, res) => {
    try {
        const pharmacyId = req.user.id;

        // 1. Fetch all drivers linked to this pharmacy store
        const drivers = await Driver.find({ vendorId: pharmacyId }).lean();

        const driversTrackingData = [];

        for (let driver of drivers) {
            let currentActiveOrder = null;

            // If driver status is 'Busy', find the active delivery order they are working on
            if (driver.status === 'Busy') {
                currentActiveOrder = await PharmacyBooking.findOne({
                    pharmacyId,
                    driverId: driver._id,
                    status: { $in: ['Packed', 'Shipped', 'Accepted', 'OutForDelivery'] } // Active delivery states
                })
                .populate('userId', 'name phone')
                .select('orderId status deliveryStatus address billSummary createdAt')
                .lean();
            }

            driversTrackingData.push({
                ...driver,
                currentActiveOrder: currentActiveOrder || null // 👈 Will bind active order details or null
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


module.exports = { getPharmacyDashboardStats, getPharmacyOrders, getAvailableDrivers, assignDriverManual, triggerAutoAssignment,reassignDriverManual,updateOrderStatus,

    submitPharmacistReview,getProviderPrescriptionRequests, getProviderPrescriptionRequestDetails, startPrescriptionReview,rejectPrescriptionRequest, trackPharmacyDrivers
 };