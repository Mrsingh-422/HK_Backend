const PharmacyBooking = require('../../../models/PharmacyBooking');

// 1. GET ALL ORDERS FOR PHARMACY (Dashboard Listing)
const getPharmacyOrders = async (req, res) => {
    try {
        const { status } = req.query; // Placed, Packed, Shipped, Delivered, Cancelled
        let query = { pharmacyId: req.user.id };
        if (status) query.status = status;

        const orders = await PharmacyBooking.find(query)
            .populate('userId', 'name phone')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: orders.length, data: orders });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE ORDER STATUS (Figma: Packed/Shipped/Delivered)
const updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const order = await PharmacyBooking.findOneAndUpdate(
            { _id: req.params.orderId, pharmacyId: req.user.id },
            { status },
            { new: true }
        );
        if (!order) return res.status(404).json({ message: "Order not found" });
        res.json({ success: true, message: `Order updated to ${status}`, data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getPharmacyOrders, updateOrderStatus };