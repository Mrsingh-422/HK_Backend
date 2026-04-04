const Pharmacy = require('../../../models/Pharmacy');

// Get Pharmacy Profile
// endpoint: GET /api/provider/pharmacy/profile
const getPharmacyProfile = async (req, res) => {
    try {
        const pharmacyId = req.user.id;

        // Profile find karein aur password exclude karein
        const pharmacy = await Pharmacy.findById(pharmacyId).select('-password');

        if (!pharmacy) {
            return res.status(404).json({ message: "Pharmacy not found" });
        }

        res.status(200).json({ 
            success: true, 
            data: pharmacy 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getPharmacyProfile };