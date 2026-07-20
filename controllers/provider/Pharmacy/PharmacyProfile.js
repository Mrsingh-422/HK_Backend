const Pharmacy = require('../../../models/Pharmacy');
const Medicine = require('../../../models/Medicine'); // Assumed model name
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. GET PHARMACY PROFILE
// endpoint: GET /provider/pharmacy/profile
const getPharmacyProfile = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findById(req.user.id).select('-password');
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Pharmacy not found" });
        }
        res.json({ success: true, data: pharmacy });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. UPDATE PHARMACY PROFILE (Figma: Edit Profile)

// endpoint: PUT /provider/pharmacy/profile/update

const updatePharmacyProfile = async (req, res) => {

    try {

        const pharmacyId = req.user.id;

        const { 

            name, about, address, 

            isHomeDeliveryAvailable, isRapidServiceAvailable, 

            isInsuranceAccepted, acceptedInsurances, is24x7,

            // Location details

            country, state, city, lat, lng,

            // Alternate phone destructured from body

            alternatePhone

        } = req.body;
 
        // 1. Base Update Data (email, phone, password, and documents are completely excluded)

        let updateData = {

            name, about, address, country, state, city,

            isHomeDeliveryAvailable: isHomeDeliveryAvailable === 'true',

            isRapidServiceAvailable: isRapidServiceAvailable === 'true',

            isInsuranceAccepted: isInsuranceAccepted === 'true',

            is24x7: is24x7 === 'true',

            location: { lat, lng },

            alternatePhone // Added to database update payload

        };
 
        // 2. Handle Accepted Insurances

        if (acceptedInsurances) {

            updateData.acceptedInsurances = typeof acceptedInsurances === 'string' 

                ? JSON.parse(acceptedInsurances) 

                : acceptedInsurances;

        }
 
        // 3. Only handle profileImage (if provided in files). 

        // Document uploads are excluded to protect existing uploads from being modified.

        if (req.files && req.files.profileImage) {

            updateData.profileImage = req.files.profileImage[0].path;

        }
 
        // 4. Update query (Only updates basic profile details and profileImage)

        const finalUpdate = { $set: updateData };
 
        const pharmacy = await Pharmacy.findByIdAndUpdate(pharmacyId, finalUpdate, { new: true });

        res.json({ 

            success: true, 

            message: "Pharmacy profile updated successfully", 

            data: pharmacy 

        });

    } catch (error) { 

        console.error("Pharmacy Update Error:", error);

        res.status(500).json({ message: error.message }); 

    }

};
 
// 3. GET PHARMACY SERVICES (Medicines List)
// endpoint: GET /provider/pharmacy/profile/services/my-medicines
const getMyMedicines = async (req, res) => {
    try {
        // Find medicines listed by this pharmacy
        const medicines = await Medicine.find({ pharmacyId: req.user.id });
        
        res.json({ 
            success: true, 
            data: { medicines } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

module.exports = { 
    getPharmacyProfile, 
    updatePharmacyProfile, 
    getMyMedicines 
};