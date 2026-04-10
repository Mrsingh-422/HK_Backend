const Pharmacy = require('../../../models/Pharmacy');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { getDistance } = require('../../../utils/helpers');

// endpoint: POST /api/user/pharmacy/list
const getPharmacies = async (req, res) => {
    try {
        const { lat, lng, city, search } = req.body;
        
        // 1. KM Limit Check
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Pharmacy', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = new RegExp(city, 'i');
        if (search) query.name = new RegExp(search, 'i');

        // 2. Fetch Pharmacies
        const pharmacies = await Pharmacy.find(query)
            .select('name profileImage city address location rating totalReviews isHomeDeliveryAvailable is24x7')
            .lean();

        const filteredPharmacies = [];
        
        for (let pharma of pharmacies) {
            let distance = 0;
            if (lat && lng && pharma.location?.lat) {
                distance = await getDistance(lat, lng, pharma.location.lat, pharma.location.lng);
            }

            if (!lat || distance <= maxRadius) {
                filteredPharmacies.push({
                    ...pharma,
                    distance: distance ? distance.toFixed(1) : "0"
                });
            }
        }

        // 3. Sort by Distance
        if (lat && lng) {
            filteredPharmacies.sort((a, b) => a.distance - b.distance);
        }

        res.json({ success: true, count: filteredPharmacies.length, data: filteredPharmacies });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// endpoint: GET /api/user/pharmacy/details/:id
const getPharmacyDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const pharmacy = await Pharmacy.findById(id).select('-password -token');
        
        if (!pharmacy) return res.status(404).json({ message: "Pharmacy not found" });

        // Status Logic for Figma/UI
        const status = pharmacy.is24x7 ? "Open 24/7" : "Open Today";

        res.json({ 
            success: true, 
            data: {
                ...pharmacy._doc,
                status,
                gallery: pharmacy.documents?.pharmacyImages || []
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

module.exports = { getPharmacies, getPharmacyDetails };