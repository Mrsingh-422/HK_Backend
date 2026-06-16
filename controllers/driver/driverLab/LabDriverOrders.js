const LabBooking = require('../../../models/LabBooking');
const Driver = require('../../../models/Driver');

// 1. GET ALL LAB ASSIGNED ORDERS
const getDriverOrders = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;
        const orders = await LabBooking.find({ phlebotomistId })
            .select('bookingId status collectionType address appointmentDate appointmentTime createdAt')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. GET SINGLE LAB BOOKING DETAIL
const getOrderDetail = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const order = await LabBooking.findById(bookingId)
            .populate('userId', 'name phone address')
            .populate('items.tests.testId', 'name price')
            .populate('items.packages.packageId', 'name price');

        if (!order) return res.status(404).json({ message: "Booking not found" });
        res.json({ success: true, data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. RESPOND TO ASSIGNED ORDER (Accept/Reject)
const respondToOrder = async (req, res) => {
    try {
        const { action } = req.body; 
        const { orderId } = req.params;
        const driverId = req.user.id;

        const driver = await Driver.findById(driverId);
        if (action === 'Accept' && driver.status !== 'Available') {
            return res.status(400).json({ success: false, message: "You are currently Busy." });
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
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 4. REACH LOCATION & TRIGGER OTP
const reachLocation = async (req, res) => {
    try {
        const { orderId } = req.params;
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized. This order is not assigned to you." });
        }

        if (!order.tracking) {
            order.tracking = {};
        }
        order.tracking.otp = '1111'; 
        await order.save();

        res.json({ 
            success: true, 
            message: "Arrived at location. Static OTP generated.", 
            otpSent: true,
            debugOtp: '1111'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. VERIFY OTP & COLLECT SAMPLE
const verifySampleCollection = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized. This order is not assigned to you." });
        }

        if (otp !== '1111' && order.tracking?.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        order.status = 'Sample Collected';
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Sample verified. Phlebotomist is now Available!", data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 6. REPORT SAMPLE COLLECTION ISSUE
const reportCollectionIssue = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { issueType, customReason } = req.body; 
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized. This order is not assigned to you." });
        }

        const reason = customReason || `Failed due to: ${issueType}`;

        order.status = 'Cancelled';
        order.cancelReason = reason;
        await order.save();

        await Driver.findByIdAndUpdate(driverId, { status: 'Available' });

        res.json({ success: true, message: "Collection failed issue logged. Booking cancelled.", data: order });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. UPDATE PROGRESS
const updateProgress = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body; 
        const driverId = req.user.id;

        const order = await LabBooking.findById(orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!order.phlebotomistId || order.phlebotomistId.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized." });
        }

        if (status !== 'Sample Deposited' && status !== 'Sample Collected') {
            return res.status(400).json({ success: false, message: "Technicians handle testing. You can only deposit the sample." });
        }

        order.status = status;
        await order.save();

        res.json({ success: true, message: `Status updated to ${status}. Thank you!`, data: order });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 8. ONLINE / OFFLINE TOGGLE
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; 
        const driver = await Driver.findByIdAndUpdate(req.user.id, { status }, { new: true });
        res.json({ success: true, message: `Driver status updated to ${status}`, data: driver });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 🌟 9. REASSIGN LAB ORDER DUE TO EMERGENCY (Newly Added)
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

        res.json({ 
            success: true, 
            message: "Emergency reported. Lab collection duty has been released for reassignment.", 
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
    reachLocation,
    verifySampleCollection,
    updateProgress,
    reportCollectionIssue,
    toggleDriverStatus,
    reassignLabOrderDueToEmergency
};