const FireCase = require('../../../models/FireCase');
const FireStaff = require('../../../models/FireStaff');
const FireVehicle = require('../../../models/FireVehicle');
const bcrypt = require('bcryptjs');
const FireStation = require('../../../models/FireStation');
const FireEquipment = require('../../../models/FireEquipment'); // Added for Equipment logic
const FireNotification = require('../../../models/FireNotification');
const { getDistance } = require('../../../utils/helpers'); // Distance calculation helper
const { deleteFile } = require('../../../utils/fileHandler'); // File deletion helper


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
        const { search, filter } = req.query;
        let query = { stationId: req.user.id, status: 'Fresh' };

        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (filter === 'High Priority') query.severity = 'High';

        const cases = await FireCase.find(query).sort({ reportedAt: -1 });
        res.json({ success: true, count: cases.length, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// NEW: Fresh Case ki Full Details nikalne ke liye (Figma Screen 100 -> View Details)
const getFreshCaseDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const stationId = req.user.id;

        // Sirf wahi case dikhao jo is station ka ho aur 'Fresh' ho
        const incident = await FireCase.findOne({ _id: id, stationId: stationId, status: 'Fresh' })
            .populate('hqId', 'stationName'); // Command Center ka naam dikhane ke liye

        if (!incident) {
            return res.status(404).json({ success: false, message: "Fresh case not found or already accepted." });
        }

        res.json({
            success: true,
            data: {
                incidentId: incident.caseNo,
                status: incident.status,
                // Figma specific mapping
                priority: incident.severity === 'Critical' ? 'High Priority' : 'Normal',
                generalDetails: {
                    type: incident.fireType,
                    address: incident.address,
                    reportedTime: incident.reportedAt,
                    severity: incident.severity,
                    severityLevel: incident.severityLevel || "Level 1" // Screen 101/102 mapping
                },
                location: incident.location, // lat, lng for Map
                callerDetails: {
                    name: incident.callerName,
                    phone: incident.callerPhone
                },
                description: incident.description || "No additional notes provided.",
                source: incident.hqId?.stationName || "Fire Command Center"
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
        const { type, search } = req.query; 
        let query = { 
            stationId: req.user.id, 
            status: { $in: ['Pending', 'Under Control', 'Critical'] } 
        };

        if (type && type !== 'All') query.status = type;
        if (search) {
            query.$or = [
                { caseNo: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        const cases = await FireCase.find(query)
            .populate('assignedStaff', 'fullName rank') 
            .populate('assignedVehicles', 'vehicleName assetId');

        const formattedCases = cases.map(c => ({
            ...c._doc,
            teamLead: c.assignedStaff.length > 0 ? c.assignedStaff[0].fullName : "Not Assigned",
            trucksCount: c.assignedVehicles.length,
            severityLabel: c.status === 'Critical' ? 'Fire Spreading' : 'Fire Contained'
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
        const { lat, lng } = req.query; // Incident ki location
        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "Latitude and Longitude are required." });
        }

        const stations = await FireStation.find({ _id: { $ne: req.user.id } });

        const nearby = await Promise.all(stations.map(async (s) => {
            let distance = 0;
            if (s.location?.lat && s.location?.lng) {
                // Real distance calculation using your helper
                distance = await getDistance(
                    parseFloat(lat), 
                    parseFloat(lng), 
                    s.location.lat, 
                    s.location.lng
                );
            }
            return {
                id: s._id,
                name: s.stationName,
                location: s.address,
                distance: `${distance} km away`, // Accurate distance
                distanceRaw: distance, // Sorting ke liye
                captain: s.captainName
            };
        }));

        // Sabse pass wala station pehle dikhane ke liye sort karein
        nearby.sort((a, b) => a.distanceRaw - b.distanceRaw);

        res.json({ success: true, data: nearby });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// NEW: Incident Status Update (Figma Screenshot logic)
const updateIncidentStatusDetailed = async (req, res) => {
    try {
        const { id } = req.params;
        const { statusLabel, situationReport, backupRequired } = req.body;

        // 1. Pehle current case details fetch karein purani images ke liye
        const currentCase = await FireCase.findById(id);
        if (!currentCase) return res.status(404).json({ message: "Case not found" });

        let finalStatus = 'Pending'; 
        if (statusLabel === 'Resolved') finalStatus = 'Closed';
        else if (statusLabel === 'Under Control') finalStatus = 'Under Control';

        // 2. IMAGE REPLACEMENT & AUTO-DELETE LOGIC
        let newEvidencePhotos = currentCase.incidentImages; // Default: purani hi rahegi

        // Check karein ki kya naye photos upload huye hain
        if (req.files && req.files['incidentImages']) {
            
            // Step A: Purani photos ko server se delete karein
            if (currentCase.incidentImages && currentCase.incidentImages.length > 0) {
                currentCase.incidentImages.forEach(oldImagePath => {
                    deleteFile(oldImagePath); // Aapka helper function
                });
            }

            // Step B: Naye paths ko array mein store karein
            newEvidencePhotos = req.files['incidentImages'].map(f => f.path);
        }

        // 3. Database update karein
        const updatedCase = await FireCase.findByIdAndUpdate(
            id,
            { 
                status: finalStatus,
                severityStatus: statusLabel,
                remarks: situationReport,
                backupRequired: backupRequired, 
                incidentImages: newEvidencePhotos, // Purani replace ho gayi naye se
                resolvedAt: statusLabel === 'Resolved' ? Date.now() : currentCase.resolvedAt
            },
            { new: true }
        );

        res.json({ 
            success: true, 
            message: statusLabel === 'Resolved' ? "Case Resolved and Cleaned" : "Status Updated (Old images deleted)", 
            data: updatedCase 
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// 3. STAFF MANAGEMENT (Screen 8 & 11)
const addStaff = async (req, res) => {
    try {
        const { fullName, badgeId, rank, mobileNumber, officialEmail, password, address } = req.body;
        
        const exists = await FireStaff.findOne({ $or: [{ badgeId }, { officialEmail }] });
        if (exists) return res.status(400).json({ message: "Staff with this Badge ID or Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const staffData = {
            stationId: req.user.id,
            hqId: req.user.hqId,
            fullName, badgeId, rank, mobileNumber, officialEmail, address,
            password: hashedPassword
        };

        // Figma support: Add profile image if uploaded
        if (req.file) staffData.profileImage = req.file.path;

        const staff = await FireStaff.create(staffData);
        res.status(201).json({ success: true, message: "Staff Added Successfully", data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getStaffList = async (req, res) => {
    try {
        const { search } = req.query;
        let query = { stationId: req.user.id };

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { badgeId: { $regex: search, $options: 'i' } }
            ];
        }

        const staff = await FireStaff.find(query).sort({ fullName: 1 });
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
        const { search } = req.query;
        let query = { stationId: req.user.id };

        if (search) {
            query.$or = [
                { vehicleName: { $regex: search, $options: 'i' } },
                { assetId: { $regex: search, $options: 'i' } }
            ];
        }

        const vehicles = await FireVehicle.find(query);
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



// A. JURISDICTION DATA (Figma Screen 41)
const getJurisdictionDetails = async (req, res) => {
    try {
        const station = await FireStation.findById(req.user.id).populate('hqId', 'stationName');
 
        if (!station) {
            return res.status(404).json({ success: false, message: "Station not found" });
        }
 
        res.json({
            success: true,
            data: {
                location: {
                    lat: station.location?.lat || 0,
                    lng: station.location?.lng || 0
                },
                coverageSummary: {
                    totalArea: station.jurisdiction?.totalArea || "N/A",
                    population: station.jurisdiction?.population || "N/A",
                    activeZone: station.jurisdiction?.activeZones || 0,
                    riskLevel: station.jurisdiction?.riskLevel || "N/A"
                },
                // FIXED: Schema fields (sector, title, desc) use karein
                primarySectors: station.primarySectors.map(s => ({
                    sector: s.sector,
                    title: s.title,
                    desc: s.desc
                })),
                stationName: station.stationName
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
// Endpoint;  /fireStation/management/request-jurisdiction-update
const requestJurisdictionUpdate = async (req, res) => {
    try {
        await FireStation.findByIdAndUpdate(req.user.id, {
            isUpdateRequested: true,
            requestDate: Date.now()
        });
        res.json({ success: true, message: "Update request sent to HQ" });
    } catch (error) {
        res.status(500).json({ message: error. Message });
    }
};

// B. STATION NOTIFICATIONS (Figma Screen 16/17)
const getStationNotifications = async (req, res) => {
    try {
        const notifications = await FireNotification.find({ 
            $or: [{ stationId: req.user.id }, { global: true }] 
        }).sort({ createdAt: -1 });

        // Logic to group Today and Yesterday as per Figma
        const today = [];
        const yesterday = [];
        const now = new Date();

        notifications.forEach(n => {
            const diff = (now - new Date(n.createdAt)) / (1000 * 60 * 60 * 24);
            if (diff < 1) today.push(n);
            else yesterday.push(n);
        });

        res.json({ success: true, data: { today, yesterday } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// C. TOGGLE PREFERENCES (Figma Screen 18 - Station Settings)
const updatePreferences = async (req, res) => {
    try {
        const { alertsAndSounds, emergencyNotifications } = req.body;
        const updated = await FireStation.findByIdAndUpdate(
            req.user.id,
            { "notificationSettings.alertsAndSounds": alertsAndSounds, 
              "notificationSettings.emergencyNotifications": emergencyNotifications },
            { new: true }
        );
        res.json({ success: true, message: "Preferences updated", data: updated.notificationSettings });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// D. HELP & TERMS DATA (Screen 19)
const getAppLegalInfo = async (req, res) => {
    res.json({
        success: true,
        data: {
            helpContact: { phone: "+91 9876543210", email: "help@gmail.com" },
            terms: "Standard Fire Station Terms and Conditions...",
            about: "Smart Emergency Response & Fire Control System v1.0"
        }
    });
};

const createFireCase = async (req, res) => {
    try {
        const { callerName, callerPhone, fireType, severity, description, address, lat, lng, stationId } = req.body;
 
        if (!lat || !lng) return res.status(400).json({ success: false, message: "Lat/Lng required." });
 
        // Generate a readable Case No (Figma Match: Fire-2026-XXXX)
        const year = new Date().getFullYear();
        const randomStr = Math.floor(10000 + Math.random() * 90000);
        const caseNo = `Fire-${year}-${randomStr}`;
 
        const newCase = await FireCase.create({
            hqId: req.user.id,
            stationId,
            caseNo, // Custom generated
            callerName, callerPhone, fireType, severity, description, address,
            location: { lat: Number(lat), lng: Number(lng) },
            status: 'Fresh',
            reportedAt: Date.now()
        });
 
        // Notify the specific station
        await FireNotification.create({
            stationId: stationId, // Station ko notification bhejna zaroori hai
            hqId: req.user.id,
            title: "New Emergency Case Dispatched",
            message: `Emergency at ${address}. Incident ID: ${caseNo}`,
            type: 'Emergency'
        });
 
        res.status(201).json({ success: true, message: "Fresh Case Dispatched Successfully!", data: newCase });
    } catch (error) { res.status(500).json({ success: false, message: error. Message }); }
};
 

module.exports = { getStationDashboard, getFreshCases,getFreshCaseDetails, acceptCase,getAcceptedCases,getCaseHistory,
    getIncidentReport, getNearbyStations,updateIncidentStatusDetailed, addStaff, getStaffList, addVehicle, getFleetList, getStaffRemovalReasons, 
    updateStaff, deleteStaff, getStaffProfileDetails, addSupportingStation, assignResourcesToCase, 
    addVehicleActivityLog, updateVehicleStatus, toggleCaseHoldStatus,
     getJurisdictionDetails,requestJurisdictionUpdate, getStationNotifications, updatePreferences, getAppLegalInfo,createFireCase };