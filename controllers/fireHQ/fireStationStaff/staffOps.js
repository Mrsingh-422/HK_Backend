const FireAttendance = require('../../../models/FireAttendance');
const FireLeave = require('../../../models/FireLeave');
const FireCase = require('../../../models/FireCase');
const FireStaff = require('../../../models/FireStaff');
const FireStation = require('../../../models/FireStation');

// 1. SHIFT CHECK-IN (Figma Screen 13)
const checkIn = async (req, res) => {
    try {
        // Prevent double check-in
        const existing = await FireAttendance.findOne({ staffId: req.user.id, checkOut: { $exists: false } });
        if (existing) return res.status(400).json({ message: "Already checked in for this shift." });

        const attendance = await FireAttendance.create({
            staffId: req.user.id,
            stationId: req.user.stationId,
            shift: req.body.shift || 'Day',
            location: req.body.location,
            status: 'Present'
        });
        res.json({ success: true, message: "Shift Started Successfully", data: attendance });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// NEW: SHIFT CHECK-OUT (To complete the flow)
const checkOut = async (req, res) => {
    try {
        const attendance = await FireAttendance.findOneAndUpdate(
            { staffId: req.user.id, checkOut: { $exists: false } },
            { checkOut: Date.now() },
            { new: true, sort: { createdAt: -1 } }
        );
        if (!attendance) return res.status(404).json({ message: "No active shift found." });
        res.json({ success: true, message: "Shift Ended Successfully", data: attendance });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. APPLY FOR LEAVE (Figma Screen 84 & 54 Logic)
const applyForLeave = async (req, res) => {
    try {
        const { leaveType, fromDate, toDate, reason } = req.body;
        
        // ADDON: Emergency Override Check (Figma Screen 54)
        const station = await FireStation.findById(req.user.stationId);
        if (station?.isEmergencyModeActive && leaveType !== 'Sick Leave') {
            return res.status(403).json({ 
                success: false, 
                message: "Emergency Override is active. Only Sick Leave can be applied currently." 
            });
        }

        const leaveRequest = await FireLeave.create({
            staffId: req.user.id,
            stationId: req.user.stationId,
            leaveType, fromDate, toDate, reason,
            attachment: req.file ? req.file.path : null, // Screen 4 Certificate
            status: 'Pending'
        });
        res.status(201).json({ success: true, message: "Leave Request Submitted", data: leaveRequest });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. GET MY ASSIGNED CASES (Refined Query)
const getMyAssignedCases = async (req, res) => {
    try {
        // Logic: Sirf wo cases jahan ye firefighter "assignedStaff" array mein hai
        const cases = await FireCase.find({ 
            assignedStaff: req.user.id, 
            status: { $in: ['Pending', 'Under Control', 'Critical'] } 
        }).sort({ reportedAt: -1 });
        
        res.json({ success: true, count: cases.length, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. STAFF PROFILE DETAILS (Figma Screen 93)
const getStaffProfileDetails = async (req, res) => {
    try {
        const staff = await FireStaff.findById(req.user.id).populate('stationId', 'stationName');
        if (!staff) return res.status(404).json({ message: "Staff not found" });

        // Calculate dynamic stats (Example logic)
        const totalCases = await FireCase.countDocuments({ assignedStaff: req.user.id });

        res.json({
            success: true,
            data: {
                profile: staff,
                stats: {
                    casesAssigned: `${totalCases} Cases`, // Screen 93
                    attendance: staff.attendancePercentage + "%" || "96%", // Screen 93
                    joiningDate: staff.joiningDate || "14 Aug 2018",
                    station: staff.stationId?.stationName || "N/A"
                },
                recentActivity: [
                    { title: "Shift Check-in", time: "Today, 07:55 AM" },
                    { title: "Patrol: Sector 4", time: "Yesterday, 04:15 PM" }
                ]
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. LEAVE CATEGORIES (Screen 84)
const getLeaveCategories = (req, res) => {
    res.json({
        success: true,
        data: [
            { title: "Sick Leave", desc: "Medical emergency & health issues" },
            { title: "Casual Leave (CL)", desc: "Personal matters & Short breaks" },
            { title: "Earned Leave (EL)", desc: "Planned long-term absence" },
            { title: "Emergency Leave", desc: "Critical family situation" },
            { title: "Duty Leave", desc: "Official work outside station" },
            { title: "Paternity Leave", desc: "For new fathers" }
        ]
    });
};

// NEW: General Work Request (Screen 15 - Tabs: Present, Shift Change, Overtime)
const submitWorkRequest = async (req, res) => {
    try {
        const { requestType, fromDate, toDate, reason, additionalDetails } = req.body;
        // requestType enum: ['Present', 'Shift Change', 'Overtime', 'Leave']

        const request = await FireLeave.create({ // Model name Leave hai par ye sab handle karega
            staffId: req.user.id,
            stationId: req.user.stationId,
            leaveType: requestType, // Yahan request type save hoga
            fromDate, toDate, reason,
            shiftImpact: additionalDetails, // e.g. "Want Shift B instead of A"
            status: 'Pending'
        });

        res.status(201).json({ success: true, message: `${requestType} request submitted`, data: request });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// NEW: Field status update (Figma Screen 100 - Update Status button)
const updateIncidentProgress = async (req, res) => {
    try {
        const { caseId, statusLabel, remarks } = req.body;
        // statusLabel: 'Fire Contained', 'Cooling Process', 'Under Control'

        const updatedCase = await FireCase.findByIdAndUpdate(
            caseId,
            { 
                severityStatus: statusLabel, // Model ki field
                remarks: remarks 
            },
            { new: true }
        );

        res.json({ success: true, message: "Status updated to: " + statusLabel, data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const getStaffNotifications = async (req, res) => {
    try {
        const notifications = await FireNotification.find({ 
            $or: [{ staffId: req.user.id }, { stationId: req.user.stationId }] 
        }).sort({ createdAt: -1 });

        res.json({ success: true, data: notifications });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
module.exports = { 
    checkIn, 
    checkOut, // Added
    applyForLeave, 
    getMyAssignedCases, 
    getStaffProfileDetails, 
    getLeaveCategories ,
    submitWorkRequest, // Added
    updateIncidentProgress, // Added
    getStaffNotifications // Added
};