const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');

// 1. DASHBOARD STATS (Figma Screen 17)
const getNurseDashboard = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const [stats, bookings] = await Promise.all([
            NurseBooking.aggregate([
                { $match: { nurseId: req.user.id } },
                { $group: {
                    _id: null,
                    pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
                    accepted: { $sum: { $cond: [{ $eq: ["$status", "Assigned"] }, 1, 0] } },
                    completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } }
                }}
            ]),
            NurseBooking.find({ nurseId }).sort({ createdAt: -1 }).limit(10)
        ]);

        res.json({ 
            success: true, 
            stats: stats[0] || { pending: 0, accepted: 0, completed: 0 },
            recentBookings: bookings 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. MANAGE SERVICES (Figma Screen 37, 42)
// Add Service to Array
const addService = async (req, res) => {
    try {
        let photos = [];
        if (req.files && req.files['photos']) {
            photos = req.files['photos'].map(f => f.path);
        }

        // Figma Screen 42 mapping
        const service = await NurseService.create({
            nurseId: req.user.id,
            type: req.body.type, // Daily Care / Package
            title: req.body.title,
            description: req.body.description,
            price: req.body.price,
            consumablesUsed: req.body.consumablesUsed, // Array
            procedureIncluded: req.body.procedureIncluded,
            servicesOffered: req.body.servicesOffered,
            prescriptionRequired: req.body.prescriptionRequired === 'true',
            photos: photos
        });

        res.status(201).json({ success: true, data: service });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Update Specific Service in Array
const updateService = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const updates = req.body;
        
        // Dynamic path for sub-document update
        const nurse = await Nurse.findOneAndUpdate(
            { _id: req.user.id, "offeredServices._id": serviceId },
            { $set: { "offeredServices.$": { ...updates, _id: serviceId } } },
            { new: true }
        );
        res.json({ success: true, data: nurse.offeredServices });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Delete Service from Array
const deleteService = async (req, res) => {
    try {
        await Nurse.findByIdAndUpdate(req.user.id, {
            $pull: { offeredServices: { _id: req.params.serviceId } }
        });
        res.json({ success: true, message: "Service Deleted" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getNurseDashboard, addService, updateService, deleteService };