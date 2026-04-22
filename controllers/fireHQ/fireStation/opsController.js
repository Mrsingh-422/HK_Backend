const FireStaff = require('../../../models/FireStaff');
const FireLeave = require('../../../models/FireLeave');
const FireCase = require('../../../models/FireCase');
const FireEquipment = require('../../../models/FireEquipment');

// 1. GET STAFF ROSTER (Screen 12)
const getStaffRoster = async (req, res) => {
    try {
        const { shift } = req.query; // Day or Night
        const stationId = req.user.id;

        // On Duty Staff
        const onDuty = await FireStaff.find({ stationId, status: 'Active' });
        // On Leave Staff
        const onLeave = await FireLeave.find({ stationId, status: 'Approved', toDate: { $gte: new Date() } }).populate('staffId');

        res.json({
            success: true,
            data: {
                totalOnDuty: onDuty.length,
                totalOnLeave: onLeave.length,
                totalWeeklyOff: 2, // Static for example
                roster: onDuty 
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
        const { 
            incidentType, damageLevel, injuries, casualties, 
            trucksAssigned, firefightersCount, equipmentUsed 
        } = req.body;

        const incidentImages = req.files ? req.files.map(f => f.path) : [];

        const finalCase = await FireCase.findByIdAndUpdate(req.params.id, {
            status: 'Closed',
            resolvedAt: Date.now(),
            fireType: incidentType,
            severity: 'Low', // After resolution
            incidentImages,
            // Custom report fields
            reportDetails: {
                damageLevel, injuries, casualties,
                trucksAssigned, firefightersCount, equipmentUsed
            }
        }, { new: true });

        res.json({ success: true, message: "Final Report Submitted Successfully", data: finalCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
    getPendingLeaves,
    updateLeaveStatus,
    updateCaseSeverity,
    submitFinalReport,
    getEquipment,
    addEquipment,
    updateEquipmentStatus
};