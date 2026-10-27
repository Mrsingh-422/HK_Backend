// controllers/admin/others/ProfileUpdateApproval.js (FIXED & FULLY OPTIMIZED)
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest');
const { deleteFile } = require('../../../utils/fileHandler'); 

// Models mapping for dynamic resolution
const Hospital = require('../../../models/Hospital');
const Doctor = require('../../../models/Doctor');
const Nurse = require('../../../models/Nurse');
const Pharmacy = require('../../../models/Pharmacy');
const Lab = require('../../../models/Lab');
const Ambulance = require('../../../models/Ambulance');
const Driver = require('../../../models/Driver');
const PoliceHQ = require('../../../models/PoliceHQ');
const FireHQ = require('../../../models/FireHQ');

const { sendPushNotification } = require('../../../utils/notification');

const modelMap = {
    'Hospital': Hospital,
    'Doctor': Doctor,
    'Nurse': Nurse,
    'Pharmacy': Pharmacy,
    'Lab': Lab,
    'Ambulance': Ambulance,
    'Driver': Driver,
    'PoliceHQ': PoliceHQ,
    'FireHQ': FireHQ 
};

// 🧹 SMART HELPER: Deep File Cleaner for both Root & Nested Document paths
const cleanNestedFiles = (filePathOrArray) => {
    if (!filePathOrArray) return;
    if (Array.isArray(filePathOrArray)) {
        filePathOrArray.forEach(file => {
            if (typeof file === 'string') deleteFile(file);
        });
    } else if (typeof filePathOrArray === 'string') {
        deleteFile(filePathOrArray);
    }
};

// 1. GET: List Profile Update Requests (With Vendor Name & Details Populated)
// Endpoint: GET /api/admin/profile-update
const getProfileUpdateRequests = async (req, res) => {
    try {
        const { status = 'Pending', vendorModel, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = {};
        if (status && status !== 'All') query.status = status;
        if (vendorModel) query.vendorModel = vendorModel;

        const [requests, total] = await Promise.all([
            ProfileUpdateRequest.find(query)
                // 🚨 FIXED: Populates Vendor Name, Phone, City for Admin Dashboard Table
                .populate({
                    path: 'vendorId',
                    select: 'name email phone city state profileImage'
                })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            ProfileUpdateRequest.countDocuments(query)
        ]);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET: Request Details & Side-by-Side Comparison
// Endpoint: GET /api/admin/profile-update/:requestId
const getProfileUpdateRequestDetails = async (req, res) => {
    try {
        const { requestId } = req.params;

        const request = await ProfileUpdateRequest.findById(requestId)
            .populate('adminId', 'name email')
            .lean();
            
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found." });
        }

        const TargetModel = modelMap[request.vendorModel];
        if (!TargetModel) {
            return res.status(400).json({ success: false, message: "Invalid model mapping." });
        }

        // Fetch current active profile data to allow side-by-side comparison on Admin UI
        const currentProfile = await TargetModel.findById(request.vendorId).select('-password -token').lean();

        res.json({
            success: true,
            data: {
                request,
                currentProfile: currentProfile || null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Process vendor staged profile update request (Approve/Reject) & dispatch alert
// @route   POST /api/admin/profile-update/:requestId/action
// @access  Private (Admin)
const handleProfileUpdateAction = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { action, reason } = req.body; // action: 'Approve' | 'Reject'

        const request = await ProfileUpdateRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "Profile update request not found." });
        }

        if (request.status !== 'Pending') {
            return res.status(400).json({ success: false, message: `Request already processed. Status is: ${request.status}` });
        }

        const TargetModel = modelMap[request.vendorModel];
        if (!TargetModel) {
            return res.status(400).json({ success: false, message: "Invalid vendor model type." });
        }

        const currentProfile = await TargetModel.findById(request.vendorId).lean();
        const updated = request.updatedFields || {};

        if (action === 'Approve') {
            if (currentProfile) {
                if (updated.profileImage && currentProfile.profileImage) {
                    deleteFile(currentProfile.profileImage);
                }
                if (updated['documents.signatureImage'] && currentProfile.documents?.signatureImage) {
                    deleteFile(currentProfile.documents.signatureImage);
                }
                if (updated['documents.drugLicenses'] && currentProfile.documents?.drugLicenses) {
                    cleanNestedFiles(currentProfile.documents.drugLicenses);
                }
                if (updated['documents.pharmacyImages'] && currentProfile.documents?.pharmacyImages) {
                    cleanNestedFiles(currentProfile.documents.pharmacyImages);
                }
            }

            await TargetModel.findByIdAndUpdate(
                request.vendorId,
                { $set: updated },
                { new: true, runValidators: false }
            );

            request.status = 'Approved';
            request.rejectionReason = null;

        } else if (action === 'Reject') {
            if (updated.profileImage) deleteFile(updated.profileImage);
            if (updated['documents.signatureImage']) deleteFile(updated['documents.signatureImage']);
            if (updated['documents.drugLicenses']) cleanNestedFiles(updated['documents.drugLicenses']);
            if (updated['documents.pharmacyImages']) cleanNestedFiles(updated['documents.pharmacyImages']);

            request.status = 'Rejected';
            request.rejectionReason = reason || "Request declined by Administrator after audit.";
        } else {
            return res.status(400).json({ success: false, message: "Invalid action type. Expected 'Approve' or 'Reject'." });
        }

        request.adminId = req.user.id;
        await request.save();

        // 🚨 VENDOR PUSH NOTIFICATION: Alert vendor about profile update status
        const vendorRole = String(request.vendorModel).toLowerCase();
        try {
            const notifTitle = action === 'Approve' ? "✅ Profile Changes Approved" : "❌ Profile Update Declined";
            const notifBody = action === 'Approve' 
                ? "Your requested profile details have been verified and applied successfully."
                : `Your profile update was declined. Reason: "${request.rejectionReason}".`;

            await sendPushNotification(
                request.vendorId,
                vendorRole,
                notifTitle,
                notifBody,
                {
                    type: action === 'Approve' ? 'PROFILE_UPDATE_APPROVED' : 'PROFILE_UPDATE_REJECTED',
                    vendorModel: String(request.vendorModel),
                    requestId: String(request._id),
                    click_action: 'FLUTTER_NOTIFICATION_CLICK'
                }
            );
        } catch (notifErr) {
            console.error("Profile Update Notification Error:", notifErr.message);
        }

        res.json({
            success: true,
            message: `Profile update request successfully ${request.status}!`,
            data: request
        });

    } catch (error) {
        console.error("handleProfileUpdateAction Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getProfileUpdateRequests, 
    getProfileUpdateRequestDetails, 
    handleProfileUpdateAction 
};