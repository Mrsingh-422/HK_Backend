const FireStation = require('../../models/FireStation');
const FireHQ = require('../../models/FireHQ');
const FireCase = require('../../models/FireCase'); // Assuming this model exists for incidents
const FireNotification = require('../../models/FireNotification'); // For notifications related to cases
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');
const { getDistance } = require('../../utils/helpers');

const mongoose = require('mongoose');

// 1. GET DASHBOARD STATS (Screen 9)
const getDashboardStats = async (req, res) => {
    try {
        const hqId = req.user.id;
        
        // Dynamic counts for HQ perspective
        const [fresh, pending, resolved, totalStations] = await Promise.all([
            FireCase.countDocuments({ hqId, status: 'Fresh' }),
            FireCase.countDocuments({ hqId, status: 'Pending' }),
            FireCase.countDocuments({ hqId, status: { $in: ['Closed', 'Archived'] } }),
            FireStation.countDocuments({ hqId, isActive: true })
        ]);

        res.json({
            success: true,
            data: {
                freshCases: fresh,
                pendingCases: pending,
                historyCases: resolved,
                activeStations: totalStations, // Added for HQ overview
                services: [
                    { title: "Fresh Cases", count: fresh, subTitle: "New Incidents Reported" },
                    { title: "Pending Cases", count: pending, subTitle: "Under Investigation" },
                    { title: "Case History", count: resolved, subTitle: "Closed & Archived Cases" }
                ]
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

const getIncidentDetails = async (req, res) => {
    try {
        const incident = await FireCase.findById(req.params.id)
            .populate('stationId', 'stationName captainName')
            .populate('hqId', 'stationName');

        if (!incident) return res.status(404).json({ message: "Incident not found" });

        res.json({
            success: true,
            data: {
                generalDetails: {
                    incidentId: incident.caseNo,
                    type: incident.fireType,
                    location: incident.address,
                    reportedTime: incident.reportedAt,
                    severity: incident.severity
                },
                callerDetails: {
                    name: incident.callerName,
                    phone: incident.callerPhone
                },
                location: incident.location, // For Map (Screen 12)
                description: incident.description
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 


// 2. CREATE NEW FIRE STATION (By Fire-HQ)
// endpoint: POST /fireHQ/management/create-station
const createFireStation = async (req, res) => {
    try {
        const { 
            stationName, stationCode, captainName, operatingZone, 
            email, phone, landline, emergencyLines, officeDesk, 
            password, address 
        } = req.body;

        // Validation: Unique Check
        const exists = await FireStation.findOne({ 
            $or: [{ email }, { phone }, { stationCode }] 
        });

        if (exists) {
            return res.status(400).json({ 
                message: "Station with this Email, Phone or Station Code already exists" 
            });
        }

        // Individual Station ka login password hash karein
        const hashedPassword = await bcrypt.hash(password, 10);

        const newStation = await FireStation.create({
            hqId: req.user.id, // Current logged-in HQ ki ID link hogi
            stationName,
            stationCode,
            captainName,
            operatingZone,
            email,
            phone,
            landline,
            emergencyLines,
            officeDesk,
            address,
            password: hashedPassword,
            role: 'Fire-Station'
        });

        res.status(201).json({ 
            success: true, 
            message: "Fire Station created successfully. They can now login with their credentials.",
            data: {
                id: newStation._id,
                stationName: newStation.stationName,
                stationCode: newStation.stationCode
            }
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. GET ALL STATIONS UNDER THIS HQ (Screen 10)
const getMyStations = async (req, res) => {
    try {
        // HQ sirf wahi stations dekhega jo usne khud create kiye hain
        const stations = await FireStation.find({ hqId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, data: stations });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const getStationDetails = async (req, res) => {
    try {
        const station = await FireStation.findById(req.params.id);
        if (!station) return res.status(404).json({ message: "Station not found" });

        res.json({ success: true, data: station });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. CASE HISTORY WITH FILTERS (Screen 11 & 12)
const getCaseHistory = async (req, res) => {
    try {
        const { status, search, timeframe } = req.query; // timeframe: 'This Month', 'Last Month'
        const hqId = req.user.id;

        // Default: sirf closed/archived cases dikhao
        let query = { hqId, status: { $in: ['Closed', 'Archived'] } };
        
        if (status && status !== 'All') query.status = status;
        
        if (search) {
            query.$or = [
                { caseNo: new RegExp(search, 'i') },
                { address: new RegExp(search, 'i') }
            ];
        }

        // Timeframe filter (Figma Screen logic)
        if (timeframe === 'This Month') {
            const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            query.resolvedAt = { $gte: startOfMonth };
        }

        const cases = await FireCase.find(query)
            .sort({ resolvedAt: -1 })
            .populate('stationId', 'stationName'); // Taaki pta chale kis station ne resolve kiya

        res.json({ 
            success: true, 
            count: cases.length, 
            data: cases.map(c => ({
                ...c._doc,
                timeAgo: "2 Days Ago", // Flutter side logic ke liye helpful placeholder
                displayStatus: c.status === 'Closed' ? 'Investigation Completed' : 'Case Archived' // Figma Labels
            }))
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. CONTACT ADMIN (Screen 16/17 Help Modal)
const getAdminContact = async (req, res) => {
    res.json({
        success: true,
        data: {
            phone: "+91 9876543210",
            email: "help@gmail.com"
        }
    });
};

// 6. UPDATE FIRE STATION
// endpoint: PUT /fireHQ/management/update-station/:id
const updateFireStation = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body; 

        const station = await FireStation.findOne({ _id: id, hqId: req.user.id });
        if (!station) return res.status(404).json({ message: "Station not found" });

        // Multer single mode (fireStationUpdateUploads) req.file bhejta hai
        if (req.file) {
            if (station.profileImage) {
                deleteFile(station.profileImage); 
            }
            updates.profileImage = req.file.path; // Ye path DB mein jayega
        }

        const updatedStation = await FireStation.findByIdAndUpdate(
            id, 
            { $set: updates }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Station details updated", data: updatedStation });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 7. DELETE FIRE STATION
// endpoint: DELETE /fireHQ/management/delete-station/:id
const deleteFireStation = async (req, res) => {
    try {
        const { id } = req.params;

        // Check ownership before deletion
        const station = await FireStation.findOne({ _id: id, hqId: req.user.id });
        if (!station) {
            return res.status(404).json({ message: "Station not found or unauthorized" });
        }

        // Station delete karne se pehle uski profile image server se delete karein
        if (station.profileImage) {
            deleteFile(station.profileImage);
        }

        await FireStation.findByIdAndDelete(id);

        res.json({ 
            success: true, 
            message: "Fire Station and its data deleted successfully" 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


const updateJurisdiction = async (req, res) => {
    try {
        const hqId = req.user.id; // Logged-in HQ ki ID
        const { jurisdictionStats, primarySectors } = req.body;

        // Validation
        if (!jurisdictionStats || !primarySectors) {
            return res.status(400).json({ message: "Please provide both stats and sectors." });
        }

        const updatedHQ = await FireHQ.findByIdAndUpdate(
            hqId,
            { 
                $set: { 
                    jurisdictionStats: jurisdictionStats, 
                    primarySectors: primarySectors 
                } 
            },
            { new: true, runValidators: true }
        );

        res.json({ 
            success: true, 
            message: "Jurisdiction & Sectors updated successfully", 
            data: {
                stats: updatedHQ.jurisdictionStats,
                sectors: updatedHQ.primarySectors
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
// ADDED: Jurisdiction Details (Screen 41)
const getJurisdictionData = async (req, res) => {
    try {
        const hq = await FireHQ.findById(req.user.id);
        
        // Agar DB mein sectors nahi hain toh default bhejenge (Figma match)
        const sectors = hq.primarySectors.length > 0 ? hq.primarySectors : [
            { sectorName: "Sector A: Central Commercial", description: "MI Road, Sindhi Camp & surrounding markets. High footfall area.", iconType: "Commercial" },
            { sectorName: "Sector B: Residential", description: "Malviya Nagar, Raja Park. Predominantly apartments and housing.", iconType: "Residential" },
            { sectorName: "Sector C: Industrial Hub", description: "Sitapura & VKI Areas. High risk of chemical and electrical fires.", iconType: "Industrial" }
        ];

        res.json({
            success: true,
            data: {
                coverage: hq.jurisdictionStats,
                sectors: sectors
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// NEW: Request Boundary Update (Figma Screen 41 Button)
const requestBoundaryUpdate = async (req, res) => {
    // Ye system-level request hai, aap message store kar sakte hain ya email bhej sakte hain
    res.json({ success: true, message: "Boundary update request sent to higher authorities." });
};

// ADDED: Detailed Incident Report (Screen 66)
const getFullIncidentReport = async (req, res) => {
    try {
        const incident = await FireCase.findById(req.params.id)
            .populate('stationId', 'stationName captainName')
            .populate('assignedStaff', 'fullName rank')
            .populate('assignedVehicles', 'vehicleName assetId');

        if (!incident) return res.status(404).json({ message: "Report not found" });

        res.json({
            success: true,
            data: {
                incidentId: incident.caseNo,
                status: incident.status,
                general: {
                    type: incident.fireType,
                    location: incident.address,
                    reportedTime: incident.reportedAt,
                    responseTime: incident.responseTime || "38 Minutes"
                },
                resources: {
                    trucksUsed: incident.assignedVehicles?.length || incident.resourcesUsed?.trucksCount || 0,
                    personnel: `${incident.assignedStaff?.length || incident.resourcesUsed?.personnelCount || 0} Personnel`,
                    equipment: incident.resourcesUsed?.equipmentList || ["Hoses", "Ladders", "BA Sets"]
                },
                impact: incident.damageImpact || { damageLevel: "Minor", injuries: 0, casualties: 0 },
                photos: incident.incidentImages
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};




// A. GET NOTIFICATIONS (Screen 16/17)
const getHQNotifications = async (req, res) => {
    try {
        const notifications = await FireNotification.find({ hqId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, data: notifications });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// B. DELETE NOTIFICATION (Figma: Swipe to delete logic)
const deleteHQNotification = async (req, res) => {
    try {
        await FireNotification.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Notification deleted" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// C. RE-ASSIGN CASE (Figma Screen 3 - Re-assign Button)
// Agar ek station handle nahi kar paa raha, toh HQ use dusre station ko de sakta hai
const reassignFireCase = async (req, res) => {
    try {
        const { caseId, newStationId } = req.body;
        const updatedCase = await FireCase.findByIdAndUpdate(
            caseId,
            { stationId: newStationId, remarks: "Re-assigned by HQ" },
            { new: true }
        );
        res.json({ success: true, message: "Case re-assigned successfully", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// D. DASHBOARD CHART DATA (Screen 9 background chart)
const getDashboardChartData = async (req, res) => {
    try {
        // Sirf example ke liye monthly breakdown
        const stats = [
            { month: 'Jan', cases: 45 }, { month: 'Feb', cases: 52 },
            { month: 'Mar', cases: 35 } // current month
        ];
        res.json({ success: true, data: stats });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// A. MARK ALL NOTIFICATIONS AS READ (Figma Screen 16 - "Mark all read" button)
const markAllNotificationsRead = async (req, res) => {
    try {
        await FireNotification.updateMany({ hqId: req.user.id, isRead: false }, { isRead: true });
        res.json({ success: true, message: "All notifications marked as read" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// B. GET NEARBY STATIONS FOR SUPPORT (Figma Screen 23)
// Jab incident create ho raha ho, toh HQ ko dikhna chahiye kaunsa station kitne door hai
const getNearbyStationsForIncident = async (req, res) => {
    try {
        const { lat, lng } = req.query;

        // 1. Validation: Agar lat/lng missing hain
        if (!lat || !lng) {
            return res.status(400).json({ 
                success: false, 
                message: "Latitude (lat) and Longitude (lng) query parameters are required." 
            });
        }

        // 2. HQ ke under ke saare Active Stations nikalna
        const stations = await FireStation.find({ hqId: req.user.id, isActive: true });

        // 3. Distance calculate karke list taiyar karna
        const stationsWithDistance = await Promise.all(stations.map(async (s) => {
            // Agar station ki location set nahi hai toh use skip ya 0 distance dein
            let distance = 0;
            if (s.location && s.location.lat && s.location.lng) {
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
                captain: s.captainName,
                address: s.address,
                phone: s.phone,
                // Figma Screen 23 UI format
                distance: `${distance} km away`, 
                distanceInKm: distance // Sorting ke liye raw number
            };
        }));

        // 4. Sabse nazdeek wala station sabse upar (Nearest First)
        stationsWithDistance.sort((a, b) => a.distanceInKm - b.distanceInKm);

        res.json({ 
            success: true, 
            data: stationsWithDistance 
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const getBackupRequests = async (req, res) => {
    try {
        // HQ sirf apne jurisdiction ki backup requests dekhega
        const requests = await FireCase.find({ 
            hqId: req.user.id, 
            backupRequested: true,
            status: { $ne: 'Closed' } 
        }).populate('stationId', 'stationName');

        res.json({ success: true, data: requests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// HQ backup assign karega
const assignBackupStation = async (req, res) => {
    try {
        const { caseId, supportStationId } = req.body;

        await FireCase.findByIdAndUpdate(caseId, {
            $addToSet: { supportingStations: supportStationId },
            backupRequested: false // Request resolve ho gayi
        });

        res.json({ success: true, message: "Supporting station dispatched!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 1. Assign or Re-Assign Resources
const assignResources = async (req, res) => {
    try {
        const { caseId, stationId, supportingStationIds, status } = req.body;
 
        if (!caseId || !stationId) {
            return res.status(400).json({ success: false, message: "Case ID and Primary Station are required" });
        }
 
        const updatedCase = await FireCase.findByIdAndUpdate(
            caseId,
            {
                $set: {
                    stationId: stationId,
                    supportingStations: supportingStationIds || [],
                    status: status || 'Pending',
                    dispatchedAt: Date.now()
                }
            },
            { new: true }
        ).populate('stationId supportingStations');
 
        res.json({
            success: true,
            message: "Case assigned to stations successfully",
            data: updatedCase
        });
    } catch (error) {
        // FIX: error. Message typo ko error.message kiya
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllStationsForHQ = async (req, res) => {
    try {
        // Query mein 'isUpdateRequested: true' add kiya gaya hai
        const pendingRequests = await FireStation.find({
            hqId: req.user.id,
            isUpdateRequested: true
        })
        .select('stationName stationCode isUpdateRequested jurisdiction requestDate primarySectors');
 
        res.json({
            success: true,
            count: pendingRequests.length,
            message: pendingRequests.length > 0 ? "Pending update requests found" : "No pending requests",
            data: pendingRequests
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
const approveAndUpdateJurisdiction = async (req, res) => {
    try {
        const { stationId } = req.params;
        const { jurisdiction, primarySectors } = req.body;
 
        // 1. Station ko find karein
        const station = await FireStation.findById(stationId);
 
        if (!station) {
            return res.status(404).json({ success: false, message: "Station not found" });
        }
 
        // 2. Jurisdiction Update karein (Field by field)
        if (jurisdiction) {
            station.jurisdiction.totalArea = jurisdiction.totalArea || station.jurisdiction.totalArea;
            station.jurisdiction.population = jurisdiction.population || station.jurisdiction.population;
            station.jurisdiction.activeZones = jurisdiction.activeZones || station.jurisdiction.activeZones;
            station.jurisdiction.riskLevel = jurisdiction.riskLevel || station.jurisdiction.riskLevel;
        }
        if (primarySectors && Array.isArray(primarySectors)) {
            // Purane sectors hata kar naye sectors daalna
            station.primarySectors = primarySectors;
        }
 
        // 4. Request status reset karein
        station.isUpdateRequested = false;
 
        const savedStation = await station.save();
 
        res.json({
            success: true,
            message: "Jurisdiction & Sectors Updated Successfully",
            data: savedStation
        });
 
    } catch (error) {
        console.error("Update Error:", error);
        res.status(500).json({
            success: false,
            message: "Server Error: " + error.message
        });
    }
};
 const getSpecificCaseDetails = async (req, res) => {
    try {
        const { id } = req.params; // Route se ID uthayi
 
        // 1. Validation check
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Case ID format" });
        }
 
        // 2. Fetch case with all populates
        const incident = await FireCase.findById(id)
            .populate('stationId', 'stationName')
            .populate('assignedStaff', 'fullName rank phone')
            .populate('assignedVehicles', 'vehicleName vehicleNumber assetId')
            .populate('supportingStations', 'stationName phone');
 
        if (!incident) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }
 
        // 3. Logic for 'displayStatus' (Matching your JSON example)
        let displayStatus = incident.status;
        if (incident.status === 'Closed') displayStatus = "Investigation Completed";
        else if (incident.status === 'Archived') displayStatus = "Case Archived";
        else if (incident.status === 'Pending') displayStatus = "In Progress";
        else if (incident.status === 'Fresh') displayStatus = "New Incident Reported";
        else if (incident.status === 'Under Control') displayStatus = "Fire Contained";
        else if (incident.status === 'Critical') displayStatus = "Emergency Critical";
 
        // 4. Logic for 'timeAgo'
        const diffInMs = new Date() - new Date(incident.reportedAt);
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
        const timeAgo = diffInDays === 0 ? "Today" : `${diffInDays} Days Ago`;
 
        // 5. Final Response Structure
        res.json({
            success: true,
            data: {
                ...incident._doc,
                id: incident._id,
                timeAgo: timeAgo,
                displayStatus: displayStatus,
                // Default values agar data missing ho
                resourcesUsed: incident.resourcesUsed || { trucksAssigned: 0, personnelCount: 0, equipmentList: [] },
                damageImpact: incident.damageImpact || { injuries: 0, casualties: 0, damageLevel: 'Minor' }
            }
        });
 
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = { getDashboardStats,createFireCase,getIncidentDetails,createFireStation,
     getMyStations, getCaseHistory, getAdminContact, updateFireStation, deleteFireStation,
     updateJurisdiction, getJurisdictionData,requestBoundaryUpdate, getFullIncidentReport, getStationDetails,
     getHQNotifications, deleteHQNotification, reassignFireCase, getDashboardChartData, 
     markAllNotificationsRead, getBackupRequests, assignBackupStation,
      getNearbyStationsForIncident, assignResources,getAllStationsForHQ, approveAndUpdateJurisdiction,getSpecificCaseDetails };