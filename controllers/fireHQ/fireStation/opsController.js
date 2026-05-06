const FireStaff = require('../../../models/FireStaff');
const FireLeave = require('../../../models/FireLeave');
const FireCase = require('../../../models/FireCase');
const FireEquipment = require('../../../models/FireEquipment');
const FireAttendance = require('../../../models/FireAttendance');
const FireStation = require('../../../models/FireStation');

// 1. GET STAFF ROSTER (Screen 12)
const getStaffRoster = async (req, res) => {
    try {
        const stationId = req.user.id;
        const { shiftType } = req.query;
        const today = new Date(); // Aaj ki date

        // 1. Station ke saare staff nikalo
        const staffList = await FireStaff.find({ 
            stationId, 
            currentShift: shiftType === 'Night' ? 'Shift B' : 'Shift A' 
        });

        const rosterData = await Promise.all(staffList.map(async (staff) => {
            let checkInTime = "--:--";
            let dutyStatus = "OFF-DUTY"; // Default status

            // --- A. LIVE CHECK-IN CHECK ---
            // Sabse pehle dekho kya banda abhi On-Duty (Active) hai?
            if (staff.status === 'Active') {
                dutyStatus = "ON-DUTY";
                const lastAttendance = await FireAttendance.findOne({ staffId: staff._id }).sort({ createdAt: -1 });
                if (lastAttendance) {
                    checkInTime = new Date(lastAttendance.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                }
            } 
            
            // --- B. LIVE LEAVE CHECK (Date based) ---
            // Agar banda Active nahi hai, toh check karo kya aaj uski Approved Leave chal rahi hai?
            if (dutyStatus === "OFF-DUTY") {
                const activeLeave = await FireLeave.findOne({
                    staffId: staff._id,
                    status: 'Approved',
                    fromDate: { $lte: today }, // Chutti shuru ho chuki ho (Start Date <= Today)
                    toDate: { $gte: today }    // Chutti abhi khatam na hui ho (End Date >= Today)
                });

                if (activeLeave) {
                    dutyStatus = "LEAVE";
                }
            }

            return {
                id: staff._id,
                name: staff.fullName,
                rank: staff.rank,
                badge: staff.badgeId,
                dutyStatus: dutyStatus, // ON-DUTY, LEAVE, or OFF-DUTY
                checkInTime: checkInTime
            };
        }));

        res.json({
            success: true,
            stats: {
                totalPresent: rosterData.filter(s => s.dutyStatus === 'ON-DUTY').length,
                totalOnLeave: rosterData.filter(s => s.dutyStatus === 'LEAVE').length,
                totalStaff: staffList.length
            },
            data: rosterData
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. UPDATE LEAVE STATUS (Sync Status with Roster)
const updateLeaveStatus = async (req, res) => {
    try {
        const { status, rejectionReason } = req.body;
        // Bas Leave record ko update karo
        const leave = await FireLeave.findByIdAndUpdate(
            req.params.id, 
            { status, rejectionReason }, 
            { new: true }
        );
        res.json({ success: true, message: `Leave ${status} successfully.` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// ADDED: Shift Impact Analysis (Screen 53/54)
const checkLeaveImpact = async (req, res) => {
    // Figma screen dikhati hai ki agar koi leave pe ja raha hai toh shortage hogi
    // Ye logic yahan calculate hoga
    res.json({
        success: true,
        impact: "Night duty shortage",
        message: "Auto reject non-critical leave mode is active"
    });
};

// ADDED: Detailed Equipment View (Screen 58)
const getEquipmentDetails = async (req, res) => {
    try {
        const item = await FireEquipment.findById(req.params.id);
        if(!item) return res.status(404).json({message: "Not found"});

        res.json({
            success: true,
            data: {
                equipmentName: item.equipmentName,
                status: item.status, // Available, Maintenance, Low Stock
                stats: {
                    total: item.totalQty,
                    inService: 30, // Figma example
                    inStorage: 15  // Figma example
                },
                // ADDON: Specific Specifications for Screen 58
                specifications: [
                    { label: "Category", value: item.category || "Hoses & Nozzles" },
                    { label: "Diameter", value: "1.5 inches" },
                    { label: "Working Pressure", value: "400 PSI" }
                ],
                // ADDON: Allocation List for Screen 58
                currentAllocation: [
                    { name: "Engine 1 (ENG-01)", sub: "Crosslays & Hosebed", qty: 15 },
                    { name: "Station Supply Room", sub: "Rack B, Shelf 3", qty: 15 }
                ]
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getFireTypes = async (req, res) => {
    try {
        // Mongoose model se enum values nikalne ka dynamic tarika
        const fireTypes = FireCase.schema.path('fireType').enumValues;

        // Saath hi agar Severity aur Damage Level bhi chahiye toh (Optional but useful for Flutter)
        const severities = FireCase.schema.path('severity').enumValues;
        const damageLevels = FireCase.schema.path('damageImpact.damageLevel').enumValues;

        res.json({
            success: true,
            data: {
                fireTypes: fireTypes,        // ['Residential', 'Industrial', 'Forest', 'Vehicle', 'Other']
                severities: severities,      // ['Low', 'Medium', 'High', 'Critical']
                damageLevels: damageLevels   // ['Minor', 'Major', 'Total', 'Minor Structural Damage']
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. MANAGE LEAVE REQUESTS (Screen 3)
const getPendingLeaves = async (req, res) => {
    try {
        const leaves = await FireLeave.find({ stationId: req.user.id, status: 'Pending' }).populate('staffId');
        res.json({ success: true, data: leaves });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 1. Dropdown: Get Station Staff List (Figma: "Requesting For")
const getStaffForDropdown = async (req, res) => {
    try {
        const staff = await FireStaff.find({ stationId: req.user.id })
            .select('fullName rank badgeId');
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. Dropdown: Get Leave Enums (Figma: "Leave Category")
const getLeaveEnums = (req, res) => {
    // Model se direct enums nikal kar bhejna
    const enums = FireLeave.schema.path('leaveType').enumValues;
    res.json({ success: true, data: enums });
};
// const updateLeaveStatus = async (req, res) => {
 
//     try {
 
//         // Extract status and rejectionReason from req.body
 
//         const { status, rejectionReason } = req.body;
 
//         // Prepare data to update
 
//         const updateData = { status };
 
//         if (status === 'Rejected' && rejectionReason) {
 
//             updateData.rejectionReason = rejectionReason;
 
//         }
 
//         const leave = await FireLeave.findByIdAndUpdate(req.params.id, updateData, { new: true });
 
//         res.json({ success: true, message: `Leave ${status}`, data: leave });
 
//     } catch (error) {
 
//         // Fixed typo: error.Message -> error.message
 
//         res.status(500).json({ message: error. Message });
 
//     }
 
// };
 
 
// 3. APPLY FOR LEAVE (POST Request)
const applyLeave = async (req, res) => {
    try {
        // Agar req.body undefined hai toh error na aaye isliye empty object {} default rakha hai
        const { staffId, leaveType, fromDate, toDate, reason } = req.body || {};

        if (!staffId) {
            return res.status(400).json({ success: false, message: "staffId is required in request body" });
        }

        const start = new Date(fromDate);
        const end = new Date(toDate);
        const duration = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;

        const newLeave = await FireLeave.create({
            staffId,
            stationId: req.user.id,
            leaveType,
            fromDate,
            toDate,
            duration,
            reason,
            // req.file Multer se aayega
            attachment: req.file ? req.file.path : null, 
            status: 'Pending'
        });

        res.status(201).json({ success: true, message: "Submitted", data: newLeave });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. UPDATE ONGOING CASE STATUS (Screen 5)
const updateCaseSeverity = async (req, res) => {
    try {
        const { severityStatus } = req.body; // e.g., "Fire Contained - Cooling Process"
        const updatedCase = await FireCase.findByIdAndUpdate(
            req.params.id,
            { remarks: severityStatus },
            { new: true }
        );
        res.json({ success: true, message: "Status Updated", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. SUBMIT FINAL INCIDENT REPORT (Screen 10)
const submitFinalReport = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Check if Case exists
        const existingCase = await FireCase.findById(id);
        if (!existingCase) return res.status(404).json({ message: "Case not found" });

        const { 
            incidentType, damageLevel, injuries, casualties, 
            trucksAssigned, firefightersCount, equipmentUsed 
        } = req.body;

        // 2. Extract Images (Multer .fields() logic)
        let incidentImages = [];
        if (req.files && req.files['incidentImages']) {
            incidentImages = req.files['incidentImages'].map(f => f.path);
        }

        // 3. Update according to EXACT Schema keys
        const updatedCase = await FireCase.findByIdAndUpdate(id, {
            status: 'Closed',
            resolvedAt: Date.now(),
            fireType: incidentType || 'Other',
            incidentImages: incidentImages,
            
            // Matches Schema: resourcesUsed
            resourcesUsed: {
                trucksCount: Number(trucksAssigned) || 0,
                personnelCount: Number(firefightersCount) || 0,
                equipmentList: typeof equipmentUsed === 'string' ? equipmentUsed.split(',') : (equipmentUsed || [])
            },
            
            // Matches Schema: damageImpact
            damageImpact: {
                damageLevel: damageLevel || "Minor",
                injuries: Number(injuries) || 0,
                casualties: Number(casualties) || 0
            }
        }, { new: true, runValidators: true });

        res.json({ success: true, message: "Final Report Submitted", data: updatedCase });

    } catch (error) {
        console.error("SERVER ERROR:", error); // Terminal mein error check karne ke liye
        res.status(500).json({ success: false, message: error.message });
    }
};

// List Equipment
const getEquipment = async (req, res) => {
    try {
        const items = await FireEquipment.find({ stationId: req.user.id });
        res.json({ success: true, data: items });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Add New Item (Screen 8)
const addEquipment = async (req, res) => {
    try {
        const item = await FireEquipment.create({ ...req.body, stationId: req.user.id });
        res.status(201).json({ success: true, data: item });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Update Status (Screen 7)
const updateEquipmentStatus = async (req, res) => {
    try {
        const item = await FireEquipment.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ success: true, data: item });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const toggleEmergencyMode = async (req, res) => {
    try {
        const station = await FireStation.findById(req.user.id);
        station.isEmergencyModeActive = !station.isEmergencyModeActive;
        await station.save();

        res.json({ 
            success: true, 
            message: `Emergency Mode ${station.isEmergencyModeActive ? 'ON' : 'OFF'}`,
            isActive: station.isEmergencyModeActive 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


const reassignStaffShift = async (req, res) => {
    try {
        const { staffId, newShift } = req.body; // newShift: 'Shift A' or 'Shift B'
        await FireStaff.findByIdAndUpdate(staffId, { currentShift: newShift });
        res.json({ success: true, message: "Shift reassigned successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    getStaffRoster,
    checkLeaveImpact,
    getEquipmentDetails,
    getFireTypes,
    getPendingLeaves,
    updateLeaveStatus,
    updateCaseSeverity,
    submitFinalReport,
    getEquipment,
    addEquipment,
    updateEquipmentStatus,
    applyLeave,
    toggleEmergencyMode,
    reassignStaffShift, getStaffForDropdown, getLeaveEnums
};