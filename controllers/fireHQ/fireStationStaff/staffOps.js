const FireAttendance = require('../../../models/FireAttendance');
const FireLeave = require('../../../models/FireLeave');
const FireCase = require('../../../models/FireCase');

// 1. SHIFT CHECK-IN (Figma Screen 13)
const checkIn = async (req, res) => {
    try {
        const attendance = await FireAttendance.create({
            staffId: req.user.id,
            stationId: req.user.stationId,
            shift: req.body.shift, // Day/Night
            location: req.body.location
        });
        res.json({ success: true, message: "Checked-in Successfully", data: attendance });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. APPLY FOR LEAVE (Figma Screen 15 & 16)
const applyForLeave = async (req, res) => {
    try {
        const { leaveType, fromDate, toDate, reason } = req.body;
        
        const leaveRequest = await FireLeave.create({
            staffId: req.user.id,
            stationId: req.user.stationId,
            leaveType,
            fromDate,
            toDate,
            reason,
            attachment: req.file ? req.file.path : null, // Medical certificate upload
            status: 'Pending'
        });
        res.status(201).json({ success: true, message: "Leave Request Submitted", data: leaveRequest });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. GET MY ACTIVE CASES (Firefighter's assigned incidents)
const getMyAssignedCases = async (req, res) => {
    try {
        // Maan lijiye station ne firefighter ko assign kiya hai (logic in next step)
        const cases = await FireCase.find({ 
            stationId: req.user.stationId, 
            status: 'Pending' 
        }).sort({ reportedAt: -1 });
        
        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getStaffProfileDetails = async (req, res) => {
    try {
        const staff = await FireStaff.findById(req.user.id).populate('stationId');
        res.json({
            success: true,
            data: {
                profile: staff,
                stats: {
                    casesAssigned: "12 Active",
                    attendance: "96%",
                    joiningDate: staff.joiningDate || "14 Aug 2018",
                    station: staff.stationId.stationName
                },
                recentActivity: [
                    { title: "Filled FIR #2024-892", time: "Today, 10:30 AM" },
                    { title: "Shift Check-in", time: "Today, 07:55 AM" }
                ]
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// UPDATED: Apply Leave with all categories (Screen 84)
const getLeaveCategories = (req, res) => {
    res.json({
        success: true,
        categories: [
            "Sick Leave", "Casual Leave (CL)", "Earned Leave (EL)", 
            "Emergency Leave", "Duty Leave", "Paternity Leave"
        ]
    });
};

module.exports = { checkIn, applyForLeave, getMyAssignedCases, getStaffProfileDetails, getLeaveCategories };