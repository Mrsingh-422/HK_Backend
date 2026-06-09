const PoliceStation = require('../../models/PoliceStation');
const PoliceCase = require('../../models/PoliceCase');
const PoliceHQ = require('../../models/PoliceHQ');
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
 * Status: 'Pending', 'Under Investigation', 'Critical'
 */
const getPendingCases = async (req, res) => {
    try {
        const hqId = req.user.id;
        const { search, page = 1, limit = 10 } = req.query;
 
        // Fetching all active cases that are not fresh and not closed
        let query = {
            hqId,
            status: { $in: ['Pending', 'Under Investigation', 'Critical'] }
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
 
};
 