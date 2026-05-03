const FireCase = require('../../../models/FireCase');
const FireStaff = require('../../../models/FireStaff');
const FireVehicle = require('../../../models/FireVehicle');
const bcrypt = require('bcryptjs');
const FireStation = require('../../../models/FireStation');
const FireEquipment = require('../../../models/FireEquipment'); // Added for Equipment logic

// 1. STATION DASHBOARD STATS (Figma Screen 33 - Station Home)
const getStationDashboard = async (req, res) => {
    try {
        const stationId = req.user.id;
        const newAlerts = await FireCase.countDocuments({ stationId, status: 'Fresh' });
        const ongoing = await FireCase.countDocuments({ stationId, status: { $in: ['Pending', 'Under Control', 'Critical'] } });
        const resolved = await FireCase.countDocuments({ stationId, status: 'Closed' });

        res.json({
            success: true,
            data: { 
                newFireAlerts: newAlerts,
                ongoingOperations: ongoing,
                resolvedIncidents: resolved,
                totalEarnings: "42,000" 
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. INCIDENT MANAGEMENT
// Get Fresh Cases (Figma Screen 100/101 - Filter "New Cases")
const getFreshCases = async (req, res) => {
    try {
        const cases = await FireCase.find({ stationId: req.user.id, status: 'Fresh' })
            .sort({ reportedAt: -1 })
            .select('caseNo reportedAt address severity fireType status'); // Added severity & fireType for UI cards

        res.json({ success: true, count: cases.length, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Accept Case (Figma Button: "Accept Case")
const acceptCase = async (req, res) => {
    try {
        const updatedCase = await FireCase.findByIdAndUpdate(
            req.params.id, 
            { 
                status: 'Pending', 
                dispatchedAt: Date.now(),
                severity: 'Level 2' // Initial default severity as per Figma Screen 101
            }, 
            { new: true }
        );
        res.json({ success: true, message: "Case Accepted. Team Dispatched.", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Get Accepted/Ongoing Cases (Figma Screen 100 - Tabs: All, Under Control, Critical)
const getAcceptedCases = async (req, res) => {
    try {
        const stationId = req.user.id;
        const { type } = req.query; 

        let query = { 
            stationId, 
            status: { $in: ['Pending', 'Under Control', 'Critical'] } 
        };

        if (type && type !== 'All') { query.status = type; }

        const cases = await FireCase.find(query)
            .sort({ dispatchedAt: -1 })
            .populate('assignedStaff', 'fullName rank') 
            .populate('assignedVehicles', 'vehicleName assetId');

        // ADDON: Flutter UI needs specific labels from Figma Screen 100
        const formattedCases = cases.map(c => ({
            ...c._doc,
            teamLead: c.assignedStaff.length > 0 ? c.assignedStaff[0].fullName : "Not Assigned", // Screen 100 requirement
            trucksCount: c.assignedVehicles.length, // Screen 100 requirement
            severityLabel: c.status === 'Critical' ? 'Fire Spreading' : 'Fire Contained' // Figma red/green labels
        }));

        res.json({ success: true, count: formattedCases.length, data: formattedCases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. CASE HISTORY & DETAILED REPORT (Figma Screen 66 & 102)
const getCaseHistory = async (req, res) => {
    try {
        const { status, search, timeframe } = req.query; 
        const stationId = req.user.id;

        let query = { stationId, status: { $in: ['Closed', 'Archived', 'Resolved'] } };

        if (status && status !== 'All') query.status = status;
        if (search) {
            query.$or = [{ caseNo: new RegExp(search, 'i') }, { address: new RegExp(search, 'i') }];
        }

        // ADDED: Timeframe filtering for Screen 102 (This Month, Last Month)
        if (timeframe) {
            const now = new Date();
            if (timeframe === 'this_month') {
                query.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
            }
        }

        const history = await FireCase.find(query)
            .sort({ resolvedAt: -1 })
            .select('caseNo address fireType resolvedAt resourcesUsed responseTime'); // Added responseTime for History Card

        res.json({ success: true, data: history });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getIncidentReport = async (req, res) => {
    try {
        const incident = await FireCase.findById(req.params.id)
            .populate('assignedStaff', 'fullName rank')
            .populate('assignedVehicles', 'vehicleName assetId');

        if (!incident) return res.status(404).json({ message: "Report not found" });

        res.json({
            success: true,
            data: {
                generalDetails: {
                    incidentId: incident.caseNo,
                    type: incident.fireType,
                    location: incident.address,
                    reportedTime: incident.reportedAt,
                    responseTime: incident.responseTime || "38 Minutes" // Figma Screen 66
                },
                resourcesUsed: {
                    trucksAssigned: incident.assignedVehicles.length,
                    personnel: `${incident.assignedStaff.length} Firefighters`,
                    equipment: ["Hoses", "Ladders", "BA Sets"] // Figma default list
                },
                damageImpact: incident.damageImpact || {
                    damageLevel: "Minor Structural Damage",
                    injuries: 0,
                    casualties: 0
                },
                scenePhotos: incident.incidentImages // Photos array for Screen 66
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNearbyStations = async (req, res) => {
    try {
        const stations = await FireStation.find({ _id: { $ne: req.user.id } });
        // Figma Screen 23 UI fields
        const nearby = stations.map(s => ({
            id: s._id,
            name: s.stationName,
            location: s.address,
            distance: (Math.random() * 10).toFixed(1) + " km away", // Static for now, real calculation below
            captain: s.captainName
        }));
        res.json({ success: true, data: nearby });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. STAFF MANAGEMENT (Screen 8 & 11)
const addStaff = async (req, res) => {
    try {
        const { fullName, badgeId, rank, mobileNumber, officialEmail, password, address } = req.body;
        
        const exists = await FireStaff.findOne({ $or: [{ badgeId }, { officialEmail }] });
        if (exists) return res.status(400).json({ message: "Staff with this Badge ID or Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const staff = await FireStaff.create({
            stationId: req.user.id,
            hqId: req.user.hqId, // FireStation model se HQ ID leni hogi
            fullName, badgeId, rank, mobileNumber, officialEmail, address,
            password: hashedPassword
        });

        res.status(201).json({ success: true, message: "Staff Added Successfully", data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getStaffList = async (req, res) => {
    try {
        const staff = await FireStaff.find({ stationId: req.user.id });
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. FLEET/EQUIPMENT MANAGEMENT (Screen 6)
const addVehicle = async (req, res) => {
    try {
        const vehicle = await FireVehicle.create({ ...req.body, stationId: req.user.id });
        res.status(201).json({ success: true, data: vehicle });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getFleetList = async (req, res) => {
    try {
        const vehicles = await FireVehicle.find({ stationId: req.user.id });
        res.json({ success: true, data: vehicles });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// ADDON: Get Removal Reasons (Figma Screen 10 - Modal)
// Flutter dropdown/radio buttons ke liye constants
const getStaffRemovalReasons = async (req, res) => {
    const reasons = [
        "Transferred to another fire station",
        "Retired from fire service",
        "Suspended / Disciplinary action",
        "Resigned from duty",
        "Medical leave / Unfit for duty",
        "Duplicate staff record",
        "Other reason"
    ];
    res.json({ success: true, data: reasons });
};

// ADDON: EDIT STAFF (Figma Screen 92 & Edit Profile screens)
const updateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const staff = await FireStaff.findById(id);
        if (!staff) return res.status(404).json({ message: "Staff not found" });

        // Figma logic: Badge ID manually change nahi ho sakti
        delete updates.badgeId;

        // Agar profile image update ho rahi hai
        if (req.file) {
            // purani file delete karne ka logic utils se call karein
            updates.profileImage = req.file.path;
        }

        const updatedStaff = await FireStaff.findByIdAndUpdate(
            id, 
            { $set: updates }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Staff updated successfully", data: updatedStaff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ADDON: DELETE STAFF (Figma Screen 10 - Remove Staff Member)
const deleteStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, otherReason } = req.body; // Screen 10 fields

        const staff = await FireStaff.findById(id);
        if (!staff) return res.status(404).json({ message: "Staff not found" });

        // Logic: Aap ise hard delete bhi kar sakte hain ya status 'Inactive'
        // Figma screen 'Remove' kehti hai, toh hum delete kar rahe hain
        await FireStaff.findByIdAndDelete(id);

        res.json({ 
            success: true, 
            message: `Staff member removed. Reason: ${reason === 'Other reason' ? otherReason : reason}` 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ADDON: OFFICER PROFILE STATS (Figma Screen 93)
const getStaffProfileDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const staff = await FireStaff.findById(id).populate('stationId', 'stationName');
        
        if (!staff) return res.status(404).json({ message: "Staff not found" });

        res.json({
            success: true,
            data: {
                profile: staff,
                stats: {
                    casesAssigned: "12 Active", // Figma Screen 93
                    attendance: "96%",          // Figma Screen 93
                    joiningDate: staff.joiningDate || "14 Aug 2018",
                    station: staff.stationId?.stationName || "N/A"
                },
                recentActivity: [
                    { title: "Filled FIR #2024-892", time: "Today, 10:30 AM" },
                    { title: "Shift Check-in", time: "Today, 07:55 AM" },
                    { title: "Patrol: Sector 4", time: "Yesterday, 04:15 PM" }
                ]
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const addSupportingStation = async (req, res) => {
    try {
        const { caseId, supportingStationId } = req.body;
        
        const updatedCase = await FireCase.findByIdAndUpdate(
            caseId,
            { $addToSet: { supportingStations: supportingStationId } }, // Add if not exists
            { new: true }
        );

        res.json({ success: true, message: "Supporting Station Added", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// NEW: Staff aur Vehicles ko case par assign karna (Figma Screen 100 assignment)
const assignResourcesToCase = async (req, res) => {
    try {
        const { caseId, staffIds, vehicleIds } = req.body;

        const updatedCase = await FireCase.findByIdAndUpdate(
            caseId,
            { 
                assignedStaff: staffIds, 
                assignedVehicles: vehicleIds,
                status: 'Pending' // Deployment phase
            },
            { new: true }
        ).populate('assignedStaff assignedVehicles');

        res.json({ success: true, message: "Resources assigned and team dispatched", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// NEW: Vehicle maintenance activity add karna (Figma Screen 7)
const addVehicleActivityLog = async (req, res) => {
    try {
        const { vehicleId, activityName, performedBy, mileage } = req.body;

        const updatedVehicle = await FireVehicle.findByIdAndUpdate(
            vehicleId,
            { 
                $push: { 
                    maintenanceLogs: { 
                        activityName, 
                        performedBy, 
                        mileageAtService: mileage,
                        date: Date.now() 
                    } 
                } 
            },
            { new: true }
        );

        res.json({ success: true, message: "Activity logged successfully", data: updatedVehicle });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateVehicleStatus = async (req, res) => {
    try {
        const { vehicleId, status } = req.body; // status: 'Available', 'Maintenance', 'Out of Service'
        const updated = await FireVehicle.findByIdAndUpdate(vehicleId, { status }, { new: true });
        res.json({ success: true, message: "Vehicle status updated", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const toggleCaseHoldStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const fireCase = await FireCase.findById(id);
        fireCase.status = fireCase.status === 'On Hold' ? 'Pending' : 'On Hold';
        await fireCase.save();
        res.json({ success: true, message: `Case is now ${fireCase.status}` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getStationDashboard, getFreshCases, acceptCase,getAcceptedCases,getCaseHistory,
    getIncidentReport, getNearbyStations, addStaff, getStaffList, addVehicle, getFleetList, getStaffRemovalReasons, 
    updateStaff, deleteStaff, getStaffProfileDetails, addSupportingStation, assignResourcesToCase, 
    addVehicleActivityLog, updateVehicleStatus, toggleCaseHoldStatus };