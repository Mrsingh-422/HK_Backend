const FireAttendance = require('../../../models/FireAttendance');
const FireLeave = require('../../../models/FireLeave');
const FireCase = require('../../../models/FireCase');
const FireStaff = require('../../../models/FireStaff');
const FireStation = require('../../../models/FireStation');
const FireNotification = require('../../../models/FireNotification');






// 1. SHIFT CHECK-IN (With Status Sync & Leave-Day Warning)
const checkIn = async (req, res) => {
    try {
        const staffId = req.user.id;
        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        const activeToday = await FireAttendance.findOne({ 
            staffId, 
            checkOut: { $exists: false },
            createdAt: { $gte: startOfToday }
        });

        if (activeToday) {
            return res.status(400).json({ success: false, message: "Already checked in for today's shift." });
        }

        await FireAttendance.updateMany(
            { staffId, checkOut: { $exists: false }, createdAt: { $lt: startOfToday } },
            { $set: { checkOut: startOfToday } }
        );

        // Check if today is an approved leave day
        const onLeaveToday = await FireLeave.findOne({
            staffId,
            status: 'Approved',
            fromDate: { $lte: today },
            toDate: { $gte: today }
        });

        const attendance = await FireAttendance.create({
            staffId,
            stationId: req.user.stationId,
            shift: req.body.shift || 'Day',
            location: req.body.location,
            status: 'Present'
        });

        await FireStaff.findByIdAndUpdate(staffId, { status: 'Active' });

        const formattedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

        res.json({ 
            success: true, 
            message: onLeaveToday ? "Check-in successful (Working on Leave Day)" : "Shift Started",
            checkInTime: formattedTime,
            isOnLeaveDay: !!onLeaveToday,
            data: attendance
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 2. SHIFT CHECK-OUT (With Status Sync)
const checkOut = async (req, res) => {
    try {
        const attendance = await FireAttendance.findOneAndUpdate(
            { staffId: req.user.id, checkOut: { $exists: false } },
            { checkOut: Date.now() },
            { new: true, sort: { createdAt: -1 } }
        );
        if (!attendance) return res.status(404).json({ message: "No active shift found." });

        // SYNC: Change staff status back to Inactive
        await FireStaff.findByIdAndUpdate(req.user.id, { status: 'Inactive' });

        const formattedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        res.json({ success: true, message: "Shift Ended", checkOutTime: formattedTime });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. APPLY FOR LEAVE (With Date Overlap Check & Full Enums)
const applyForLeave = async (req, res) => {
    try {
        const { leaveType, fromDate, toDate, reason } = req.body;
        const staffId = req.user.id;

        // A. Enum Match (Updated with all 6 types)
        const allowed = ['Sick', 'Casual', 'Earned', 'Emergency', 'Duty', 'Paternity'];
        if(!allowed.includes(leaveType)) return res.status(400).json({ message: "Invalid Leave Type" });

        // B. Date Overlap Check (Pehle se us date par koi leave toh nahi?)
        const overlap = await FireLeave.findOne({
            staffId,
            status: { $in: ['Pending', 'Approved'] },
            $or: [
                { fromDate: { $lte: new Date(toDate) }, toDate: { $gte: new Date(fromDate) } }
            ]
        });
        if (overlap) return res.status(400).json({ message: "You already have a leave request for these dates." });

        // C. Emergency Override Check
        const station = await FireStation.findById(req.user.stationId);
        if (station?.isEmergencyModeActive && leaveType !== 'Sick') {
            return res.status(403).json({ message: "Emergency Override active. Only Sick Leave allowed." });
        }

        const leave = await FireLeave.create({
            staffId,
            stationId: req.user.stationId,
            leaveType, fromDate, toDate, reason,
            attachment: req.file ? req.file.path : null,
            status: 'Pending'
        });

        res.status(201).json({ success: true, message: "Leave applied. Pending approval.", data: leave });
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

// 4. STAFF PROFILE DETAILS (Full Dynamic Status & Real-time Stats)
const getStaffProfileDetails = async (req, res) => {
    try {
        const staff = await FireStaff.findById(req.user.id).populate('stationId');
        if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

        const today = new Date();
        const station = staff.stationId;

        const activeLeave = await FireLeave.findOne({
            staffId: req.user.id,
            status: 'Approved',
            fromDate: { $lte: today },
            toDate: { $gte: today }
        });

        let dynamicStatus = "Off Duty"; 
        if (activeLeave) dynamicStatus = "On Leave";
        else if (staff.status === 'Active') dynamicStatus = "On Duty";

        const lastAtt = await FireAttendance.findOne({ staffId: req.user.id }).sort({ createdAt: -1 });
        const lastCheckIn = lastAtt ? new Date(lastAtt.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : "Not Checked-In";

        const totalCases = await FireCase.countDocuments({ assignedStaff: req.user.id });

        let shiftTimingLabel = "08:00 - 16:00";
        if (station?.shiftTimings) {
            if (staff.currentShift === 'Shift B' || staff.currentShift === 'Night') {
                const start = station.shiftTimings.shiftB?.start || "16:00";
                const end = station.shiftTimings.shiftB?.end || "00:00";
                shiftTimingLabel = `${start} - ${end}`;
            } else {
                const start = station.shiftTimings.shiftA?.start || "08:00";
                const end = station.shiftTimings.shiftA?.end || "16:00";
                shiftTimingLabel = `${start} - ${end}`;
            }
        }

        res.json({
            success: true,
            data: {
                profile: staff,
                currentStatus: dynamicStatus, 
                stats: {
                    casesAssigned: `${totalCases} Cases`,
                    attendance: (staff.attendancePercentage || 96) + "%",
                    lastCheckIn: lastCheckIn,
                    station: station?.stationName || "N/A"
                },
                activeShift: {
                    name: staff.currentShift || "Shift A",
                    timing: shiftTimingLabel,
                    displayLabel: `Station Duty - ${shiftTimingLabel}`
                }
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 5. LEAVE CATEGORIES (Screen 84)
const getLeaveCategories = (req, res) => {
    try {
        // 🚀 Mongoose Schema se 'leaveType' ke saare Enums nikalna
        const leaveEnums = FireLeave.schema.path('leaveType').enumValues;

        // Flutter UI ke liye thoda format karke bhejna (Optional formatting)
        const categories = leaveEnums.map(type => ({
            title: type,          // Backend key (e.g. "Sick")
            display: `${type} Leave` // UI label (e.g. "Sick Leave")
        }));

        res.json({
            success: true,
            count: leaveEnums.length,
            data: categories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
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





// 1. DASHBOARD STATS (Figma: Dashboard Screen)
const getStaffDashboard = async (req, res) => {
    try {
        const stationId = req.user.stationId; // User model se
        
        const stats = {
            newFireAlerts: await FireCase.countDocuments({ stationId, status: 'Fresh' }),
            ongoingOperations: await FireCase.countDocuments({ 
                stationId, 
                status: { $in: ['Pending', 'Under Control', 'Critical'] } 
            }),
            resolvedIncidents: await FireCase.countDocuments({ stationId, status: 'Closed' })
        };

        res.json({ success: true, data: stats });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. FRESH CASES LIST (Figma Screen: Fresh Cases)
const getFreshCases = async (req, res) => {
    try {
        const { filter, search } = req.query; 
        let query = { stationId: req.user.stationId, status: 'Fresh' };

        if (filter === 'High Priority') query.severity = 'High';
        
        // Figma Search logic
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        const cases = await FireCase.find(query).sort({ reportedAt: -1 });
        res.json({ success: true, count: cases.length, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 3. INCIDENT DETAILS (Figma Screen: Incident Details)
const getCaseDetails = async (req, res) => {
    try {
        const incident = await FireCase.findById(req.params.id)
            .populate('assignedStaff', 'fullName rank')
            .populate('assignedVehicles', 'vehicleName assetId');

        if (!incident) return res.status(404).json({ message: "Incident not found" });

        // Figma mapping: Caller details and description
        res.json({ success: true, data: incident });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. INCIDENT HISTORY (Figma Screen: Incident History)
const getIncidentHistory = async (req, res) => {
    try {
        const { search, timeframe } = req.query; 
        let query = { stationId: req.user.stationId, status: 'Closed' };

        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        // Figma Filter: This Month / Last Month
        if (timeframe === 'This Month') {
            const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            query.resolvedAt = { $gte: startOfMonth };
        } else if (timeframe === 'Last Month') {
            const startOfLastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
            const endOfLastMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
            query.resolvedAt = { $gte: startOfLastMonth, $lte: endOfLastMonth };
        }

        const history = await FireCase.find(query).sort({ resolvedAt: -1 });
        res.json({ success: true, count: history.length, data: history });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const markAllNotificationsRead = async (req, res) => {
    try {
        await FireNotification.updateMany(
            { $or: [{ staffId: req.user.id }, { stationId: req.user.stationId }], isRead: false },
            { isRead: true }
        );
        res.json({ success: true, message: "All notifications marked as read" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. ACCEPT CASE (Figma Button: "Accept Case")
const acceptCase = async (req, res) => {
    try {
        const updated = await FireCase.findByIdAndUpdate(
            req.params.id,
            { 
                $addToSet: { assignedStaff: req.user.id }, // Staff khud ko assign kar raha hai
                status: 'Pending' 
            },
            { new: true }
        );
        res.json({ success: true, message: "Case Accepted", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. ADD SUPPORTING STATION (Figma Button at bottom of Details)
const requestBackup = async (req, res) => {
    try {
        const { caseId, reason } = req.body; // Params ki jagah body se lena better hai

        const updatedCase = await FireCase.findByIdAndUpdate(
            caseId,
            { 
                backupRequested: true,
                backupReason: reason,
                $push: { remarks: `BACKUP REQUESTED BY ${req.user.fullName}` }
            },
            { new: true }
        );

        res.json({ success: true, message: "Backup request sent to HQ", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 1. GET ACCEPTED/ONGOING CASES (Staff Perspective - Figma Screen 100/101)
// Ye wo cases hain jahan staff member currently assigned hai aur kaam chal raha hai
const getAcceptedCases = async (req, res) => {
    try {
        const { search, type } = req.query; // type: 'All', 'Under Control', 'Critical'
        
        let query = { 
            assignedStaff: req.user.id, 
            status: { $in: ['Pending', 'Under Control', 'Critical'] } 
        };

        // Figma Tabs Filter
        if (type && type !== 'All') {
            query.status = type;
        }

        // Figma Search Filter
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        const cases = await FireCase.find(query)
            .sort({ dispatchedAt: -1 })
            .populate('assignedStaff', 'fullName rank')
            .populate('assignedVehicles', 'vehicleName assetId');

        res.json({
            success: true,
            count: cases.length,
            data: cases.map(c => ({
                ...c._doc,
                // UI Friendly Labels for Figma
                timeActive: "2 hours ago", 
                severityLabel: c.status === 'Critical' ? 'Fire Spreading' : 'Fire Contained - Cooling Process'
            }))
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 2. GET INCIDENT HISTORY (Figma Screen 102 - Incident History)
// Ye wo cases hain jo resolve ho chuke hain aur staff unka hissa tha
const getIncidentHistoryAll = async (req, res) => {
    try {
        const { search, timeframe } = req.query; // timeframe: 'All', 'This Month', 'Last Month'
        
        let query = { 
            assignedStaff: req.user.id, 
            status: { $in: ['Closed', 'Archived'] } 
        };

        // Figma Search
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        // Figma Timeframe Filter
        const now = new Date();
        if (timeframe === 'This Month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            query.resolvedAt = { $gte: startOfMonth };
        } else if (timeframe === 'Last Month') {
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
            query.resolvedAt = { $gte: startOfLastMonth, $lte: endOfLastMonth };
        }

        const history = await FireCase.find(query).sort({ resolvedAt: -1 });

        res.json({
            success: true,
            count: history.length,
            data: history.map(h => ({
                ...h._doc,
                // Additional fields for History Card (Screen 102)
                resolvedDateFormatted: new Date(h.resolvedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                timeAgo: "3 Days Ago", // Staff can calculate this or use resolvedAt
                finalStatus: h.status === 'Closed' ? 'Investigation Completed' : 'Case Archived'
            }))
        });
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
    getStaffNotifications, // Added
    getStaffDashboard, getFreshCases , getCaseDetails,getAcceptedCases,getIncidentHistoryAll,getIncidentHistory,markAllNotificationsRead, acceptCase, requestBackup
};