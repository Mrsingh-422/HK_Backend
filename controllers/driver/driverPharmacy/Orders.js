const PharmacyBooking = require('../../../models/PharmacyBooking');
const Driver = require('../../../models/Driver');
const crypto = require('crypto');

const getDriverOrders = async (req, res) => {
    try {
        const driverId = req.user.id;
        const orders = await PharmacyBooking.find({ driverId });
        res.json({ success: true, data: orders });
    } catch (error) { res.status(500).json({ message: error.message }); }
}

// 1. Accept/Reject Order
const respondToOrder = async (req, res) => {
    try {
        const { orderId, action } = req.body; // 'Accept' or 'Reject'
        const driverId = req.user.id;

        const order = await PharmacyBooking.findById(orderId);
        if (action === 'Accept') {
            order.deliveryStatus = 'Accepted';
            await Driver.findByIdAndUpdate(driverId, { status: 'Busy' });
        } else {
            order.rejectedBy.push(driverId);
            order.driverId = null;
            order.deliveryStatus = 'PendingAssignment';
            // Trigger auto assignment for next driver (logic called here)
        }
        await order.save();
        res.json({ success: true, message: `Order ${action}ed` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. Delivery Progress Updates (Figma Workflow)
const updateProgress = async (req, res) => {
    try {
        const { orderId, status } = req.body; 
        // status: 'PickedUp', 'OutForDelivery', 'ReachedLocation'

        const updateData = { deliveryStatus: status };
        
        // If ReachedLocation, generate OTP for user
        if (status === 'ReachedLocation') {
            let otp;
            // Development mode check
            if (process.env.NODE_ENV === 'development') {
                otp = '1111'; // Static OTP for testing
            } else {
                otp = Math.floor(1000 + Math.random() * 9000).toString(); // Random OTP for Production
            }
            
            updateData.deliveryOTP = otp;
            
            // Console log for easy testing in development
            console.log(`Order OTP for ${orderId}: ${otp}`);
            
            // Logic to send SMS (only in production or with actual SMS service)
            // if (process.env.NODE_ENV !== 'development') { sendSMS(phone, otp); }
        }

        const order = await PharmacyBooking.findByIdAndUpdate(orderId, updateData, { new: true });
        res.json({ 
            success: true, 
            message: `Status updated to ${status}`, 
            otpSent: !!updateData.deliveryOTP,
            // Development mein debugging ke liye otp bhej sakte hain (optional)
            debugOtp: process.env.NODE_ENV === 'development' ? updateData.deliveryOTP : undefined 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. Verify OTP and Deliver
const verifyOtpAndDeliver = async (req, res) => {
    try {
        const { orderId, otp } = req.body;
        const order = await PharmacyBooking.findById(orderId);

        if (!order) return res.status(404).json({ message: "Order not found" });

        // OTP Match check
        if (order.deliveryOTP !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        order.deliveryStatus = 'Delivered';
        order.status = 'Delivered';
        await order.save();

        // Driver ko wapas free (Available) karein
        await Driver.findByIdAndUpdate(order.driverId, { status: 'Available' });
        
        res.json({ success: true, message: "Order Delivered Successfully!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. Handle Delivery Issues
const reportDeliveryIssue = async (req, res) => {
    try {
        const { orderId, issueType } = req.body; // 'UserUnreachable', 'UserRefused'
        await PharmacyBooking.findByIdAndUpdate(orderId, { 
            deliveryStatus: issueType,
            status: 'Cancelled'
        });
        await Driver.findByIdAndUpdate(req.user.id, { status: 'Available' });
        res.json({ success: true, message: "Issue reported, order cancelled" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getDriverOrders,respondToOrder, updateProgress, verifyOtpAndDeliver, reportDeliveryIssue };