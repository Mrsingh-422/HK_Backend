const PharmacyBooking = require('../../../models/PharmacyBooking');
const Pharmacy = require('../../../models/Pharmacy');

// --- 1. ADMIN: GET APPROVED PHARMACIES LIST (Limit: 25) ---
// Endpoint: GET /admin/pharmacy/approved-list?page=1
const adminGetApprovedPharmacies = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const pharmacies = await Pharmacy.find(query)
            .select('name email phone city profileImage profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Pharmacy.countDocuments(query);

        res.json({
            success: true,
            count: pharmacies.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: pharmacies
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. ADMIN: GET PHARMACY BOOKINGS (Filter by pharmacyId & Limit: 25) ---
// Endpoint: GET /admin/pharmacy/bookings?pharmacyId=ID&page=1
const adminGetPharmacyBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; // 👈 25 items limit
        const skip = (page - 1) * limit;
        const { status, userId, pharmacyId } = req.query; // 👈 Added pharmacyId

        const query = {};
        if (status) query.status = status;
        if (userId) query.userId = userId;
        if (pharmacyId) query.pharmacyId = pharmacyId; // 👈 Vendor wise filter
        
        const orders = await PharmacyBooking.find(query)
            .populate('userId', 'name phone email')
            .populate('pharmacyId', 'name profileImage city')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await PharmacyBooking.countDocuments(query);

        res.json({
            success: true,
            count: orders.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: orders
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const toggleActiveInactivePharmacy = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        const pharmacy = await Pharmacy.findById(pharmacyId);
 
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "pharmacy not found." });
        }
 
        const updatedPharmacy = await Pharmacy.findByIdAndUpdate(
            pharmacyId,
            { $set: { isActive: !pharmacy.isActive } },
            { new: true }
        );
 
        return res.json({
            success: true,
            message: `Pharmacy status updated to ${updatedPharmacy.isActive ? 'Active' : 'Inactive'}.`,
            data: {
                pharmacyId: updatedPharmacy._id,
                isActive: updatedPharmacy.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};
 
module.exports = { adminGetApprovedPharmacies,adminGetPharmacyBookings , toggleActiveInactivePharmacy};