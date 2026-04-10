const Lab = require('../../../models/Lab');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getLocationFilter } = require('../../../middleware/authMiddleware');

// 1. GET PROFILE (Figma: Settings / My Profile)
// endpoint: GET /provider/labs/profile
const getLabProfile = async (req, res) => {
    try {
        const lab = await Lab.findById(req.user.id);
        res.json({ success: true, data: lab });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE PROFILE (Figma: Edit Profile)
// endpoint: PUT /provider/labs/profile/update
const updateLabProfile = async (req, res) => {
    try {
        const labId = req.user.id;
        const { 
            name, about, address, 
            isHomeCollectionAvailable, isRapidServiceAvailable, 
            isInsuranceAccepted, acceptedInsurances, is24x7,
            // Location details
            country, state, city, lat, lng,
            // Document details (Text fields)
            documentState, issuingAuthority, gstNumber, experience, drugLicenseType
        } = req.body;

        // 1. Base Update Data
        let updateData = {
            name, about, address, country, state, city,
            isHomeCollectionAvailable: isHomeCollectionAvailable === 'true',
            isRapidServiceAvailable: isRapidServiceAvailable === 'true',
            isInsuranceAccepted: isInsuranceAccepted === 'true',
            is24x7: is24x7 === 'true',
            location: { lat, lng }
        };

        // 2. Handle Accepted Insurances (Convert comma string to Array)
        if (acceptedInsurances) {
            updateData.acceptedInsurances = typeof acceptedInsurances === 'string' 
                ? JSON.parse(acceptedInsurances) 
                : acceptedInsurances;
        }

        // 3. Handle Documents Object (Nested Update)
        const docUpdates = {
            documentState, issuingAuthority, gstNumber, experience, drugLicenseType
        };

        // Multer files handling (from labDocUploads middleware)
        if (req.files) {
            if (req.files.profileImage) updateData.profileImage = req.files.profileImage[0].path;
            if (req.files.labImages) docUpdates.labImages = req.files.labImages.map(f => f.path);
            if (req.files.labCertificates) docUpdates.labCertificates = req.files.labCertificates.map(f => f.path);
            if (req.files.labLicenses) docUpdates.labLicenses = req.files.labLicenses.map(f => f.path);
            if (req.files.gstCertificates) docUpdates.gstCertificates = req.files.gstCertificates.map(f => f.path);
            if (req.files.drugLicenses) docUpdates.drugLicenses = req.files.drugLicenses.map(f => f.path);
            if (req.files.otherCertificates) docUpdates.otherCertificates = req.files.otherCertificates.map(f => f.path);
        }

        // 4. Atomic Update: Merge document object into existing documents
        // $set: { "documents.labImages": ... } ensures purane docs uda nahi diye jayenge
        const finalUpdate = { $set: updateData };
        
        // Add document fields to set command
        Object.keys(docUpdates).forEach(key => {
            if (docUpdates[key]) finalUpdate.$set[`documents.${key}`] = docUpdates[key];
        });

        const lab = await Lab.findByIdAndUpdate(labId, finalUpdate, { new: true });
        
        res.json({ success: true, message: "Lab profile updated successfully", data: lab });
    } catch (error) { 
        console.error("Update Error:", error);
        res.status(500).json({ message: error.message }); 
    }
};

// 3. GET LAB SERVICES (My Tests + Packages View)
// endpoint: GET /provider/labs/profile/services/my-all-services
const getMyAllServices = async (req, res) => {
    try {
        const LabTest = require('../../../models/LabTest');
        const LabPackage = require('../../../models/LabPackage');
        
        const tests = await LabTest.find({ labId: req.user.id });
        const packages = await LabPackage.find({ labId: req.user.id });
        
        res.json({ success: true, data: { tests, packages } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getLabProfile, updateLabProfile, getMyAllServices };