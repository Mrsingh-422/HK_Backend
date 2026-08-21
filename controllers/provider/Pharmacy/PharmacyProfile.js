const Pharmacy = require('../../../models/Pharmacy');
const Medicine = require('../../../models/Medicine'); // Assumed model name
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest'); // For handling profile update requests
const { deleteFile } = require('../../../utils/fileHandler');

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
            country, state, city, lat, lng,
            alternatePhone,
            
            // 🚨 NEW LICENSE & REGISTRATION FIELDS
            drugLicenseNumber,
            foodLicenseNumber,
            gstNumber,
            issuingAuthority,
            drugLicenseType
        } = req.body;
 
        let updateData = {
            name, about, address, country, state, city,
            isHomeDeliveryAvailable: isHomeDeliveryAvailable === 'true',
            isRapidServiceAvailable: isRapidServiceAvailable === 'true',
            isInsuranceAccepted: isInsuranceAccepted === 'true',
            is24x7: is24x7 === 'true',
            location: { lat: Number(lat || 0), lng: Number(lng || 0) },
            alternatePhone
        };
 
        if (acceptedInsurances) {
            updateData.acceptedInsurances = typeof acceptedInsurances === 'string' 
                ? JSON.parse(acceptedInsurances) 
                : acceptedInsurances;
        }

        // 🚨 TEXT LICENSE NUMBERS MAPPING (Using dot-notation to avoid erasing existing document arrays)
        if (drugLicenseNumber !== undefined) updateData['documents.drugLicenseNumber'] = drugLicenseNumber.trim();
        if (foodLicenseNumber !== undefined) updateData['documents.foodLicenseNumber'] = foodLicenseNumber.trim();
        if (gstNumber !== undefined) updateData['documents.gstNumber'] = gstNumber.trim();
        if (issuingAuthority !== undefined) updateData['documents.issuingAuthority'] = issuingAuthority.trim();
        if (drugLicenseType !== undefined) updateData['documents.drugLicenseType'] = drugLicenseType;
 
        // 🚨 FILE ATTACHMENTS (Profile Image & Signature/Stamp)
        if (req.files) {
            if (req.files.profileImage && req.files.profileImage[0]) {
                updateData.profileImage = req.files.profileImage[0].path.replace(/\\/g, "/");
            }
            if (req.files.signatureImage && req.files.signatureImage[0]) {
                // Authorised Signatory Stamp/Signature
                updateData['documents.signatureImage'] = req.files.signatureImage[0].path.replace(/\\/g, "/");
            }
            if (req.files.drugLicenses && req.files.drugLicenses.length > 0) {
                updateData['documents.drugLicenses'] = req.files.drugLicenses.map(f => f.path.replace(/\\/g, "/"));
            }
            if (req.files.pharmacyImages && req.files.pharmacyImages.length > 0) {
                updateData['documents.pharmacyImages'] = req.files.pharmacyImages.map(f => f.path.replace(/\\/g, "/"));
            }
        }

        // 🚨 DISK CLEANUP: Delete unapproved files from any existing PENDING request
        const existingPending = await ProfileUpdateRequest.findOne({ vendorId: pharmacyId, vendorModel: 'Pharmacy', status: 'Pending' });
        if (existingPending) {
            if (updateData.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            if (updateData['documents.signatureImage'] && existingPending.updatedFields?.['documents.signatureImage']) {
                deleteFile(existingPending.updatedFields['documents.signatureImage']);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }
 
        // Create new pending approval request for Admin
        const request = await ProfileUpdateRequest.create({
            vendorId: pharmacyId,
            vendorModel: 'Pharmacy',
            updatedFields: updateData,
            status: 'Pending'
        });

        res.json({ 
            success: true, 
            message: "Profile and License changes submitted to Admin for review. It will update on your bills once approved.", 
            data: request 
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

// GET: Fetch latest profile update request status for logged-in Pharmacy
const getLatestPharmacyProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Pharmacy'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH: Change Pharmacy Bureau Password
// Endpoint: PATCH /provider/pharmacy/profile/change-password
const changePharmacyPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

        // Find the pharmacy and select password safely
        const pharmacy = await Pharmacy.findById(req.user.id).select('+password');
        if (!pharmacy) {
            return res.status(404).json({ success: false, message: "Pharmacy Bureau not found." });
        }

        // Verify old password
        const isMatch = await bcrypt.compare(String(oldPassword), pharmacy.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(String(newPassword), 10);

        // 🚀 CRASH-PROOF FIX: Use findByIdAndUpdate to bypass validation of other fields
        await Pharmacy.findByIdAndUpdate(
            req.user.id,
            { $set: { password: hashedPassword } },
            { runValidators: false } // Prevents document validation crashes on incomplete profiles
        );

        res.json({ success: true, message: "Pharmacy Bureau password updated successfully." });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { 
    getPharmacyProfile, 
    updatePharmacyProfile, 
    changePharmacyPassword,

    getMyMedicines,
    getLatestPharmacyProfileRequest
};