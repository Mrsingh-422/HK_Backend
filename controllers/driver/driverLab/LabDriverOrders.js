const LabBooking = require('../../../models/LabBooking');
const Driver = require('../../../models/Driver');

// 1. GET ORDERS ASSIGNED TO PHLEBOTOMIST
// endpoint: GET /api/provider/lab/driver/orders
const getDriverOrders = async (req, res) => {
    try {
        const phlebotomistId = req.user.id;
        const orders = await LabBooking.find({ phlebotomistId })
            .populate('userId', 'name phone address')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. RESPOND TO ASSIGNED ORDER
// endpoint: PATCH /api/provider/lab/driver/respond/:orderId
const respondToOrder = async (req, res) => {
    try {
        const { action } = req.body; // 'Accept' or 'Reject'
        const driverId = req.user.id;

        const order = await LabBooking.findById(req.params.orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (action === 'Accept') {
            order.status = 'Sample Collected'; // Assuming accepting means he's on it
            await Driver.findByIdAndUpdate(driverId, { status: 'Busy' });
        } else {
            order.phlebotomistId = null;
            order.status = 'Confirmed'; // Back to lab pool
        }
        await order.save();
        res.json({ success: true, message: `Order ${action}ed` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE PROGRESS (Figma: Sample Collected, Testing, etc.)
// endpoint: PATCH /api/provider/lab/driver/update-progress/:orderId
const updateProgress = async (req, res) => {
    try {
        const { status } = req.body; // 'Sample Collected', 'Processing'
        const order = await LabBooking.findByIdAndUpdate(
            req.params.orderId, 
            { status }, 
            { new: true }
        );
        res.json({ success: true, message: "Status updated", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. VERIFY OTP (Sample Collection Verification)
// endpoint: POST /api/provider/lab/driver/verify-otp
const verifySampleCollection = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const order = await LabBooking.findById(orderId);

        if (!order) return res.status(404).json({ message: "Order not found" });

        // Lab Booking Model mein 'tracking.otp' use kiya hai
        if (order.tracking.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        order.status = 'Sample Collected';
        await order.save();

        // Driver free
        await Driver.findByIdAndUpdate(order.phlebotomistId, { status: 'Available' });
        
        res.json({ success: true, message: "Sample verified and collected!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getDriverOrders, respondToOrder, updateProgress, verifySampleCollection };