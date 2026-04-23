const FireStaff = require('../../../models/FireStaff');
const FireLeave = require('../../../models/FireLeave');
const FireCase = require('../../../models/FireCase');
const FireEquipment = require('../../../models/FireEquipment');

// 1. GET STAFF ROSTER (Screen 12)
const getStaffRoster = async (req, res) => {
    try {
        const stationId = req.user.id;
        const { shiftType } = req.query; // 'Day' or 'Night' from Flutter Toggle

        const allStaff = await FireStaff.find({ stationId });
        
        // ADDON: Figma Screen 50 Attendance Labels logic
        const formattedStaff = allStaff.map(s => ({
            name: s.fullName,
            rank: s.rank,
            status: s.status === 'Active' ? 'PRESENT' : 'OFF DUTY', // Screen 51 label
            checkInTime: "07:55 AM", // Mock for UI
            shift: s.currentShift || "Shift A"
        }));

        res.json({
            success: true,
            stats: {
                onDuty: allStaff.filter(s => s.status === 'Active').length,
                onLeave: allStaff.filter(s => s.status === 'On Leave').length,
                weeklyOff: 2
            },
            data: {
                shiftTitle: shiftType === 'Night' ? "SHIFT B (16:00 - 00:00)" : "SHIFT A (08:00 - 16:00)",
                staff: formattedStaff
            }
        });
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

const updateLeaveStatus = async (req, res) => {
    try {
        const { status } = req.body; // Approved / Rejected
        const leave = await FireLeave.findByIdAndUpdate(req.params.id, { status }, { new: true });
        res.json({ success: true, message: `Leave ${status}`, data: leave });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
    updateEquipmentStatus
};