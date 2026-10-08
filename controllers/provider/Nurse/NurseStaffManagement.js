// controllers/provider/Nurse/NurseStaffManagement.js
const NurseBooking = require('../../../models/NurseBooking');
const Driver = require('../../../models/Driver');
const { sendPushNotification } = require('../../../utils/notification');

// 1. GET AVAILABLE STAFF FOR ASSIGNMENT
// Endpoint: GET /provider/nurse/management/available-staff
const getAvailableStaff = async (req, res) => {
    try {
        // Only return online, available staff belonging to this nurse bureau
        const staff = await Driver.find({ 
            vendorId: req.user.id, 
            vendorType: 'Nurse',
            status: 'Available',
            isOnline: true
        }).select('name phone profilePic status vehicleNumber vehicleType');

        res.json({ success: true, count: staff.length, data: staff });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 2. ASSIGN STAFF TO BOOKING (With Ownership Security & FCM Push Notification)
// Endpoint: POST /provider/nurse/management/assign-staff
const assignStaffToBooking = async (req, res) => {
    try {
        const { bookingId, staffId } = req.body;
        const nurseBureauId = req.user.id;

        if (!bookingId || !staffId) {
            return res.status(400).json({ success: false, message: "bookingId and staffId are required." });
        }

        // 🚨 OWNERSHIP CHECK: Ensure this booking belongs to logged-in Nurse Bureau
        const booking = await NurseBooking.findOne({ _id: bookingId, nurseId: nurseBureauId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        // 🚨 STAFF CHECK: Ensure staff belongs to this bureau and is online
        const staff = await Driver.findOne({ _id: staffId, vendorId: nurseBureauId, vendorType: 'Nurse' });
        if (!staff || staff.status === 'Offline' || staff.isOnline === false) {
            return res.status(400).json({ success: false, message: "Selected nurse staff is currently Offline." });
        }

        // Release old staff if re-assigning
        if (booking.assignedStaffId && String(booking.assignedStaffId) !== String(staffId)) {
            await Driver.findByIdAndUpdate(booking.assignedStaffId, { $set: { status: 'Available' } });
        }

        booking.assignedStaffId = staff._id;
        booking.status = 'Assigned';
        await booking.save();

        // Mark assigned staff as Busy
        staff.status = 'Busy';
        await staff.save();

        // 🚨 FCM PUSH NOTIFICATION: Alert Staff Nurse on Mobile
        try {
            await sendPushNotification(
                staff._id,
                'driver',
                "New Home Nursing Task Assigned! 👩‍⚕️",
                `You have been assigned to patient booking #${booking.bookingId || booking._id}. Tap to view schedule.`,
                { bookingId: booking._id.toString(), type: 'nurse_task_assigned' }
            );
        } catch (e) {}

        res.json({ 
            success: true, 
            message: "Staff assigned successfully and task notification dispatched.", 
            data: booking 
        });

    } catch (error) { 
        console.error("Assign Staff Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// @desc    Update Service Progress from Bureau Desk (Handles Staff Release & Refunds on Cancel/Complete)
// @route   PUT /provider/nurse/management/update-progress
// @access  Private (Nurse Bureau)
const updateServiceProgress = async (req, res) => {
    try {
        const { bookingId, status, reason } = req.body;
        const nurseBureauId = req.user.id;

        const validStatuses = ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started', 'Completed', 'Cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Valid progress status is required." });
        }

        const booking = await NurseBooking.findOne({ _id: bookingId, nurseId: nurseBureauId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found or access denied." });
        }

        booking.status = status;

        // 1. Completion Logic
        if (status === 'Completed') {
            booking.completedAt = new Date();
            
            if (booking.paymentMethod === 'COD' && booking.paymentStatus !== 'Paid') {
                booking.paymentStatus = 'Paid';
            }

            if (booking.assignedStaffId) {
                await Driver.findByIdAndUpdate(booking.assignedStaffId, { $set: { status: 'Available', isOnline: true } });
            }
        }

        // 2. Cancellation Logic (Release Staff & Queue Refund)
        if (status === 'Cancelled') {
            booking.cancelReason = reason || "Cancelled by Nurse Bureau Management.";

            // Free allocated staff nurse driver
            if (booking.assignedStaffId) {
                await Driver.findByIdAndUpdate(booking.assignedStaffId, { $set: { status: 'Available', isOnline: true } });
            }

            // Queue online payment refund
            if (booking.paymentStatus === 'Paid') {
                booking.paymentStatus = 'Refund-Initiated';
            }

            // Rollback subscription benefits if applied
            if (booking.subscriptionDetails?.isSubscriptionApplied) {
                await refundBenefitCount(booking.userId, 'freeNurseVisitsCount');
            }
        }

        await booking.save();

        // Notify Patient
        if (booking.userId) {
            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    `Nursing Booking Update: ${status}`,
                    `Your booking #${booking.bookingId} status has been updated to '${status}'.`,
                    { bookingId: booking._id.toString(), type: 'nurse_status_updated' }
                );
            } catch (e) {}
        }

        res.status(200).json({ 
            success: true, 
            message: `Service progress updated to '${status}'.`, 
            data: booking 
        });

    } catch (error) { 
        console.error("Update Progress Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


module.exports = { getAvailableStaff, assignStaffToBooking, updateServiceProgress };