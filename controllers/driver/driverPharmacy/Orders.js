const PharmacyBooking = require('../../../models/PharmacyBooking');
const Driver = require('../../../models/Driver');

// 1. GET ALL ASSIGNED ORDERS
const getDriverOrders = async (req, res) => {
    try {
        const driverId = req.user.id;
        const orders = await PharmacyBooking.find({ driverId })
            .select('orderId status deliveryStatus collectionType address billSummary createdAt')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. GET SINGLE ORDER DETAIL (With medicine details and patient details)
const getOrderDetail = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await PharmacyBooking.findById(orderId)
            .populate('userId', 'name phone')
            .populate('items.medicineId', 'name basePrice');

        if (!order) return res.status(404).json({ message: "Order not found" });
        res.json({ success: true, data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. ACCEPT / REJECT ORDER
const respondToOrder = async (req, res) => {
    try {
        const { orderId, action } = req.body; 
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        // 🌟 सिंकिंग सुधार: Busy या Offline ड्राइवर नया आर्डर स्वीकार नहीं कर सकता
        if (action === 'Accept' && driver.status !== 'Available') {
            return res.status(400).json({ success: false, message: "You are currently Busy or Offline. Cannot accept new orders." });
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
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. UPDATE PROGRESS (With Security Check)
const updateProgress = async (req, res) => {
    try {
        const { orderId, status } = req.body; 
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        // सुरक्षा जांच: केवल असाइन किया गया ड्राइवर ही प्रोग्रेस अपडेट कर सकता है
        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized. This order is not assigned to you." });
        }

        order.deliveryStatus = status;
        
        // Static OTP set to '1111'
        if (status === 'ReachedLocation') {
            order.deliveryOTP = '1111'; 
        }

        await order.save();
        res.json({ 
            success: true, 
            message: `Status updated to ${status}`, 
            otpSent: status === 'ReachedLocation',
            debugOtp: status === 'ReachedLocation' ? '1111' : undefined,
            data: order
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. VERIFY OTP AND DELIVER (With Security Check)
const verifyOtpAndDeliver = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const driverId = req.user.id;
        const order = await PharmacyBooking.findById(orderId);

        if (!order) return res.status(404).json({ message: "Order not found" });

        // सुरक्षा जांच
        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized. This order is not assigned to you." });
        }

        // Static OTP Check
        if (otp !== '1111' && order.deliveryOTP !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        order.deliveryStatus = 'Delivered';
        order.status = 'Delivered';
        await order.save();

        // Driver becomes Available again
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });
        
        res.json({ success: true, message: "Order Delivered Successfully!", data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 4. REPORT DELIVERY ISSUE (With Security Check)
const reportDeliveryIssue = async (req, res) => {
    try {
        const { orderId, issueType, customReason } = req.body; 
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        // सुरक्षा जांच
        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized. This order is not assigned to you." });
        }

        const reason = customReason || `Delivery failed due to: ${issueType}`;

        order.deliveryStatus = issueType;
        order.status = 'Cancelled';
        order.cancelReason = reason;
        await order.save();

        // Release Driver
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });
        
        res.json({ success: true, message: "Issue reported successfully", data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
// 7. ONLINE / OFFLINE TOGGLE FOR DRIVER
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'Available' or 'Offline'
        const driver = await Driver.findByIdAndUpdate(req.user.id, { status }, { new: true });
        res.json({ success: true, message: `Driver status updated to ${status}`, data: driver });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
const reassignOrderDueToEmergency = async (req, res) => {
    try {
        const { orderId } = req.body;
        const { reason } = req.body;
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        // सुरक्षा जांच
        if (!order.driverId || order.driverId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized." });
        }

        // 🌟 इमरजेंसी रिकवरी: डिलीवरी बॉय को हटाकर वापस असाइनमेंट पूल में डालें
        order.driverId = null;
        order.deliveryStatus = 'PendingAssignment';
        order.rejectedBy.push(driverId);
        await order.save();

        // ड्राइवर को फ्री करें
        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ 
            success: true, 
            message: "Emergency reported. Delivery order released back to pool.", 
            data: order 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getDriverOrders, 
    getOrderDetail, 
    respondToOrder, 
    updateProgress, 
    verifyOtpAndDeliver, 
    reportDeliveryIssue,
    toggleDriverStatus,
    reassignOrderDueToEmergency
};