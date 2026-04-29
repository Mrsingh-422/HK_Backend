const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');
const moment = require('moment');
const Driver = require('../../../models/Driver');

// 1. GET DASHBOARD STATS
const getLabStats = async (req, res) => {
    try {
        const labId = req.user.id;
        const todayStart = moment().startOf('day').toDate();

        const [requests, accepted, completed] = await Promise.all([
            LabBooking.countDocuments({ labId, status: 'Pending' }),
            LabBooking.countDocuments({ labId, status: 'Confirmed' }),
            LabBooking.countDocuments({ labId, status: 'Completed' })
        ]);
        
        const wallet = await Wallet.findOne({ vendorId: labId });
        res.json({ success: true, data: { requests, accepted, completed, todayEarnings: wallet?.balance || 0 } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET ORDER LIST (With Filter)
// endpoint: GET /api/provider/lab/orders?status=Pending
const getOrders = async (req, res) => {
    try {
        const { status } = req.query;
        let query = { labId: req.user.id };
        if (status) query.status = status;

        const orders = await LabBooking.find(query)
            .populate('userId', 'name phone address')
            .populate('phlebotomistId', 'name phone')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. ACTION: ACCEPT/REJECT
const handleOrderAction = async (req, res) => {
    try {
        const { action, reason } = req.body; 
        const status = action === 'Rejected' ? 'Cancelled' : 'Confirmed';
        
        const order = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { status, cancelReason: reason },
            { new: true }
        );
        res.json({ success: true, message: `Order ${status} successfully`, data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. ASSIGN PHLEBOTOMIST
// endpoint: PATCH /api/provider/lab/assign-staff/:orderId
const assignStaff = async (req, res) => {
    try {
        const { phlebotomistId } = req.body;
        const booking = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { phlebotomistId, status: 'Phlebotomist Assigned' },
            { new: true }
        );
        res.json({ success: true, message: "Phlebotomist assigned", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. UPDATE PROGRESS (Sample Collected -> Testing -> Report Generated)
const updateProgressStatus = async (req, res) => {
    try {
        const { status } = req.body; 
        const validStatuses = ['Sample Collected', 'Testing', 'Report Generated'];
        
        if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

        const order = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { status },
            { new: true }
        );
        res.json({ success: true, message: "Status updated", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. UPLOAD REPORT & COMPLETE
const uploadReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "PDF report required" });

        const order = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { 
                reportFile: req.file.path, 
                status: 'Completed' 
            },
            { new: true }
        );
        res.json({ success: true, message: "Report uploaded successfully", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getLabStats, getOrders, handleOrderAction, assignStaff, updateProgressStatus, uploadReport };