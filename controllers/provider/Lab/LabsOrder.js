const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');

// 1. GET DASHBOARD STATS
// endpoint: GET /api/provider/lab/dashboard-stats
const getLabStats = async (req, res) => {
    try {
        const labId = req.user.id;
        const todayStart = new Date().setHours(0,0,0,0);

        const [requests, accepted, completed] = await Promise.all([
            LabBooking.countDocuments({ labId, createdAt: { $gte: todayStart }, status: 'Pending' }),
            LabBooking.countDocuments({ labId, status: 'Confirmed' }),
            LabBooking.countDocuments({ labId, status: 'Report Uploaded' })
        ]);
        
        const wallet = await Wallet.findOne({ vendorId: labId });
        res.json({ success: true, data: { todayRequests: requests, acceptedOrders: accepted, completedOrders: completed, todayEarnings: wallet ? wallet.balance : 0 } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. ACCEPT / REJECT BOOKING
// endpoint: PATCH /api/provider/lab/order-action/:orderId
const handleOrderAction = async (req, res) => {
    try {
        const { action, reason } = req.body; 
        const status = action === 'Rejected' ? 'Rejected' : 'Confirmed';
        const order = await LabBooking.findByIdAndUpdate(req.params.orderId, { status, rejectionReason: reason }, { new: true });
        res.json({ success: true, message: `Order ${status} successfully`, data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE PROGRESS STATUS (Figma Screen 23 Timeline)
// endpoint: PATCH /api/provider/lab/update-progress/:orderId
const updateProgressStatus = async (req, res) => {
    try {
        const { status } = req.body; // 'Sample Collected', 'Processing'
        const order = await LabBooking.findByIdAndUpdate(req.params.orderId, { status }, { new: true });
        res.json({ success: true, message: "Status updated", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. UPLOAD REPORT
// endpoint: POST /api/provider/lab/upload-report/:orderId
const uploadReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "File required" });
        const order = await LabBooking.findByIdAndUpdate(req.params.orderId, { reportFile: req.file.path, status: 'Report Uploaded' }, { new: true });
        res.json({ success: true, message: "Report uploaded", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getLabStats, handleOrderAction, updateProgressStatus, uploadReport };