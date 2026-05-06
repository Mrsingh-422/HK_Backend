const FireAttendance = require('../../../models/FireAttendance');
const FireLeave = require('../../../models/FireLeave');
const FireCase = require('../../../models/FireCase');
const FireStaff = require('../../../models/FireStaff');
const FireStation = require('../../../models/FireStation');

// 1. SHIFT CHECK-IN (Syncs with Staff Status)
const checkIn = async (req, res) => {
    try {
        const staffId = req.user.id;
        const { shift, location } = req.body;

        const activeShift = await FireAttendance.findOne({ staffId, checkOut: { $exists: false } });
        if (activeShift) return res.status(400).json({ message: "Already on an active shift." });

        const attendance = await FireAttendance.create({
            staffId,
            stationId: req.user.stationId,
            shift: shift || 'Day',
            location,
            status: 'Present',
            checkIn: Date.now() // Explicitly set check-in time
        });

        // Sync: Update Staff status
        await FireStaff.findByIdAndUpdate(staffId, { status: 'Active' });

        // Format time for UI (e.g., "07:55 AM")
        const formattedTime = new Date(attendance.checkIn).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
        });

        res.json({ 
            success: true, 
            message: "Shift Started at " + formattedTime, 
            checkInTime: formattedTime, // 🚀 Flutter UI key
            data: attendance 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. SHIFT CHECK-OUT (With Formatted Time)
const checkOut = async (req, res) => {
    try {
        const currentTime = Date.now();
        const attendance = await FireAttendance.findOneAndUpdate(
            { staffId: req.user.id, checkOut: { $exists: false } },
            { checkOut: currentTime },
            { new: true, sort: { createdAt: -1 } }
        );

        if (!attendance) return res.status(404).json({ message: "No active shift found to end." });

        // Sync: Update Staff status
        await FireStaff.findByIdAndUpdate(req.user.id, { status: 'Inactive' });

        const formattedTime = new Date(currentTime).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
        });

        res.json({ 
            success: true, 
            message: "Shift Ended at " + formattedTime, 
            checkOutTime: formattedTime, // 🚀 Flutter UI key
            data: attendance 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. APPLY FOR LEAVE (Enum Matched & Emergency Check)
const applyForLeave = async (req, res) => {
    try {
        const { leaveType, fromDate, toDate, reason } = req.body;
        
        // Allowed Enums as per your schema
        const allowed = ['Sick', 'Casual', 'Earned', 'Emergency'];
        if(!allowed.includes(leaveType)) return res.status(400).json({ message: "Invalid Leave Type" });

        // Emergency Override Check (Station side control)
        const station = await FireStation.findById(req.user.stationId);
        if (station?.isEmergencyModeActive && leaveType !== 'Sick') {
            return res.status(403).json({ message: "EMERGENCY ACTIVE: Only Sick leave allowed." });
        }

        const leave = await FireLeave.create({
            staffId: req.user.id,
            stationId: req.user.stationId,
            leaveType, fromDate, toDate, reason,
            attachment: req.file ? req.file.path : null,
            status: 'Pending'
        });

        res.status(201).json({ success: true, message: "Leave applied. Pending Station Approval.", data: leave });
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

        const today = new Date();

        // 1. Automatic Leave Check: Kya aaj staff approved leave par hai?
        const activeLeave = await FireLeave.findOne({
            staffId: req.user.id,
            status: 'Approved',
            fromDate: { $lte: today }, // Start date aaj ya aaj se pehle ho
            toDate: { $gte: today }    // End date aaj ya aaj ke baad ho
        });

        // 2. Determine Dynamic Status
        let dynamicStatus = "Off Duty"; 
        if (activeLeave) {
            dynamicStatus = "On Leave"; // Agar aaj chutti hai
        } else if (staff.status === 'Active') {
            dynamicStatus = "On Duty"; // Agar staff ne check-in kiya hua hai
        }

        // 3. Fetch latest attendance to show last check-in time
        const lastAttendance = await FireAttendance.findOne({ staffId: req.user.id }).sort({ createdAt: -1 });
        let lastCheckIn = "Not Checked-In";
        
        if(lastAttendance) {
            lastCheckIn = new Date(lastAttendance.checkIn).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true 
            });
        }

        // 4. Count total cases assigned to this staff
        const totalCases = await FireCase.countDocuments({ assignedStaff: req.user.id });

        res.json({
            success: true,
            data: {
                profile: staff,
                currentStatus: dynamicStatus, // 🚀 NEW: Automatic status (On Duty / Off Duty / On Leave)
                stats: {
                    casesAssigned: `${totalCases} Cases`,
                    attendance: (staff.attendancePercentage || 0) + "%",
                    lastCheckIn: lastCheckIn, 
                    station: staff.stationId?.stationName || "N/A"
                },
                // Optional: Agar leave par hai toh detail bhi bhej sakte hain
                activeLeaveInfo: activeLeave ? {
                    type: activeLeave.leaveType,
                    until: activeLeave.toDate
                } : null
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 5. LEAVE CATEGORIES (Screen 84)
const getLeaveCategories = (req, res) => {
    res.json({
        success: true,
        data: [
            { title: "Sick", display: "Sick Leave (Medical)" },
            { title: "Casual", display: "Casual Leave (Short Break)" },
            { title: "Earned", display: "Earned Leave (Planned)" },
            { title: "Emergency", display: "Emergency Leave (Critical)" }
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