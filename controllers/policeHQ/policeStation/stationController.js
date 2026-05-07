const PoliceStation = require('../../../models/PoliceStation');
const PoliceStaff = require('../../../models/PoliceStaff');
const PoliceCase = require('../../../models/PoliceCase');
const LeaveRequest = require('../../../models/LeaveRequest');
const bcrypt = require('bcryptjs');
 
// --- 1. DASHBOARD (Screen 1) ---
const getStationDashboard = async (req, res) => {
    try {
        const stationId = req.user.id;
        const stats = {
            fresh: await PoliceCase.countDocuments({ stationId, status: 'Fresh' }),
            pending: await PoliceCase.countDocuments({ stationId, status: 'Under Investigation' }),
            closed: await PoliceCase.countDocuments({ stationId, status: 'Closed' })
        };
 
        res.json({
            success: true,
            data: {
                welcomeName: req.user.shoName,
                profilePic: req.user.profileImage,
                stats
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- 2. STAFF MANAGEMENT (Screens 13, 14, 15, 16) ---
 
const addStaff = async (req, res) => {
    try {
        const { fullName, badgeId, rank, mobileNumber, officialEmail, address, password } = req.body;
        const exists = await PoliceStaff.findOne({ $or: [{ badgeId }, { officialEmail }] });
        if (exists) return res.status(400).json({ message: "Staff with this Badge ID or Email already exists" });
 
        const hashedPassword = await bcrypt.hash(password, 10);
        const staff = await PoliceStaff.create({
            stationId: req.user.id,
            hqId: req.user.hqId,
            fullName, badgeId, rank, mobileNumber, officialEmail, address,
            password: hashedPassword,
            profileImage: req.file ? `/uploads/police_staff/${req.file.filename}` : null
        });
 
        res.status(201).json({ success: true, message: "Staff Added Successfully", data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const updateStaff = async (req, res) => {
    try {
        const updates = req.body;
        if (req.file) updates.profileImage = `/uploads/police_staff/${req.file.filename}`;
        
        const staff = await PoliceStaff.findByIdAndUpdate(req.params.id, updates, { new: true });
        res.json({ success: true, message: "Staff updated", data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const removeStaff = async (req, res) => {
    try {
        const { reason, otherReason } = req.body; // From Screen 16
        const staff = await PoliceStaff.findByIdAndUpdate(req.params.id, {
            isActive: false,
            status: 'Inactive',
            deletionReason: reason === 'Other reason' ? otherReason : reason
        });
        res.json({ success: true, message: "Staff removed from active list" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// // Get Staff for Assignment Selection (Screen 24 & 25)
// const getStaffList = async (req, res) => {
//     try {
//         const { search } = req.query;
//         let query = { stationId: req.user.id, isActive: true };
        
//         if (search) {
//             query.$or = [
//                 { fullName: { $regex: search, $options: 'i' } },
//                 { badgeId: { $regex: search, $options: 'i' } }
//             ];
//         }
 
//         const staff = await PoliceStaff.find(query);
//         res.json({ success: true, data: staff });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };
 
const getStaffList = async (req, res) => {
    try {
        const staff = await PoliceStaff.find({ stationId: req.user.id});
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// --- 3. CASE MANAGEMENT (Screens 4, 11, 24, 25) ---
 
const getStationCases = async (req, res) => {
    try {
        const { status, priority, search } = req.query;
        let query = { stationId: req.user.id };
 
        if (status) query.status = status;
        if (priority && priority !== 'All') query.severity = priority;
        if (search) query.caseNo = { $regex: search, $options: 'i' };
 
        const cases = await PoliceCase.find(query)
            .populate('assignedStaff')
            .sort({ createdAt: -1 });
 
        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const acceptCase = async (req, res) => {
    try {
        const updatedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            { status: 'Accepted', 'progress.isAccepted': true },
            { new: true }
        );
        res.json({ success: true, message: "Case Accepted", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// Assign/Re-assign Staff (Screen 24/25/26)
const assignStaffToCase = async (req, res) => {
    try {
        const { caseId, staffIds } = req.body; // Array of IDs for supporting staff
        
        // We update the primary officer (index 0) and supporting staff
        const updatedCase = await PoliceCase.findByIdAndUpdate(caseId, {
            assignedStaff: staffIds[0], // Lead Officer
            supportingStaff: staffIds.slice(1), // Array of other officers
            status: 'Under Investigation'
        }, { new: true });
 
        res.json({ success: true, message: "Staff Assigned to Case", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const updateCaseProgress = async (req, res) => {
    try {
        const { step } = req.body; // e.g., 'isSiteVisited'
        const update = { status: 'Under Investigation' };
        update[`progress.${step}`] = true;
 
        const pCase = await PoliceCase.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json({ success: true, data: pCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const closeCase = async (req, res) => {
    try {
        const pCase = await PoliceCase.findByIdAndUpdate(req.params.id, {
            status: 'Closed',
            closedAt: Date.now()
        }, { new: true });
        res.json({ success: true, message: "Case Closed Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// --- 4. ROSTER & LEAVE (Screens 2, 7, 8, 9, 10) ---
 
const getStaffRoster = async (req, res) => {
    try {
        const staff = await PoliceStaff.find({ stationId: req.user.id });
        res.json({
            success: true,
            data: {
                onDuty: staff.filter(s => s.status === 'On Duty'),
                onLeave: staff.filter(s => s.status === 'On Leave'),
                offDuty: staff.filter(s => s.status === 'Off Duty'),
                counts: {
                    onDuty: staff.filter(s => s.status === 'On Duty').length,
                    onLeave: staff.filter(s => s.status === 'On Leave').length,
                    weeklyOff: staff.filter(s => s.status === 'Off Duty').length
                }
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const manageLeaveRequest = async (req, res) => {
    try {
        const { status, rejectionReason } = req.body;
        const leave = await LeaveRequest.findById(req.params.id);
        if (!leave) return res.status(404).json({ message: "Request not found" });
 
        leave.status = status;
        if (status === 'Rejected') leave.rejectionReason = rejectionReason;
        await leave.save();
 
        // Update Staff Status automatically
        if (status === 'Approved') {
            await PoliceStaff.findByIdAndUpdate(leave.staffId, { status: 'On Leave' });
        }
 
        res.json({ success: true, message: `Leave ${status} successfully` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// --- 5. PROFILE & JURISDICTION (Screens 17, 18, 19, 21) ---
 
const getStationProfile = async (req, res) => {
    try {
        const station = await PoliceStation.findById(req.user.id);
        const activeStaff = await PoliceStaff.countDocuments({ stationId: req.user.id, isActive: true });
        
        res.json({
            success: true,
            data: { ...station._doc, activeStaffCount: activeStaff }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const updateStationProfile = async (req, res) => {
    try {
        const updates = req.body;
        if (req.file) updates.profileImage = `/uploads/police_stations/${req.file.filename}`;
        
        const station = await PoliceStation.findByIdAndUpdate(req.user.id, updates, { new: true });
        res.json({ success: true, message: "Profile Updated", data: station });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
module.exports = {
    getStationDashboard,
    addStaff,
    updateStaff,
    getStaffList,
    removeStaff,
    getStationCases,
    acceptCase,
    assignStaffToCase,
    updateCaseProgress,
    closeCase,
    getStaffRoster,
    manageLeaveRequest,
    getStationProfile,
    updateStationProfile
};
 