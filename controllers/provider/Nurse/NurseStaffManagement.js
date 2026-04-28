// controllers/provider/Nurse/NurseStaffManagement.js
const NurseBooking = require('../../../models/NurseBooking');
const Driver = require('../../../models/Driver');

// 1. GET AVAILABLE STAFF FOR ASSIGNMENT (Figma Screen 24)
const getAvailableStaff = async (req, res) => {
    try {
        // Sirf wahi Staff Nurses dikhao jo is Provider (Nurse Vendor) ki hain aur 'Available' hain
        const staff = await Driver.find({ 
            vendorId: req.user.id, 
            vendorType: 'Nurse',
            status: 'Available' 
        });
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. ASSIGN STAFF TO BOOKING (Figma Screen 23 - "Process" Button)
const assignStaffToBooking = async (req, res) => {
    try {
        const { bookingId, staffId } = req.body;
        
        // Booking update karo
        const booking = await NurseBooking.findByIdAndUpdate(bookingId, {
            assignedStaffId: staffId,
            status: 'Assigned'
        }, { new: true });

        // Staff ka status 'Busy' karo
        await Driver.findByIdAndUpdate(staffId, { status: 'Busy' });

        res.json({ success: true, message: "Nurse Assigned Successfully", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateServiceProgress = async (req, res) => {
    try {
        const { bookingId, status } = req.body; 
        // status options: 'On-The-Way', 'Arrived', 'Started', 'Completed'
        
        const booking = await NurseBooking.findByIdAndUpdate(bookingId, { status }, { new: true });
        
        // Agar status 'Completed' hai toh Staff ko wapas 'Available' karo
        if (status === 'Completed') {
            await Driver.findById(booking.assignedStaffId, { status: 'Available' });
        }

        res.json({ success: true, message: `Status updated to ${status}`, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getAvailableStaff, assignStaffToBooking, updateServiceProgress };