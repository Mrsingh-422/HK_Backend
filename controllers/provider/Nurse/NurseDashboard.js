const NurseBooking = require('../../../models/NurseBooking');

// 1. GET NURSE DASHBOARD STATS
const getNurseStats = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const requests = await NurseBooking.countDocuments({ nurseId, status: 'Pending' });
        const accepted = await NurseBooking.countDocuments({ nurseId, status: 'Confirmed' });
        const completed = await NurseBooking.countDocuments({ nurseId, status: 'Completed' });
        
        res.json({ success: true, data: { todayRequests: requests, accepted, completed } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. ACCEPT / REJECT NURSING REQUEST
const handleNurseRequest = async (req, res) => {
    try {
        const { action, reason } = req.body; 
        const status = action === 'Accept' ? 'Confirmed' : 'Cancelled';
        
        const booking = await NurseBooking.findByIdAndUpdate(req.params.id, { 
            status, 
            rejectionReason: reason 
        }, { new: true });
        
        res.json({ success: true, message: `Request ${action}ed`, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getNurseStats, handleNurseRequest };