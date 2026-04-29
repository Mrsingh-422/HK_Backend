const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const NurseConsumable = require('../../../models/NurseConsumable')

// 1. DASHBOARD STATS (Figma Screen 17)
const addService = async (req, res) => {
    try {
        const { 
            type, title, description, oneDayPrice, multipleDaysPrice, 
            hourlyPrice, amount, discountPercentage, consumablesUsed, 
            procedureIncluded, servicesOffered, prescriptionRequired 
        } = req.body;

        let photos = [];
        if (req.files && req.files['photos']) {
            photos = req.files['photos'].map(f => f.path);
        }

        // Logic: Calculate Final Price automatically
        const baseAmount = Number(amount) || 0;
        const discount = Number(discountPercentage) || 0;
        const finalPrice = baseAmount - (baseAmount * (discount / 100));

        // Parse consumables if sent as string (from form-data)
        const consumables = Array.isArray(consumablesUsed) 
            ? consumablesUsed 
            : (consumablesUsed ? [consumablesUsed] : []);

        const service = await NurseService.create({
            nurseId: req.user.id,
            type, title, description,
            oneDayPrice: Number(oneDayPrice),
            multipleDaysPrice: Number(multipleDaysPrice),
            hourlyPrice: Number(hourlyPrice),
            amount: baseAmount,
            discountPercentage: discount,
            finalPrice: Math.round(finalPrice), // Actual payable amount
            consumablesUsed: consumables,
            procedureIncluded,
            servicesOffered,
            prescriptionRequired: prescriptionRequired === 'true',
            photos
        });

        res.status(201).json({ success: true, message: "Service created with custom pricing", data: service });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE SERVICE (Figma Screen 42 Edit Mode)
const updateService = async (req, res) => {
    try {
        const { id } = req.params;
        let updateData = { ...req.body };

        // Recalculate Final Price if amount or discount changed
        if (req.body.amount || req.body.discountPercentage) {
            const amt = Number(req.body.amount) || 0;
            const disc = Number(req.body.discountPercentage) || 0;
            updateData.finalPrice = Math.round(amt - (amt * (disc / 100)));
        }

        if (req.files && req.files['photos']) {
            updateData.photos = req.files['photos'].map(f => f.path);
        }

        const updated = await NurseService.findOneAndUpdate(
            { _id: id, nurseId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        res.json({ success: true, message: "Service Updated", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. DASHBOARD (Stats remain same)
const getNurseDashboard = async (req, res) => {
    try {
        const stats = await NurseBooking.aggregate([
            { $match: { nurseId: req.user._id } },
            { $group: {
                _id: null,
                todayRequests: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
                accepted: { $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] } },
                completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
                totalEarnings: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$priceBreakdown.totalPrice", 0] } }
            }}
        ]);
        res.json({ success: true, stats: stats[0] || { todayRequests:0, accepted:0, completed:0, totalEarnings:0 } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. ACCEPT/REJECT REQUEST (Figma Image 3 & 4)
const handleBookingAction = async (req, res) => {
    try {
        const { bookingId, action, reason } = req.body; // action: 'Accept' or 'Reject'
        
        let update = {};
        if (action === 'Accept') {
            update = { status: 'Confirmed' };
        } else {
            // Figma Image 4 reasons
            update = { status: 'Cancelled', rejectionReason: reason };
        }

        const booking = await NurseBooking.findOneAndUpdate(
            { _id: bookingId, nurseId: req.user.id },
            update,
            { new: true }
        );

        res.json({ success: true, message: `Booking ${action}ed`, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 4. DELETE SERVICE
const deleteService = async (req, res) => {
    try {
        const deleted = await NurseService.findOneAndDelete({ _id: req.params.id, nurseId: req.user.id });
        if (!deleted) return res.status(404).json({ message: "Service not found" });
        res.json({ success: true, message: "Service Deleted Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. GET MY SERVICES (List for Provider)
const getMyServices = async (req, res) => {
    try {
        const services = await NurseService.find({ nurseId: req.user.id });
        res.json({ success: true, data: services });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const manageConsumable = async (req, res) => {
    try {
        const { id, itemName, category, unitType, price } = req.body;
        const nurseId = req.user.id;

        if (id) {
            // FIGMA SCREEN 15: UPDATE LOGIC
            const updatedItem = await NurseConsumable.findOneAndUpdate(
                { _id: id, nurseId: nurseId }, // Security: Sirf apni consumable update kar sake
                { 
                    itemName, 
                    category, 
                    unitType, 
                    price: Number(price) // Price update yahan ho raha hai
                },
                { new: true }
            );

            if (!updatedItem) return res.status(404).json({ message: "Item not found" });
            return res.json({ success: true, message: "Price/Detail Updated", data: updatedItem });
        } else {
            // FIGMA SCREEN 14: ADD LOGIC
            const newItem = await NurseConsumable.create({
                nurseId, itemName, category, unitType, price
            });
            res.status(201).json({ success: true, message: "Item Added", data: newItem });
        }
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const listConsumables = async (req, res) => {
    try {
        const consumables = await NurseConsumable.find({ nurseId: req.user.id });
        res.json({ success: true, data: consumables });
    } catch (error) { res.status(500).json({ message: error.message }); }
}

// DELETE CONSUMABLE (Figma Screen 8: Delete Button)
const deleteConsumable = async (req, res) => {
    try {
        await NurseConsumable.findOneAndDelete({ _id: req.params.id, nurseId: req.user.id });
        res.json({ success: true, message: "Item removed from your list" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNurseStats = async (req, res) => {
    try {
        const today = moment().startOf('day');
        const stats = await NurseBooking.aggregate([
            { $match: { nurseId: req.user._id, createdAt: { $gte: today.toDate() } } },
            { $group: {
                _id: null,
                todayRequests: { $sum: 1 },
                accepted: { $sum: { $cond: [{ $in: ["$status", ["Confirmed", "Assigned"]] }, 1, 0] } },
                completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
                earnings: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$priceBreakdown.totalPrice", 0] } }
            }}
        ]);
        res.json({ success: true, data: stats[0] || { todayRequests: 0, accepted: 0, completed: 0, earnings: 0 } });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

// 2. ACCEPT/REJECT (Figma Image 3 & 4)
const manageBookingRequest = async (req, res) => {
    try {
        const { bookingId, action, reason } = req.body; // action: 'Accept' or 'Reject'
        const status = (action === 'Accept') ? 'Confirmed' : 'Cancelled';
        
        const booking = await NurseBooking.findOneAndUpdate(
            { _id: bookingId, nurseId: req.user.id },
            { status, rejectionReason: reason },
            { new: true }
        );

        res.json({ success: true, message: `Booking ${action}ed`, data: booking });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

// 3. GET NEW REQUESTS (Figma Image 5)
const getNewRequests = async (req, res) => {
    try {
        const requests = await NurseBooking.find({ nurseId: req.user.id, status: 'Pending' })
            .sort({ createdAt: -1 });
        res.json({ success: true, data: requests });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

module.exports = { getNurseDashboard, addService, updateService, deleteService, getMyServices,handleBookingAction,
     manageConsumable,listConsumables, deleteConsumable, getNurseStats, manageBookingRequest, getNewRequests };