const PoliceStation = require('../../models/PoliceStation');
const PoliceCase = require('../../models/PoliceCase');
const PoliceHQ = require('../../models/PoliceHQ');
const PoliceContent = require('../../models/PoliceContent');

const { getDistance } = require('../../utils/helpers'); // 👈 Direct helper import

// Assume a Notification model exists based on Screens 21/22
// const Notification = require('../../models/Notification');
const bcrypt = require('bcryptjs');
const path = require('path');
 
// --- 1. HQ DASHBOARD (Screen 3) ---
const getHQDashboard = async (req, res) => {
    try {
        const hqId = req.user.id;
        const fresh = await PoliceCase.countDocuments({ hqId, status: 'Fresh' });
        const pending = await PoliceCase.countDocuments({ hqId, status: 'Under Investigation' });
        const history = await PoliceCase.countDocuments({ hqId, status: { $in: ['Closed', 'Archived'] } });
 
        res.json({
            success: true,
            data: {
                freshCases: fresh,
                pendingCases: pending,
                historyCases: history,
                officerName: req.user.commissionerName
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- 2. POLICE STATION CRUD (Screens 4, 5, 7, 9) ---
 
// Create Station (Screen 9)
const createStation = async (req, res) => {
    try {
        const { stationName, stationCode, shoName, email, phone, password, address, landline } = req.body;
        
        const exists = await PoliceStation.findOne({ $or: [{ email }, { stationCode }] });
        if (exists) return res.status(400).json({ success: false, message: "Station Code or Email already exists" });
 
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Handle Profile Image from Multer
        let profileImage = null;
        if (req.files && req.files.profileImage) {
            profileImage = `/uploads/police_stations/${req.files.profileImage[0].filename}`;
        }
 
        const station = await PoliceStation.create({
            hqId: req.user.id,
            stationName, stationCode, shoName, email, phone, address, landline,
            password: hashedPassword,
            profileImage
        });
 
        res.status(201).json({ success: true, message: "Police Station Created Successfully", data: station });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// List Stations (Screen 4)
const listMyStations = async (req, res) => {
    try {
        const stations = await PoliceStation.find({ hqId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, data: stations });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Update Station (Screen 7)
const updateStation = async (req, res) => {
    try {
        const updates = { ...req.body };
        
        // If password is being updated
        if (updates.password) {
            updates.password = await bcrypt.hash(updates.password, 10);
        }
 
        // If image is being updated
        if (req.files && req.files.profileImage) {
            updates.profileImage = `/uploads/police_stations/${req.files.profileImage[0].filename}`;
        }
 
        const updatedStation = await PoliceStation.findByIdAndUpdate(req.params.id, updates, { new: true });
        res.json({ success: true, message: "Station updated", data: updatedStation });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Delete Station (Screen 8)
const deleteStation = async (req, res) => {
    try {
        await PoliceStation.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Station deleted successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- 3. CASE MANAGEMENT (Screens 13, 14, 18, 19, 20) ---
 
// Filtered Cases Logic
const getFilteredCases = async (req, res) => {
    try {
        const { status, subType, search } = req.query;
        // subType: 'New' (unassigned) vs 'Assigned' for Fresh Cases
        
        let query = { hqId: req.user.id };
 
        if (status) query.status = status;
 
        // Screen 13/14 logic: Fresh Cases tab split
        if (status === 'Fresh') {
            if (subType === 'New') query.stationId = { $exists: false };
            if (subType === 'Assigned') query.stationId = { $exists: true };
        }
 
        // Search logic for Case ID or Location
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { locationName: { $regex: search, $options: 'i' } }
            ];
        }
 
        const cases = await PoliceCase.find(query)
            .populate('stationId', 'stationName shoName')
            .sort({ createdAt: -1 });
 
        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Assign Case to Station (Screen 20)
// const assignCase = async (req, res) => {
//     try {
//         const { caseId, stationId } = req.body;
//         const updatedCase = await PoliceCase.findByIdAndUpdate(
//             caseId,
//             { stationId, status: 'Fresh' }, // Still Fresh but now assigned
//             { new: true }
//         );
//         res.json({ success: true, message: "Case Assigned to Station Successfully" });
//     } catch (error) { res.status(500).json({ success: false, message: error.message }); }
// };
 
// --- 4. PROFILE & SETTINGS (Screens 10, 12, 15) ---
 
const getHQProfile = async (req, res) => {
    try {
        const hq = await PoliceHQ.findById(req.user.id);
        res.json({ success: true, data: hq });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const updateHQProfile = async (req, res) => {
    try {
        const updates = { ...req.body };
        
        if (req.files && req.files.profileImage) {
            updates.profileImage = `/uploads/police_hq/${req.files.profileImage[0].filename}`;
        }
 
        const hq = await PoliceHQ.findByIdAndUpdate(req.user.id, updates, { new: true });
        res.json({ success: true, message: "Profile Updated", data: hq });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const changePasswordHQ = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const hq = await PoliceHQ.findById(req.user.id).select('+password');
 
        const isMatch = await bcrypt.compare(oldPassword, hq.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Current password is wrong" });
 
        hq.password = await bcrypt.hash(newPassword, 10);
        await hq.save();
 
        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- 5. NOTIFICATIONS (Screens 21, 22) ---
// Note: This logic depends on having a Notification model.
// If you don't have one, you'll need to create it.
const getNotifications = async (req, res) => {
    try {
        // Mock logic/placeholder
        // const notifications = await Notification.find({ recipientId: req.user.id });
        res.json({ success: true, message: "Notifications fetched", data: [] });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const deleteNotification = async (req, res) => {
    try {
        // await Notification.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Notification removed" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
/**
* CREATE CASE
* Handles new incident registration from HQ
*/
const createCase = async (req, res) => {
    try {
        const newCase = await PoliceCase.create({
            ...req.body,
            hqId: req.user.id, // Set HQ ID from authenticated user
            status: 'Fresh'    // Initial status for new cases
        });
 
        res.status(201).json({
            success: true,
            message: "Case registered successfully",
            data: newCase
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
 
/**
* UPDATE CASE
* Updates details like victim info, severity, or description
*/
const updateCase = async (req, res) => {
    try {
        const updatedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        );
 
        if (!updatedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }
 
        res.json({
            success: true,
            message: "Case details updated",
            data: updatedCase
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
 
/**
* DELETE CASE
* Permanently removes a case from the database
*/
const deleteCase = async (req, res) => {
    try {
        const deletedCase = await PoliceCase.findByIdAndDelete(req.params.id);
        
        if (!deletedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }
 
        res.json({ success: true, message: "Case removed from records" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
/**
* ASSIGN CASE
* Specifically handles assigning a case to a Police Station and Staff
*/
const assignCase = async (req, res) => {
    try {
        const { stationId, severityLevel } = req.body;
        
        const updatedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            {
                stationId,
                // assignedStaff,
                severityLevel,
                status: 'Pending', // Status changes once assigned
                dispatchedAt: Date.now()
            },
            { new: true }
        );
 
        res.json({
            success: true,
            message: "Case assigned to station successfully",
            data: updatedCase
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * GET HQ CASE HISTORY
 * Police HQ scope ke under closed aur archived cases ki complete list fetch karta hai
 */
const getHQCaseHistory = async (req, res) => {
    try {
        const hqId = req.user.id;
        
        // History cases ka matlab status 'Closed' ya 'Archived' hona
        const query = {
            hqId,
            status: { $in: ['Closed', 'Archived'] }
        };

        const history = await PoliceCase.find(query)
            .populate('stationId', 'stationName shoName stationCode')
            .populate('assignedStaff', 'fullName rank badgeId')
            .sort({ resolvedAt: -1, updatedAt: -1 }); // Newest resolved cases first

        res.json({
            success: true,
            count: history.length,
            data: history
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --------------------------------------------------
/**
 * GET PENDING / ACTIVE CASES
 * Status: 'Pending', 'Under Investigation', 'Critical', 'On Hold'
 */
const getPendingCases = async (req, res) => {
    try {
        const hqId = req.user.id;
        const { search, page = 1, limit = 10 } = req.query;
 
        // Fetching all active cases that are not fresh and not closed
        let query = {
            hqId,
            status: { $in: ['Pending', 'Under Investigation', 'Critical', 'On Hold'] }
        };
 
        // Search by Case Number, Victim Name or Address
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { victimName: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }
 
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const pendingCases = await PoliceCase.find(query)
            .populate('stationId', 'stationName shoName stationCode')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
 
        const total = await PoliceCase.countDocuments(query);
 
        res.json({
            success: true,
            message: "Pending cases fetched successfully",
            data: pendingCases,
            pagination: {
                totalRecords: total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
/**
 * GET CLOSED CASES
 * Status: 'Closed'
 */
const getClosedCases = async (req, res) => {
    try {
        const hqId = req.user.id;
        const { search, page = 1, limit = 10 } = req.query;
 
        let query = { hqId, status: 'Closed' };
 
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { victimName: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }
 
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const closedCases = await PoliceCase.find(query)
            .populate('stationId', 'stationName shoName stationCode')
            .sort({ resolvedAt: -1, updatedAt: -1 }) // Sorted by resolution time
            .skip(skip)
            .limit(parseInt(limit));
 
        const total = await PoliceCase.countDocuments(query);
 
        res.json({
            success: true,
            message: "Closed cases fetched successfully",
            data: closedCases,
            pagination: {
                totalRecords: total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
/**
 * GET ARCHIVED CASES
 * Status: 'Archived'
 */
const getArchivedCases = async (req, res) => {
    try {
        const hqId = req.user.id;
        const { search, page = 1, limit = 10 } = req.query;
 
        let query = { hqId, status: 'Archived' };
 
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { victimName: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }
 
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const archivedCases = await PoliceCase.find(query)
            .populate('stationId', 'stationName shoName stationCode')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
 
        const total = await PoliceCase.countDocuments(query);
 
        res.json({
            success: true,
            message: "Archived cases fetched successfully",
            data: archivedCases,
            pagination: {
                totalRecords: total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
 
 /**
 * 1. UPDATE CASE STATUS (HQ Level)
 * Figma Link: Screen 25 & 26 (Status change to 'On Hold' or 'Under Investigation')
 */
const updateCaseStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;

        const allowedStatus = ['Fresh', 'Pending', 'Under Investigation', 'On Hold', 'Critical', 'Closed', 'Archived'];
        if (!allowedStatus.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value" });
        }

        const updatedCase = await PoliceCase.findByIdAndUpdate(
            id,
            { $set: { status, remarks } },
            { new: true, runValidators: true }
        );

        if (!updatedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        res.json({
            success: true,
            message: `Case status updated to ${status} successfully`,
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. ADD EVIDENCE / ATTACH FILE FROM HQ
 * Figma Link: Screen 4 & 5 (Case Details Page - Attached File Section with Upload button)
 */
/**
 * ADD EVIDENCE FROM HQ (Using Dedicated policeEvidenceUploads Multer)
 * Figma: Screen 4 & 5 (Upload file section with Camera/Gallery)
 */
const addEvidenceHQ = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Multi-files are received via req.files (from Multer array)
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "No files uploaded" });
        }

        const caseData = await PoliceCase.findById(id);
        if (!caseData) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        // Processing each file array
        req.files.forEach(file => {
            caseData.evidence.push({
                fileName: file.originalname,
                fileUrl: `/uploads/police_evidence/${file.filename}`,
                fileType: file.mimetype.startsWith('image/') ? 'Image' : 
                          file.mimetype.startsWith('video/') ? 'Video' : 'Document',
                fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
                uploadedAt: Date.now()
            });
        });

        caseData.progress.isEvidenceCollected = true;
        await caseData.save();

        res.json({
            success: true,
            message: `${req.files.length} Evidence files attached successfully`,
            data: caseData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * SEND REINFORCEMENT/SUPPORT REQUEST TO OTHER STATIONS
 * Figma: Case Details page backup flow or emergency override trigger
 */
const sendSupportRequest = async (req, res) => {
    try {
        const { id } = req.params; // Case ID
        const { supportingStationIds } = req.body; // Array of local police station ObjectIds

        if (!supportingStationIds || !Array.isArray(supportingStationIds)) {
            return res.status(400).json({ success: false, message: "supportingStationIds array is required" });
        }

        const updatedCase = await PoliceCase.findByIdAndUpdate(
            id,
            { 
                $addToSet: { supportingStations: { $each: supportingStationIds } },
                $set: { emergencyOverride: true } // Override trigger for backup status
            },
            { new: true }
        ).populate('supportingStations', 'stationName stationCode shoName');

        if (!updatedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        res.json({
            success: true,
            message: "Emergency support request sent to supporting stations successfully",
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 3. CLOSE CASE & SUBMIT FINAL REMARKS (HQ Level)
 * Figma Link: Screen 34 (Case Summary / Case Closed View)
 */
const closeCaseHQ = async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks, propertyDamageValue, injuries, casualties, impactLevel } = req.body;

        const updatedCase = await PoliceCase.findByIdAndUpdate(
            id,
            {
                $set: {
                    status: 'Closed',
                    remarks,
                    resolvedAt: Date.now(),
                    'progress.isReportSubmitted': true,
                    'damageImpact.propertyDamageValue': propertyDamageValue || 0,
                    'damageImpact.injuries': injuries || 0,
                    'damageImpact.casualties': casualties || 0,
                    'damageImpact.impactLevel': impactLevel || 'Minor'
                }
            },
            { new: true }
        );

        if (!updatedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        res.json({
            success: true,
            message: "Case marked as Closed successfully",
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 4. RE-ASSIGN / DISPATCH CASE TO ANOTHER POLICE STATION
 * Figma Link: Screen 4, 9, 11 & 29 (Case Re-assign button click opens Select Station grid & Confirm modal)
 */
const reassignCaseHQ = async (req, res) => {
    try {
        const { id } = req.params;
        const { stationId, severityLevel } = req.body;

        // Check if destination station exists
        const stationExists = await PoliceStation.findById(stationId);
        if (!stationExists) {
            return res.status(404).json({ success: false, message: "Target Police Station not found" });
        }

        const updatedCase = await PoliceCase.findByIdAndUpdate(
            id,
            {
                $set: {
                    stationId,
                    severityLevel: severityLevel || 'Level 1',
                    status: 'Pending', // Reassign hone par status 'Pending' ho jata hai local action ke liye
                    dispatchedAt: Date.now(),
                    'progress.isAccepted': false, // Progress reset for new station
                    'progress.isSiteVisited': false,
                    'progress.isEvidenceCollected': false,
                    'progress.isReportSubmitted': false,
                    assignedStaff: [] // Purane assigned officers clean honge naye station ke liye
                }
            },
            { new: true }
        ).populate('stationId', 'stationName shoName stationCode');

        res.json({
            success: true,
            message: "Case re-assigned successfully to " + stationExists.stationName,
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * 1. GET FULL CASE SUMMARY
 * Figma Link: Screen 34 (FIR Details, Incident Info, Legal Progress, Attached Evidence)
 */
const getCaseSummary = async (req, res) => {
    try {
        const { id } = req.params;

        const caseData = await PoliceCase.findById(id)
            .populate('stationId', 'stationName stationCode shoName email phone')
            .populate('assignedStaff', 'fullName rank badgeId mobileNumber')
            .populate('transportDetails.ambulanceId')
            .populate('transportDetails.hospitalId');

        if (!caseData) {
            return res.status(404).json({ success: false, message: "Case summary records not found." });
        }

        res.json({
            success: true,
            message: "Detailed case summary fetched successfully",
            data: caseData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. UPDATE LEGAL & COURT PROGRESS INFO
 * Figma Link: Screen 34 (Legal Progress Grid form)
 */
const updateLegalProgress = async (req, res) => {
    try {
        const { id } = req.params;
        const { complainantName, accusedName, ipcSections, arrestStatus, bailStatus, courtDate, isChargeSheetFiled } = req.body;

        const updatedCase = await PoliceCase.findByIdAndUpdate(
            id,
            {
                $set: {
                    complainantName,
                    accusedName,
                    ipcSections,
                    'legalProgress.arrestStatus': arrestStatus,
                    'legalProgress.bailStatus': bailStatus,
                    'legalProgress.courtDate': courtDate,
                    'legalProgress.isChargeSheetFiled': isChargeSheetFiled
                }
            },
            { new: true, runValidators: true }
        );

        if (!updatedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        res.json({
            success: true,
            message: "Legal and court progress metrics updated",
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 1. MARK ALL NOTIFICATIONS AS READ
 * Figma Link: Screen 1 & 2 (Top Right "Mark all read" text button)
 */
const markAllNotificationsRead = async (req, res) => {
    try {
        // Agar aapke paas Notification model hai toh use update karein:
        // await Notification.updateMany({ recipientId: req.user.id, isRead: false }, { $set: { isRead: true } });
        
        res.json({
            success: true,
            message: "All notifications marked as read successfully"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * GET NEARBY POLICE STATIONS SORTED BY PROXIMITY
 * Figma Link: Screen 29 & 30 (Using Google Distance Matrix in Prod vs Haversine in Dev)
 */
const getNearbyPoliceStations = async (req, res) => {
    try {
        const { lat, lng, search } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ 
                success: false, 
                message: "Case latitude and longitude are required to calculate proximity" 
            });
        }

        const originLat = parseFloat(lat);
        const originLng = parseFloat(lng);

        // Active stations query
        let query = { hqId: req.user.id, isActive: true };
        if (search) {
            query.stationName = { $regex: search, $options: 'i' };
        }

        const stations = await PoliceStation.find(query);

        // Chunki getDistance async hai, isliye Promise.all ka use karenge parallel execution ke liye
        const stationsWithDistance = await Promise.all(
            stations.map(async (station) => {
                const stationLat = station.location?.lat || 0;
                const stationLng = station.location?.lng || 0;

                // Direct asynchronous call to your utility helper
                const distanceKM = await getDistance(originLat, originLng, stationLat, stationLng);

                return {
                    ...station._doc,
                    distance: `${distanceKM} km away` // Figma representation
                };
            })
        );

        // Nearest station ko list me sabse upar rakhne ke liye float sort
        stationsWithDistance.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        res.json({
            success: true,
            data: stationsWithDistance
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 3. GET SPECIFIC ON-HOLD CASES
 * Figma Link: Screen 25 ("On Hold Cases" Tab active view)
 */
const getOnHoldCases = async (req, res) => {
    try {
        const hqId = req.user.id;
        const { search, page = 1, limit = 10 } = req.query;

        let query = { hqId, status: 'On Hold' };

        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { victimName: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const cases = await PoliceCase.find(query)
            .populate('stationId', 'stationName shoName stationCode')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await PoliceCase.countDocuments(query);

        res.json({
            success: true,
            message: "On-Hold cases fetched successfully",
            data: cases,
            pagination: {
                totalRecords: total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * 1. GET STATIC CONTENT (About, Help, or Terms)
 * Figma Link: Screen 31 (List items: About, Help, Terms & Conditions click handler)
 * Access: Publicly readable for all panels
 */
const getPoliceContent = async (req, res) => {
    try {
        const { type } = req.params; // 'about', 'help', or 'terms'
        
        const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();

        let contentData = await PoliceContent.findOne({ contentType: formattedType });

        // 🚨 AUTO-SEEDING: Agar DB me data nahi hai, to automatically default placeholders create kar do
        if (!contentData) {
            contentData = await PoliceContent.create({
                contentType: formattedType,
                title: formattedType === 'Help' ? "Police Support & FAQ" : `Standard ${formattedType} Page`,
                content: formattedType === 'Help' 
                    ? "Welcome to help support. Contact us for any operational guidelines." 
                    : `Please update this default ${formattedType} content from the headquarters panel.`,
                faqs: formattedType === 'Help' ? [
                    { 
                        question: "How to assign or re-assign a case?", 
                        answer: "Navigate to Case Details, choose the station from the dropdown, and tap on Confirm." 
                    }
                ] : [],
                supportContact: {
                    phone: "+91 9876543210", // Figma Screen 21 Phone
                    email: "help@gmail.com"  // Figma Screen 21 Email
                }
            });
        }

        res.json({
            success: true,
            data: contentData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. UPDATE STATIC CONTENT (About, Help, or Terms)
 * Figma Link: Screen 31 (System settings management option)
 * Access: Police HQ Only
 */
const updatePoliceContent = async (req, res) => {
    try {
        const { type } = req.params; // Expects: 'about', 'help', or 'terms'
        const { title, content, faqs, supportContact } = req.body;

        const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();

        // upsert: true automatic model configure (create) kar dega agar DB me data create nahi hua hai
        const updatedContent = await PoliceContent.findOneAndUpdate(
            { contentType: formattedType },
            {
                $set: {
                    title,
                    content,
                    faqs,
                    supportContact,
                    lastUpdatedBy: req.user.id
                }
            },
            { new: true, upsert: true, runValidators: true }
        );

        res.json({
            success: true,
            message: `${formattedType} content updated successfully`,
            data: updatedContent
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
/**
 * 1. GET STATION JURISDICTION
 * HQ kisi bhi ek station ki boundary aur jurisdiction fetch kar sakta hai
 */
const getStationJurisdiction = async (req, res) => {
    try {
        const stationId = req.params.id; // Station ID
 
        // Validate that this station belongs to this HQ
        const station = await PoliceStation.findOne({ _id: stationId, hqId: req.user.id });
       
        if (!station) {
            return res.status(404).json({ success: false, message: "Police Station not found or unauthorized" });
        }
 
        res.json({
            success: true,
            message: "Jurisdiction data fetched successfully",
            data: station.jurisdiction
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
/**
 * 2. UPDATE STATION JURISDICTION
 * HQ boundary limits, area stats aur area map document update kar sakta hai
 */
const updateStationJurisdiction = async (req, res) => {
    try {
        const stationId = req.params.id;
        const {
            zoneName,
            sqKmArea,
            population,
            patrolBeats,
            boundaryNorth,
            boundarySouth,
            boundaryEast,
            boundaryWest
        } = req.body;
 
        // Fetch station
        const station = await PoliceStation.findOne({ _id: stationId, hqId: req.user.id });
        if (!station) {
            return res.status(404).json({ success: false, message: "Police Station not found" });
        }
 
        // Object.assign se deep update karna safe nahi hota isliye nested field by field assign karenge
        if (zoneName) station.jurisdiction.zoneName = zoneName;
        if (sqKmArea) station.jurisdiction.sqKmArea = Number(sqKmArea);
        if (population) station.jurisdiction.population = population;
        if (patrolBeats) station.jurisdiction.patrolBeats = Number(patrolBeats);
 
        if (boundaryNorth) station.jurisdiction.boundaryLimits.north = boundaryNorth;
        if (boundarySouth) station.jurisdiction.boundaryLimits.south = boundarySouth;
        if (boundaryEast) station.jurisdiction.boundaryLimits.east = boundaryEast;
        if (boundaryWest) station.jurisdiction.boundaryLimits.west = boundaryWest;
 
        // Agar area map/pdf document upload hua hai
        if (req.files && req.files.areaDocument) {
            // req.files.areaDocument array hoga, isliye [0] index lena hai
            station.jurisdiction.areaDocumentUrl = `/uploads/police_stations/${req.files.areaDocument[0].filename}`;
        }
 
        await station.save();
 
        res.json({
            success: true,
            message: "Jurisdiction limits updated successfully",
            data: station.jurisdiction
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
 
 
module.exports = {
    getHQDashboard,
    createStation,
    listMyStations,
    updateStation,
    deleteStation,
    getFilteredCases,
    getHQProfile,
    updateHQProfile,
    changePasswordHQ,
    getNotifications,
    deleteNotification,
    createCase,
    updateCase,
    deleteCase,
    assignCase,getHQCaseHistory,getPendingCases,
    getClosedCases,
    getArchivedCases,

    updateCaseStatus,
    addEvidenceHQ,sendSupportRequest,
    closeCaseHQ,
    reassignCaseHQ,
    getCaseSummary,
    updateLegalProgress,

    markAllNotificationsRead,
    getNearbyPoliceStations,
    getOnHoldCases,

    getPoliceContent,
    updatePoliceContent,

    getStationJurisdiction,
    updateStationJurisdiction
 
};
 