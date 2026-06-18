// controllers/provider/Lab/LabsOrder.js

const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');
const moment = require('moment');

// 1. GET DASHBOARD STATS (Updated with Priority Count)
const getLabStats = async (req, res) => {
    try {
        const labId = req.user.id;

        const [requests, priorityRequests, accepted, completed] = await Promise.all([
            LabBooking.countDocuments({ labId, status: 'Pending' }),
            // Count of pending bookings that have a rapid/priority delivery charge
            LabBooking.countDocuments({ 
                labId, 
                status: 'Pending', 
                'billSummary.rapidDeliveryCharge': { $gt: 0 } 
            }),
            LabBooking.countDocuments({ labId, status: 'Confirmed' }),
            LabBooking.countDocuments({ labId, status: 'Completed' })
        ]);
        
        const wallet = await Wallet.findOne({ vendorId: labId });
        res.json({ 
            success: true, 
            data: { 
                requests, 
                priorityRequests, // For UI Priority Tab Badge
                accepted, 
                completed, 
                todayEarnings: wallet?.balance || 0 
            } 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET ORDER LIST (With Filter & Priority Logic)
// endpoint: GET /api/provider/labs/orders
const getOrders = async (req, res) => {
    try {
        const { status, isPriority } = req.query;
        let query = { labId: req.user.id };
        
        // 1. Status Filter
        if (status) query.status = status;

        // 2. Priority / Rapid Delivery Filter
        if (isPriority === 'true') {
            // Bookings that have rapid delivery charges applied (> 0)
            query['billSummary.rapidDeliveryCharge'] = { $gt: 0 };
        } else if (isPriority === 'false') {
            // Bookings that are normal/regular delivery (charge is 0)
            query['billSummary.rapidDeliveryCharge'] = 0;
        }

        const orders = await LabBooking.find(query)
            .populate('userId', 'name phone address')
            .populate('phlebotomistId', 'name phone')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: orders.length, data: orders });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 4. ASSIGN PHLEBOTOMIST
const assignStaff = async (req, res) => {
    try {
        const { phlebotomistId } = req.body;

        if (!phlebotomistId) {
            return res.status(400).json({ 
                success: false, 
                message: "Phlebotomist ID is required to assign staff." 
            });
        }

        const booking = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { 
                phlebotomistId: phlebotomistId, 
                status: 'Phlebotomist Assigned' 
            },
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        res.json({ success: true, message: "Phlebotomist assigned successfully", data: booking });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    getLabStats, 
    getOrders, 
    handleOrderAction, 
    assignStaff, 
    updateProgressStatus, 
    uploadReport 
};