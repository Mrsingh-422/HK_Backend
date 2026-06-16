const PoliceStation = require('../../../models/PoliceStation');
const PoliceStaff = require('../../../models/PoliceStaff');
const PoliceCase = require('../../../models/PoliceCase');
const LeaveRequest = require('../../../models/LeaveRequest');
const Notification = require('../../../models/PoliceNotification');
const {getDistance} = require('../../../utils/helpers')
const bcrypt = require('bcryptjs');
 
// --- 1. DASHBOARD (Screen 1) ---
const getStationDashboard = async (req, res) => {
    try {
        const stationId = req.user.id;

        const stats = {
            // Newly dispatched cases
            fresh: await PoliceCase.countDocuments({ 
                stationId, 
                status: 'Fresh' 
            }),
            // Ongoing, Critical, and On Hold cases grouped together under 'Pending'
            pending: await PoliceCase.countDocuments({ 
                stationId, 
                status: { $in: ['Pending', 'Under Investigation', 'On Hold', 'Critical'] } 
            }),
            // Completed and Archived history cases
            closed: await PoliceCase.countDocuments({ 
                stationId, 
                status: { $in: ['Closed', 'Archived'] } 
            })
        };

        res.json({
            success: true,
            data: {
                welcomeName: req.user.shoName,
                profilePic: req.user.profileImage,
                stats
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

 
// --- 2. STAFF MANAGEMENT (Screens 13, 14, 15, 16) ---
 
const addStaff = async (req, res) => {
    try {
        const { fullName, badgeId, rank, mobileNumber, officialEmail, address, password } = req.body;
        const exists = await PoliceStaff.findOne({ $or: [{ badgeId }, { officialEmail }] });
        if (exists) return res.status(400).json({ message: "Staff with this Badge ID or Email already exists" });
 
        const hashedPassword = await bcrypt.hash(password, 10);
        const staff = await PoliceStaff.create({
            stationId: req.user.id,
            hqId: req.user.hqId,
            fullName, badgeId, rank, mobileNumber, officialEmail, address,
            password: hashedPassword,
            profileImage: req.file ? `/uploads/police_staff/${req.file.filename}` : null
        });
 
        res.status(201).json({ success: true, message: "Staff Added Successfully", data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const updateStaff = async (req, res) => {
    try {
        const updates = req.body;
        if (req.file) updates.profileImage = `/uploads/police_staff/${req.file.filename}`;
        
        const staff = await PoliceStaff.findByIdAndUpdate(req.params.id, updates, { new: true });
        res.json({ success: true, message: "Staff updated", data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const removeStaff = async (req, res) => {
    try {
        const { reason, otherReason } = req.body; // From Screen 16
        const staff = await PoliceStaff.findByIdAndUpdate(req.params.id, {
            isActive: false,
            status: 'Inactive',
            deletionReason: reason === 'Other reason' ? otherReason : reason
        });
        res.json({ success: true, message: "Staff removed from active list" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// // Get Staff for Assignment Selection (Screen 24 & 25)
// const getStaffList = async (req, res) => {
//     try {
//         const { search } = req.query;
//         let query = { stationId: req.user.id, isActive: true };
        
//         if (search) {
//             query.$or = [
//                 { fullName: { $regex: search, $options: 'i' } },
//                 { badgeId: { $regex: search, $options: 'i' } }
//             ];
//         }
 
//         const staff = await PoliceStaff.find(query);
//         res.json({ success: true, data: staff });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };
 
const getStaffList = async (req, res) => {
    try {
        const staff = await PoliceStaff.find({ stationId: req.user.id});
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// --- 3. CASE MANAGEMENT (Screens 4, 11, 24, 25) ---
 
const getStationCases = async (req, res) => {
    try {
        const { status, priority, search } = req.query;
        let query = { stationId: req.user.id };
 
        if (status) query.status = status;
        if (priority && priority !== 'All') query.severity = priority;
        if (search) query.caseNo = { $regex: search, $options: 'i' };
 
        const cases = await PoliceCase.find(query)
            .populate('assignedStaff')
            .sort({ createdAt: -1 });
 
        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const acceptCase = async (req, res) => {
    try {
        const updatedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            { status: 'Accepted', 'progress.isAccepted': true },
            { new: true }
        );
        res.json({ success: true, message: "Case Accepted", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// Assign/Re-assign Staff (Screen 24/25/26)
const assignStaffToCase = async (req, res) => {
    try {
        const { caseId, staffIds } = req.body; // Array of IDs for supporting staff
        
        // We update the primary officer (index 0) and supporting staff
        const updatedCase = await PoliceCase.findByIdAndUpdate(caseId, {
            assignedStaff: staffIds[0], // Lead Officer
            supportingStaff: staffIds.slice(1), // Array of other officers
            status: 'Pending'
        }, { new: true });
 
        res.json({ success: true, message: "Staff Assigned to Case", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const updateCaseProgress = async (req, res) => {
    try {
        const { step } = req.body; // e.g., 'isSiteVisited'
        const update = { status: 'Under Investigation' };
        update[`progress.${step}`] = true;
 
        const pCase = await PoliceCase.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json({ success: true, data: pCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const closeCase = async (req, res) => {
    try {
        const pCase = await PoliceCase.findByIdAndUpdate(req.params.id, {
            status: 'Closed',
            closedAt: Date.now()
        }, { new: true });
        res.json({ success: true, message: "Case Closed Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// --- 4. ROSTER & LEAVE (Screens 2, 7, 8, 9, 10) ---
 
const getStaffRoster = async (req, res) => {
    try {
        const staff = await PoliceStaff.find({ stationId: req.user.id });
        res.json({
            success: true,
            data: {
                onDuty: staff.filter(s => s.status === 'On Duty'),
                onLeave: staff.filter(s => s.status === 'On Leave'),
                offDuty: staff.filter(s => s.status === 'Off Duty'),
                counts: {
                    onDuty: staff.filter(s => s.status === 'On Duty').length,
                    onLeave: staff.filter(s => s.status === 'On Leave').length,
                    weeklyOff: staff.filter(s => s.status === 'Off Duty').length
                }
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const manageLeaveRequest = async (req, res) => {
    try {
        const { status, rejectionReason } = req.body;
        const leave = await LeaveRequest.findById(req.params.id);
        if (!leave) return res.status(404).json({ message: "Request not found" });
 
        leave.status = status;
        if (status === 'Rejected') leave.rejectionReason = rejectionReason;
        await leave.save();
 
        // Update Staff Status automatically
        if (status === 'Approved') {
            await PoliceStaff.findByIdAndUpdate(leave.staffId, { status: 'On Leave' });
        }
 
        res.json({ success: true, message: `Leave ${status} successfully` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
// --- 5. PROFILE & JURISDICTION (Screens 17, 18, 19, 21) ---
 
const getStationProfile = async (req, res) => {
    try {
        const station = await PoliceStation.findById(req.user.id);
        const activeStaff = await PoliceStaff.countDocuments({ stationId: req.user.id, isActive: true });
        
        res.json({
            success: true,
            data: { ...station._doc, activeStaffCount: activeStaff }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const updateStationProfile = async (req, res) => {
    try {
        const updates = req.body;
        if (req.file) updates.profileImage = `/uploads/police_stations/${req.file.filename}`;
        
        const station = await PoliceStation.findByIdAndUpdate(req.user.id, updates, { new: true });
        res.json({ success: true, message: "Profile Updated", data: station });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
 
const getPendingCases = async (req, res) => {
    try {
        const stationId = req.user.id;

        // Dashboard aur is list API ki query bilkul same honi chahiye
        const query = {
            stationId,
            status: { $in: ['Pending', 'Under Investigation', 'On Hold', 'Critical'] }
        };

        const pendingCases = await PoliceCase.find(query)
            .populate('assignedStaff', 'fullName rank badgeId profileImage')
            .sort({ updatedAt: -1 }); // Newest activity first

        res.json({
            success: true,
            count: pendingCases.length,
            data: pendingCases
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

 
const getCaseHistory = async (req, res) => {
    try {
        const stationId = req.user.id;

        // Dashboard closed count aur is history list ki query same honi chahiye
        const query = {
            stationId,
            status: { $in: ['Closed', 'Archived'] }
        };

        const history = await PoliceCase.find(query)
            .populate('assignedStaff', 'fullName rank badgeId profileImage')
            .sort({ resolvedAt: -1, updatedAt: -1 });

        res.json({
            success: true,
            count: history.length,
            data: history
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};




/**
 * 1. GET JURISDICTION AREA DETAILS
 * Figma Link: Screen 21 (Jurisdiction boundary limits & details card)
 */
const getStationJurisdiction = async (req, res) => {
    try {
        const station = await PoliceStation.findById(req.user.id).select('jurisdiction');
        if (!station) {
            return res.status(404).json({ success: false, message: "Station not found" });
        }
        res.json({
            success: true,
            data: station.jurisdiction
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. UPDATE SETTINGS PREFERENCES (TOGGLES)
 * Figma Link: Screen 36 (New FIR Notifications & Emergency Broadcast toggles)
 */
const updateStationPreferences = async (req, res) => {
    try {
        const { newFirNotifications, emergencyBroadcasts } = req.body;
        
        const station = await PoliceStation.findByIdAndUpdate(
            req.user.id,
            {
                $set: {
                    'preferences.newFirNotifications': newFirNotifications,
                    'preferences.emergencyBroadcasts': emergencyBroadcasts
                }
            },
            { new: true }
        ).select('preferences');

        res.json({
            success: true,
            message: "Preferences updated successfully",
            data: station.preferences
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 3. GET ROSTER ACTIVE PENDING REQUESTS (Leaves & Shift changes)
 * Figma Link: Screen 32 (New Request list - All, Leave, Shift Change tabs)
 */
const getRosterRequests = async (req, res) => {
    try {
        const { type } = req.query; // 'Leave', 'Shift Change', or 'All'
        let query = { stationId: req.user.id, status: 'Pending' };

        if (type && type !== 'All') {
            query.requestType = type;
        }

        const requests = await LeaveRequest.find(query)
            .populate('staffId', 'fullName badgeId rank profileImage');

        res.json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 4. MANAGE ROSTER REQUEST (APPROVE / REJECT WITH DETAIL SELECTION)
 * Figma Link: Screen 10 (Leave request accepted modal) & Screen 31 (Reject Request Reason list)
 */
const manageRosterRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body; // Approved or Rejected

        const request = await LeaveRequest.findById(id);
        if (!request) return res.status(404).json({ success: false, message: "Request not found" });

        request.status = status;
        if (status === 'Rejected') {
            request.rejectionReason = rejectionReason;
        }
        await request.save();

        // Update Staff status based on approval
        if (status === 'Approved') {
            const statusToSet = request.requestType === 'Leave' ? 'On Leave' : 'On Duty';
            await PoliceStaff.findByIdAndUpdate(request.staffId, { status: statusToSet });
        }

        res.json({
            success: true,
            message: `Roster request ${request.requestType} marked as ${status}`,
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 5. GET STATIONS SCOPE CASE HISTORY (WITH TRANSFERRED FILTER)
 * Figma Link: Screen 12 (History list - tabs: Closed vs Transferred)
 */
const getStationCaseHistoryFiltered = async (req, res) => {
    try {
        const { tab, search } = req.query; // 'Closed' or 'Transferred'
        let query = { stationId: req.user.id };

        if (tab === 'Transferred') {
            // Case is transferred if emergencyOverride is active or has supporting stations
            query.status = { $in: ['Archived'] };
            query.emergencyOverride = true;
        } else {
            // Default Closed
            query.status = 'Closed';
        }

        if (search) {
            query.caseNo = { $regex: search, $options: 'i' };
        }

        const cases = await PoliceCase.find(query)
            .populate('assignedStaff', 'fullName rank badgeId')
            .populate('supportingStations', 'stationName stationCode')
            .sort({ resolvedAt: -1 });

        res.json({
            success: true,
            count: cases.length,
            data: cases
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 6. UPDATE DETAILED CASE STATUS (WITH ATTACHMENT)
 * Figma Link: Screen 17 & 40 (Case status checkbox options, remarks & document attach)
 */
const updateCaseStatusDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const { severityStatus, remarks } = req.body; // e.g. "Suspect Arrested", "Evidence Collected"

        const updateObj = {
            severityStatus
        };

        if (remarks) updateObj.remarks = remarks;

        // If file uploaded, push to evidence array
        if (req.file) {
            const newDoc = {
                fileName: req.file.originalname,
                fileUrl: `/uploads/police_evidence/${req.file.filename}`,
                fileType: req.file.mimetype.startsWith('image/') ? 'Image' : 'Document',
                uploadedAt: Date.now()
            };
            await PoliceCase.findByIdAndUpdate(id, { $push: { evidence: newDoc } });
        }

        const updatedCase = await PoliceCase.findByIdAndUpdate(id, { $set: updateObj }, { new: true });

        res.json({
            success: true,
            message: "Case status milestone updated",
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 7. GET NEARBY POLICE STATIONS MAP TO CURRENT CASE ID
 * Figma Link: Screen 9 (List of nearby police stations with load count and distance)
 */
const getNearbyStationsForCase = async (req, res) => {
    try {
        const { id } = req.params;
        const { search } = req.query;

        const currentCase = await PoliceCase.findById(id);
        if (!currentCase) {
            return res.status(404).json({ success: false, message: "Case details not found" });
        }

        const caseLat = currentCase.location.lat;
        const caseLng = currentCase.location.lng;

        let query = { _id: { $ne: req.user.id }, isActive: true }; // Excluding own station
        if (search) {
            query.stationName = { $regex: search, $options: 'i' };
        }

        const stations = await PoliceStation.find(query);

        const mapProximity = await Promise.all(
            stations.map(async (stn) => {
                const distanceKM = await getDistance(caseLat, caseLng, stn.location.lat, stn.location.lng);
                
                // Fetch mock available units dynamically for production
                const activeUnitsCount = await PoliceStaff.countDocuments({ stationId: stn._id, status: 'On Duty' });

                return {
                    _id: stn._id,
                    stationName: stn.stationName,
                    address: stn.address,
                    distance: `${distanceKM} km away`,
                    activeUnits: activeUnitsCount || 5, // Mock default fallback
                    availabilityText: activeUnitsCount > 3 ? "Available Units" : "Low Availability"
                };
            })
        );

        // Sort nearest first
        mapProximity.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        res.json({
            success: true,
            data: mapProximity
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * 1. GET DETAILED STAFF ROSTER BY SHIFTS
 * Figma Link: Screen 39 (14 On Duty, 4 On Leave counters & Shift A/B grouped layouts)
 */
const getStaffRosterDetailed = async (req, res) => {
    try {
        const staff = await PoliceStaff.find({ stationId: req.user.id });

        // Grouping logic for Figma Screen 39
        const shiftA = staff.filter(s => s.shift === 'Shift A (08:00 - 16:00)' && s.status === 'On Duty');
        const shiftB = staff.filter(s => s.shift === 'Shift B (16:00 - 00:00)' && s.status === 'On Duty');
        const onLeaveOrOff = staff.filter(s => s.status === 'On Leave' || s.status === 'Suspended' || s.shift === 'Off Duty');

        // Formatted shifts payload with check-in time representation
        const formatRosterMember = (member) => ({
            _id: member._id,
            fullName: member.fullName,
            rank: member.rank,
            profileImage: member.profileImage,
            status: member.status === 'On Leave' ? 'SICK LEAVE' : 'PRESENT',
            checkInTime: member.lastCheckIn ? moment(member.lastCheckIn).format('hh:mm A') : "08:00 AM"
        });

        res.json({
            success: true,
            data: {
                counts: {
                    onDuty: staff.filter(s => s.status === 'On Duty').length,
                    onLeave: staff.filter(s => s.status === 'On Leave').length,
                    weeklyOff: staff.filter(s => s.shift === 'Off Duty').length
                },
                shifts: {
                    shiftA: shiftA.map(formatRosterMember),
                    shiftB: shiftB.map(m => ({ ...formatRosterMember(m), status: 'SCHEDULED' })), // Upcoming is scheduled
                    onLeaveOrOff: onLeaveOrOff.map(m => ({
                        ...formatRosterMember(m),
                        status: m.status === 'On Leave' ? 'SICK LEAVE' : 'OFF DUTY'
                    }))
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. TRANSFER CASE (Jurisdiction Change / Department Cell Shift)
 * Figma Link: Screen 12 (Transferred Tab) & Screen 45 (Transferred Case Summary Details)
 */
const transferCaseToStation = async (req, res) => {
    try {
        const { id } = req.params; // caseId
        const { targetStationId, transferReason } = req.body;

        // Destination existence check
        const targetStation = await PoliceStation.findById(targetStationId);
        if (!targetStation) {
            return res.status(404).json({ success: false, message: "Target Police Station/Cell not found." });
        }

        const updatedCase = await PoliceCase.findByIdAndUpdate(
            id,
            {
                $set: {
                    stationId: targetStationId, // Reallocate station reference
                    status: 'Archived',         // Status moves to Archived under current station history
                    emergencyOverride: true,    // Logged for Transferred history filter
                    'transferDetails.transferredTo': targetStationId,
                    'transferDetails.transferredReason': transferReason || "Jurisdiction Change",
                    'transferDetails.transferredBy': req.user.id, // Current logged-in SHO
                    'transferDetails.transferredAt': Date.now()
                }
            },
            { new: true }
        );

        res.json({
            success: true,
            message: `Case successfully transferred to ${targetStation.stationName}`,
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * 1. UPDATE CASE STATUS (Checklist & Remarks)
 * Figma Link: Screen 28 ("Update Status" click opens checklist Screen 17 & 40)
 */
const updateCaseStatusStation = async (req, res) => {
    try {
        const { id } = req.params;
        const { milestoneStatus, remarks, status } = req.body; 
        // milestoneStatus e.g., "Site Visit Completed", "Suspect Identified", "Investigation Ongoing"
        // status e.g., "On Hold", "Under Investigation", "Critical"

        const updateData = {};
        
        if (status) {
            updateData.status = status;
        }
        
        if (milestoneStatus) {
            updateData.severityStatus = milestoneStatus; // Mapped to severityStatus
            
            // Auto update progress schema indicators
            if (milestoneStatus === "Site Visit Completed") {
                updateData['progress.isSiteVisited'] = true;
            } else if (milestoneStatus === "Evidence Collected") {
                updateData['progress.isEvidenceCollected'] = true;
            }
        }

        if (remarks) {
            updateData.remarks = remarks;
        }

        const updatedCase = await PoliceCase.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        res.json({
            success: true,
            message: "Case investigation status updated successfully",
            data: updatedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. ADD EVIDENCE (Media Upload, Dropdown Type & Description)
 * Figma Link: Screen 28 ("Add Evidence" button click opens Screen 8)
 */
const addEvidenceStation = async (req, res) => {
    try {
        const { id } = req.params;
        const { evidenceType, description } = req.body;
       
        // Smart Check: Accept both req.file (single) and req.files (array)
        const uploadedFiles = req.file ? [req.file] : (req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : []);
 
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ success: false, message: "Please upload at least one evidence file" });
        }
 
        const caseData = await PoliceCase.findById(id);
        if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
 
        uploadedFiles.forEach(file => {
            caseData.evidence.push({
                fileName: file.originalname,
                fileUrl: `/uploads/police_evidence/${file.filename}`,
                fileType: evidenceType || (file.mimetype.startsWith('image/') ? 'Image' : 'Document'),
                fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
                uploadedAt: Date.now()
            });
        });
 
        caseData.progress.isEvidenceCollected = true;
        if (description) caseData.remarks = description;
 
        await caseData.save();
 
        res.json({ success: true, message: "Evidence attached successfully", data: caseData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
/**
 * 3. CLOSE CASE WITH ATTACHMENT REPORT (SHO Final Closure)
 * Figma Link: Screen 28 ("Close Case" button opens Screen 11/40)
 */
const closeCaseStation = async (req, res) => {
    try {
        const { id } = req.params;
        const { finalStatus, finalRemarks } = req.body;
 
        const updateData = {
            status: 'Closed',
            'progress.isReportSubmitted': true,
            remarks: finalRemarks || "Case resolved successfully.",
            // Ensure status matches Enum if passing to severityStatus
            resolvedAt: Date.now()
        };
 
        // Smart File Handle
        const uploadedFiles = req.file ? [req.file] : (req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : []);
 
        if (uploadedFiles.length > 0) {
            const reportFile = uploadedFiles[0];
            const finalReportDoc = {
                fileName: reportFile.originalname,
                fileUrl: `/uploads/police_evidence/${reportFile.filename}`,
                fileType: 'Document',
                fileSize: `${(reportFile.size / (1024 * 1024)).toFixed(2)} MB`,
                uploadedAt: Date.now()
            };
            await PoliceCase.findByIdAndUpdate(id, { $push: { evidence: finalReportDoc } });
        }
 
        const closedCase = await PoliceCase.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        if (!closedCase) return res.status(404).json({ success: false, message: "Case not found" });
 
        res.json({ success: true, message: "Case Closed successfully", data: closedCase });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 🚨 MISSING APIs TO MATCH FIGMA FLOW
// ==========================================
 
 
// 1. GET SINGLE CASE SUMMARY (For Station)
const getCaseSummaryStation = async (req, res) => {
    try {
        const caseData = await PoliceCase.findOne({ _id: req.params.id, stationId: req.user.id })
            .populate('assignedStaff', 'fullName rank badgeId profileImage')
            .populate('supportingStations', 'stationName stationCode')
            .populate('transportDetails.ambulanceId')
            .populate('transportDetails.hospitalId');
 
        if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
 
        res.json({ success: true, data: caseData });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// 2. GET & DELETE NOTIFICATIONS (For Station)
const getStationNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ recipientId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, data: notifications });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const deleteStationNotification = async (req, res) => {
    try {
        await Notification.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Notification deleted" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// 3. SEND BACKUP/SUPPORT REQUEST (From Station to another Station)
const requestBackupStation = async (req, res) => {
    try {
        const { supportingStationIds, reason } = req.body;
       
        const updatedCase = await PoliceCase.findOneAndUpdate(
            { _id: req.params.id, stationId: req.user.id },
            {
                $addToSet: { supportingStations: { $each: supportingStationIds } },
                $set: { emergencyOverride: true } // Figma flow indicates override when backup needed
            },
            { new: true }
        );
 
        // Optional: Yahan HQ aur Target Station ko Notification bhejne ka code aayega
       
        res.json({ success: true, message: "Backup request sent successfully", data: updatedCase });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// 4. GET DETAILED OFFICER PROFILE (With Activity)
const getOfficerDetailedProfile = async (req, res) => {
    try {
        const staff = await PoliceStaff.findOne({ _id: req.params.id, stationId: req.user.id });
        if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });
 
        // Get cases assigned to this officer
        const activeCases = await PoliceCase.find({ assignedStaff: staff._id, status: { $ne: 'Closed' } })
            .select('caseNo updatedAt status incidentType');
 
        res.json({
            success: true,
            data: {
                officer: staff,
                stats: {
                    casesAssigned: activeCases.length,
                    attendance: "96%", // Dynamic attendance logic later
                },
                recentActivity: activeCases // Sending as recent activity
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
const getRosterHistory = async (req, res) => {
    try {
        // Aap chaho toh query parameters se filter bhi laga sakte ho (e.g., ?status=Approved)
        const { type, status } = req.query;
       
        let query = {
            stationId: req.user.id,
            status: { $in: ['Approved', 'Rejected'] } // Dono fetch karega by default
        };
 
        // Agar specific status chahiye (Sirf Approved ya sirf Rejected)
        if (status && ['Approved', 'Rejected'].includes(status)) {
            query.status = status;
        }
 
        // Agar specific type chahiye ('Leave' ya 'Shift Change')
        if (type && type !== 'All') {
            query.requestType = type;
        }
 
        const history = await LeaveRequest.find(query)
            .populate('staffId', 'fullName badgeId rank profileImage')
            .sort({ updatedAt: -1 }); // Sabse recent wale upar aayenge
 
        res.json({
            success: true,
            count: history.length,
            data: history
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
/**
 * CREATE CASE (FROM POLICE STATION)
 * Handles new incident registration directly from Police Station
 */
const createStationCase = async (req, res) => {
    try {
        const stationId = req.user.id;
 
        // 1. Fetch Police Station to get its parent hqId
        const station = await PoliceStation.findById(stationId);
        if (!station) {
            return res.status(404).json({ success: false, message: "Police Station not found" });
        }
 
        // 2. Validate required fields
        const { victimName, victimPhone, address, location } = req.body;
        if (!victimName || !victimPhone || !address || !location || !location.lat || !location.lng) {
            return res.status(400).json({
                success: false,
                message: "victimName, victimPhone, address, and location (lat, lng) are required."
            });
        }
 
        // 3. Create Case
        const newCase = await PoliceCase.create({
            ...req.body,
            hqId: station.hqId,   // 👈 HQ ID automatically station se le liya
            stationId: stationId, // 👈 Station ID token se le liya
            status: 'Fresh'     // 👈 Kyunki station khud bana raha hai, toh directly 'Pending' ya 'Under Investigation' me jayega
        });
 
        res.status(201).json({
            success: true,
            message: "Case registered successfully by Police Station",
            data: newCase
        });
    } catch (error) {
        // Handle Mongoose Validation Errors gracefully
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ success: false, message: messages.join(', ') });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// NOTIFICATION APIs
// ==========================================
 
/**
 * 1. CREATE NOTIFICATION (For Testing or Manual Broadcast)
 */
const createStationNotification = async (req, res) => {
    try {
        const { recipientId, recipientRole, type, title, message, relatedItemId } = req.body;
 
        const newNotification = await Notification.create({
            recipientId: recipientId || req.user.id, // Agar id nahi di toh khud ko bhej dega
            recipientRole: recipientRole || 'Police-Station',
            type: type || 'General',
            title,
            message,
            relatedItemId
        });
 
        res.status(201).json({
            success: true,
            message: "Notification created successfully",
            data: newNotification
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
/**
 * 2. MARK ALL NOTIFICATIONS AS READ
 */
const markAllNotificationsRead = async (req, res) => {
    try {
        // Sirf unhi ko update karo jo us user ke hain aur unread hain
        const result = await Notification.updateMany(
            { recipientId: req.user.id, isRead: false },
            { $set: { isRead: true } }
        );
 
        res.json({
            success: true,
            message: "All notifications marked as read",
            updatedCount: result.modifiedCount // Kitne notifications update hue
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// DOCUMENTATION & SUPPORT APIs (Station App)
// ==========================================
 
/**
 * 1. GET APP CONTENT (Help, Privacy, Terms)
 */
const getStationAppContent = async (req, res) => {
    try {
        const { type } = req.params; // 'help', 'privacy', 'terms'
       
        const station = await PoliceStation.findById(req.user.id).select('documentation');
        if (!station || !station.documentation[type]) {
            return res.status(404).json({ success: false, message: "Invalid content type or Station not found" });
        }
 
        res.json({
            success: true,
            data: station.documentation[type] // Specific block bhejenge
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
/**
 * 2. UPDATE APP CONTENT (If Station Admin wants to change Help Phone/Email or Text)
 */
const updateStationAppContent = async (req, res) => {
    try {
        const { type } = req.params; // 'help', 'privacy', 'terms'
        const { title, content, contactPhone, contactEmail } = req.body;
 
        // Dynamic key generation (e.g., "documentation.help.title")
        const updateObj = {};
        if (title) updateObj[`documentation.${type}.title`] = title;
        if (content) updateObj[`documentation.${type}.content`] = content;
        if (contactPhone) updateObj[`documentation.${type}.contactPhone`] = contactPhone;
        if (contactEmail) updateObj[`documentation.${type}.contactEmail`] = contactEmail;
 
        const updatedStation = await PoliceStation.findByIdAndUpdate(
            req.user.id,
            { $set: updateObj },
            { new: true }
        ).select('documentation');
 
        res.json({
            success: true,
            message: `${type} content updated successfully`,
            data: updatedStation.documentation[type]
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
  
module.exports = {
    getStationDashboard,addStaff,
    updateStaff,getStaffList,removeStaff,
    getStationCases,acceptCase,
    assignStaffToCase,updateCaseProgress,closeCase,getStaffRoster,
    manageLeaveRequest,getStationProfile,
    updateStationProfile, getPendingCases, getCaseHistory,

    // 🚨 Naye Figma Handlers
    getStationJurisdiction,
    updateStationPreferences,
    getRosterRequests,
    manageRosterRequest,
    getStationCaseHistoryFiltered,
    updateCaseStatusDetail,
    getNearbyStationsForCase, getStaffRosterDetailed, transferCaseToStation,
    updateCaseStatusStation,
    addEvidenceStation,
    closeCaseStation,
    createStationNotification,
    markAllNotificationsRead,
    getStationAppContent,
    updateStationAppContent,
    getCaseSummaryStation,
    getStationNotifications,
    deleteStationNotification,
    requestBackupStation,
    getOfficerDetailedProfile,
    getRosterHistory,
    createStationCase
    
};
 