const PoliceStaff = require('../../../models/PoliceStaff');
const PoliceCase = require('../../../models/PoliceCase');
const LeaveRequest = require('../../../models/LeaveRequest');
const bcrypt = require('bcryptjs');
const moment = require('moment'); // Required for "Running: X Days" logic
 
// --- DASHBOARD (Screen 1) ---
const getStaffDashboard = async (req, res) => {
    try {
        const staffId = req.user.id;
        const stats = {
            fresh: await PoliceCase.countDocuments({ assignedStaff: staffId, status: 'Fresh' }),
            pending: await PoliceCase.countDocuments({ assignedStaff: staffId, status: 'Under Investigation' }),
            closed: await PoliceCase.countDocuments({ assignedStaff: staffId, status: 'Closed' })
        };
 
        res.json({
            success: true,
            data: {
                officerName: req.user.fullName,
                badgeId: req.user.badgeId,
                profileImage: req.user.profileImage,
                stats
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- CASE MANAGEMENT (Screens 10, 12, 19) ---
 
const getAssignedCases = async (req, res) => {
    try {
        const { priority, search, status } = req.query;
        let query = { assignedStaff: req.user.id };
 
        if (status) query.status = status;
        if (priority && priority !== 'All') query.severity = priority;
        if (search) query.caseNo = new RegExp(search, 'i');
 
        const cases = await PoliceCase.find(query).sort({ createdAt: -1 });
 
        // Transform for "Running: X Days" as seen in Image 19
        const formattedCases = cases.map(c => {
            const start = moment(c.updatedAt); // Assuming investigation starts on last update/accept
            const now = moment();
            return {
                ...c._doc,
                runningDays: now.diff(start, 'days') || 0
            };
        });
 
        res.json({ success: true, data: formattedCases });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Accept Case (Image 12)
const acceptCase = async (req, res) => {
    try {
        const updatedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            { status: 'Under Investigation', 'progress.isAccepted': true },
            { new: true }
        );
        res.json({ success: true, message: "Case Accepted", data: updatedCase });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Update Progress Dots (Image 19)
const updateProgressStep = async (req, res) => {
    try {
        const { step } = req.body; // 'isSiteVisited', 'isReportSubmitted'
        const update = {};
        update[`progress.${step}`] = true;
 
        const updatedCase = await PoliceCase.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json({ success: true, message: "Progress Updated", data: updatedCase });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Add Evidence / Attach Document (Image 7)
const uploadEvidence = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
 
        const pcase = await PoliceCase.findById(req.params.id);
        const newEvidence = {
            fileName: req.file.originalname,
            fileUrl: `/uploads/police_staff/${req.file.filename}`,
            fileType: req.file.mimetype.split('/')[1],
            uploadedAt: Date.now()
        };
 
        pcase.evidence.push(newEvidence);
        pcase.progress.isEvidenceCollected = true;
        await pcase.save();
 
        res.json({ success: true, message: "Document Attached Successfully", data: pcase });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const closeCase = async (req, res) => {
    try {
        const closedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            { status: 'Closed', 'progress.isReportSubmitted': true },
            { new: true }
        );
        res.json({ success: true, message: "Case Closed Successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- OFFICER PROFILE (Screen 26) ---
const getDetailedProfile = async (req, res) => {
    try {
        const staffId = req.user.id;
        const staff = await PoliceStaff.findById(staffId).populate('stationId');
 
        const activeCases = await PoliceCase.countDocuments({ assignedStaff: staffId, status: 'Under Investigation' });
        
        // Fetch last activities for "Recent Activity" list
        const activity = await PoliceCase.find({ assignedStaff: staffId })
            .sort({ updatedAt: -1 })
            .limit(5);
 
        res.json({
            success: true,
            data: {
                fullName: staff.fullName,
                rank: staff.rank,
                badgeId: staff.badgeId,
                stationName: staff.stationId.stationName,
                joiningDate: staff.createdAt,
                stats: {
                    activeCases,
                    attendance: "96%", // Mocked as per Figma
                },
                recentActivity: activity
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- PROFILE SETTINGS (Screens 8, 9) ---
 
const updateProfile = async (req, res) => {
    try {
        const updates = req.body;
        if (req.file) updates.profileImage = `/uploads/police_staff/${req.file.filename}`;
 
        const updated = await PoliceStaff.findByIdAndUpdate(req.user.id, updates, { new: true });
        res.json({ success: true, message: "Profile Updated Successfully", data: updated });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const staff = await PoliceStaff.findById(req.user.id).select('+password');
        
        const isMatch = await bcrypt.compare(oldPassword, staff.password);
        if (!isMatch) return res.status(400).json({ message: "Current password is wrong" });
 
        staff.password = await bcrypt.hash(newPassword, 10);
        await staff.save();
        res.json({ success: true, message: "Password Changed" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- LEAVE REQUEST (Screens 5, 6) ---
const submitLeave = async (req, res) => {
    try {
        const { leaveType, duration, startDate, endDate, reason } = req.body;
        const leave = await LeaveRequest.create({
            stationId: req.user.stationId,
            staffId: req.user.id,
            leaveType, duration, startDate, endDate, reason
        });
        res.status(201).json({ success: true, message: "Leave Request Submitted", data: leave });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
module.exports = {
    getStaffDashboard,
    getAssignedCases,
    acceptCase,
    updateProgressStep,
    uploadEvidence,
    closeCase,
    getDetailedProfile,
    updateProfile,
    changePassword,
    submitLeave
};