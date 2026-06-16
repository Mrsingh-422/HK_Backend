const NurseBooking = require('../../../models/NurseBooking');
const Driver = require('../../../models/Driver');

// 1. GET ALL ASSIGNED WORK FOR NURSE
const getNurseBookings = async (req, res) => {
    try {
        const staffId = req.user.id;
        const bookings = await NurseBooking.find({ assignedStaffId: staffId })
            .select('bookingId status schedule assessmentLocation address totalPrice createdAt')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: bookings });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. GET SINGLE BOOKING DETAIL (Patients, Health Details, Consumables)
const getBookingDetail = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await NurseBooking.findById(bookingId)
            .populate('userId', 'name phone')
            .populate('nurseId', 'name phone profileImage')
            .populate('selectedConsumables.consumableId');

        if (!booking) return res.status(404).json({ message: "Booking not found" });
        res.json({ success: true, data: booking });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. RESPOND TO ASSIGNED BOOKING (Accept/Reject)
const respondToBooking = async (req, res) => {
    try {
        const { action } = req.body; 
        const { bookingId } = req.params;
        const staffId = req.user.id;

        const driver = await Driver.findById(staffId);
        if (action === 'Accept' && driver.status !== 'Available') {
            return res.status(400).json({ success: false, message: "You are currently Busy with another patient." });
        }

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (action === 'Accept') {
            booking.status = 'Assigned';
            await Driver.findByIdAndUpdate(staffId, { status: 'Busy' });
            await booking.save();
        } else {
            await NurseBooking.findByIdAndUpdate(bookingId, {
                $addToSet: { rejectedBy: staffId },
                assignedStaffId: null,
                status: 'Confirmed'
            });
        }
        res.json({ success: true, message: `Booking ${action}ed successfully` });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 4. UPDATE SERVICE PROGRESS
const updateProgress = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { status } = req.body; 
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (!booking.assignedStaffId || booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized. This booking is not assigned to you." });
        }

        booking.status = status;

        if (status === 'Arrived') {
            booking.serviceOTP = '1111'; 
        }

        await booking.save();
        res.json({ 
            success: true, 
            message: `Status updated to ${status}`, 
            otpSent: status === 'Arrived',
            debugOtp: status === 'Arrived' ? '1111' : undefined,
            data: booking 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 5. VERIFY OTP AND START SERVICE
const verifyOtpAndStartService = async (req, res) => {
    try {
        const { bookingId, otp } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (!booking.assignedStaffId || booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized. This booking is not assigned to you." });
        }

        if (otp !== '1111' && booking.serviceOTP !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        booking.status = 'Service-Started';
        await booking.save();

        res.json({ success: true, message: "Service OTP verified. Duty Started!", data: booking });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 6. COMPLETE NURSING SERVICE (Multi-day Timezone bug fixed)
const completeService = async (req, res) => {
    try {
        const { bookingId } = req.body;
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (!booking.assignedStaffId || booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized. This booking is not assigned to you." });
        }

        const today = new Date();
        const endDate = new Date(booking.schedule.endDate);

        const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

        if (booking.schedule.duration === 'For Multiple Days' && todayDateOnly < endDateOnly) {
            booking.status = 'Assigned'; 
            booking.serviceOTP = null; // 🌟 सुधार: आंशिक पूर्णता पर OTP को रीसेट करें
            await booking.save();

            await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

            return res.json({ 
                success: true, 
                message: "Today's daily duty completed. Next shift is active for tomorrow.", 
                data: booking 
            });
        }

        booking.status = 'Completed';
        booking.serviceOTP = null;
        await booking.save();

        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        res.json({ success: true, message: "Entire nursing contract/service completed successfully!", data: booking });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 7. REPORT SERVICE ISSUE
const reportNurseIssue = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { issueType, customReason } = req.body; 
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (!booking.assignedStaffId || booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized. This booking is not assigned to you." });
        }

        const reason = customReason || `Service aborted due to: ${issueType}`;

        booking.status = 'Cancelled';
        booking.cancelReason = reason;
        await booking.save();

        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        res.json({ success: true, message: "Issue logged. Nurse is now available.", data: booking });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 8. ONLINE / OFFLINE TOGGLE
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; 
        const driver = await Driver.findByIdAndUpdate(req.user.id, { status }, { new: true });
        res.json({ success: true, message: `Status updated to ${status}`, data: driver });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 9. REASSIGN DUE TO EMERGENCY (Bug Fixed: Destructured from req.body)
const reassignNurseDueToEmergency = async (req, res) => {
    try {
        const { bookingId, reason } = req.body; // 🌟 सुधार: अब req.body से सुरक्षित रूप से निकाला गया है
        const staffId = req.user.id;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (!booking.assignedStaffId || booking.assignedStaffId.toString() !== staffId) {
            return res.status(403).json({ message: "Unauthorized." });
        }

        booking.assignedStaffId = null;
        booking.status = 'Confirmed'; 
        booking.cancelReason = reason || "Emergency Release";
        booking.rejectedBy.push(staffId);
        await booking.save();

        await Driver.findByIdAndUpdate(staffId, { status: 'Available' });

        res.json({ 
            success: true, 
            message: "Emergency reported. Duty has been successfully released for reassignment.", 
            data: booking 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    getNurseBookings, 
    getBookingDetail,
    respondToBooking, 
    updateProgress, 
    verifyOtpAndStartService, 
    completeService,
    reportNurseIssue,
    toggleDriverStatus,
    reassignNurseDueToEmergency
};