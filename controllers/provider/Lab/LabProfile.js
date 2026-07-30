const Lab = require('../../../models/Lab');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getLocationFilter } = require('../../../middleware/authMiddleware');
const { sendPushNotification } = require('../../../utils/notification');
const { deleteFile } = require('../../../utils/fileHandler'); // Import the deleteFile utility
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest'); // For handling profile update requests

// 1. GET PROFILE (Figma: Settings / My Profile)
// endpoint: GET /provider/labs/profile
const getLabProfile = async (req, res) => {
    try {
        const lab = await Lab.findById(req.user.id);
        res.json({ success: true, data: lab });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


const updateLabProfile = async (req, res) => {
    try {
        const labId = req.user.id;
        const {
            name, about, address,
            isHomeCollectionAvailable, isRapidServiceAvailable,
            isInsuranceAccepted, acceptedInsurances, is24x7,
            country, state, city, lat, lng,
            alternatePhone,
            nablNumber 
        } = req.body;
 
        const existingLab = await Lab.findById(labId);
        if (!existingLab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }

        let updateData = {
            name, about, address, country, state, city,
            isHomeCollectionAvailable: isHomeCollectionAvailable === 'true' || isHomeCollectionAvailable === true,
            isRapidServiceAvailable: isRapidServiceAvailable === 'true' || isRapidServiceAvailable === true,
            isInsuranceAccepted: isInsuranceAccepted === 'true' || isInsuranceAccepted === true,
            is24x7: is24x7 === 'true' || is24x7 === true,
            location: { lat: Number(lat || existingLab.location?.lat || 0), lng: Number(lng || existingLab.location?.lng || 0) },
            alternatePhone
        };
 
        if (acceptedInsurances) {
            updateData.acceptedInsurances = typeof acceptedInsurances === 'string'
                ? JSON.parse(acceptedInsurances)
                : acceptedInsurances;
        }
 
        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
            updateData.profileImage = req.files.profileImage[0].path;
        }

        if (req.files && req.files.signatureImage && req.files.signatureImage[0]) {
            updateData.signatureImage = req.files.signatureImage[0].path;
        }

        if (nablNumber !== undefined) {
            updateData['documents.nablNumber'] = nablNumber;
        }

        // 🚨 DISK CLEANUP: Delete unapproved files from any existing PENDING request
        const existingPending = await ProfileUpdateRequest.findOne({ vendorId: labId, vendorModel: 'Lab', status: 'Pending' });
        if (existingPending) {
            if (updateData.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            if (updateData.signatureImage && existingPending.updatedFields?.signatureImage) {
                deleteFile(existingPending.updatedFields.signatureImage);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }
 
        const request = await ProfileUpdateRequest.create({
            vendorId: labId,
            vendorModel: 'Lab',
            updatedFields: updateData,
            status: 'Pending'
        });
       
        res.json({ 
            success: true, 
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.", 
            data: request 
        });
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

// GET: Fetch latest profile update request status for logged-in Lab
const getLatestLabProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Lab'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH: Change Lab Password
// Endpoint: PATCH /provider/labs/profile/change-password
const changeLabPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

        const lab = await Lab.findById(req.user.id).select('+password');
        if (!lab) return res.status(404).json({ success: false, message: "Lab not found." });

        const isMatch = await bcrypt.compare(String(oldPassword), lab.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        lab.password = await bcrypt.hash(String(newPassword), 10);
        await lab.save();

        res.json({ success: true, message: "Lab password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = { getLabProfile, updateLabProfile, getMyAllServices, getLatestLabProfileRequest, changeLabPassword };