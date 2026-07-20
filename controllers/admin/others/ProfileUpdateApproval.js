// controllers/admin/others/ProfileUpdateApproval.js
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest');
const { deleteFile } = require('../../../utils/fileHandler'); // Path relative to file location

// Models mapping for dynamic resolution
const Hospital = require('../../../models/Hospital');
const Doctor = require('../../../models/Doctor');
const Nurse = require('../../../models/Nurse');
const Pharmacy = require('../../../models/Pharmacy');
const Lab = require('../../../models/Lab');
const Ambulance = require('../../../models/Ambulance');
const Driver = require('../../../models/Driver');

const modelMap = {
    'Hospital': Hospital,
    'Doctor': Doctor,
    'Nurse': Nurse,
    'Pharmacy': Pharmacy,
    'Lab': Lab,
    'Ambulance': Ambulance,
    'Driver': Driver
};

// 1. GET: List Profile Update Requests (With Pagination & Filters)
// Endpoint: GET /api/admin/profile-update
const getProfileUpdateRequests = async (req, res) => {
    try {
        const { status = 'Pending', vendorModel, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { status };
        if (vendorModel) query.vendorModel = vendorModel;

        const [requests, total] = await Promise.all([
            ProfileUpdateRequest.find(query)
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

        const request = await ProfileUpdateRequest.findById(requestId).lean();
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

// 3. POST: Process Profile Update Request (Approve/Reject)
// Endpoint: POST /api/admin/profile-update/:requestId/action
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

        const fileKeysToClean = ['profileImage', 'signatureImage', 'profilePic'];

        if (action === 'Approve') {
            // --- CLEANUP OLD FILE ON APPROVAL ---
            const currentProfile = await TargetModel.findById(request.vendorId).lean();
            if (currentProfile) {
                fileKeysToClean.forEach(key => {
                    // If a new file is approved, delete the old file from server disk
                    if (request.updatedFields[key] && currentProfile[key]) {
                        deleteFile(currentProfile[key]);
                        console.log(`[Disk Cleanup - Approval]: Deleted old file at path: ${currentProfile[key]}`);
                    }
                });
            }

            // Apply the staged update fields directly to the primary vendor document
            await TargetModel.findByIdAndUpdate(
                request.vendorId,
                { $set: request.updatedFields },
                { new: true, runValidators: true }
            );
            request.status = 'Approved';

        } else if (action === 'Reject') {
            // --- CLEANUP NEW REJECTED FILE ON REJECTION ---
            fileKeysToClean.forEach(key => {
                // Since the request is rejected, the newly uploaded file is deleted to save server space
                if (request.updatedFields[key]) {
                    deleteFile(request.updatedFields[key]);
                    console.log(`[Disk Cleanup - Rejection]: Deleted unused pending file at path: ${request.updatedFields[key]}`);
                }
            });

            request.status = 'Rejected';
            request.rejectionReason = reason || "Request declined by Administrator.";
        } else {
            return res.status(400).json({ success: false, message: "Invalid action type. Expected 'Approve' or 'Reject'." });
        }

        request.adminId = req.user.id;
        await request.save();

        res.json({
            success: true,
            message: `Profile update request successfully ${request.status}!`,
            data: request
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getProfileUpdateRequests, 
    getProfileUpdateRequestDetails, 
    handleProfileUpdateAction 
};