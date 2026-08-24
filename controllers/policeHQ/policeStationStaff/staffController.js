const PoliceStaff = require('../../../models/PoliceStaff');
const PoliceCase = require('../../../models/PoliceCase');
const LeaveRequest = require('../../../models/LeaveRequest');
const bcrypt = require('bcryptjs');
const moment = require('moment'); // Required for "Running: X Days" logic
 
// --- DASHBOARD (Screen 1) ---
const getStaffDashboard = async (req, res) => {
    try {
        const staffId = req.user.id;

        const stats = {
            fresh: await PoliceCase.countDocuments({ 
                assignedStaff: staffId, 
                status: { $in: ['Fresh', 'Pending'] } // 👈 Unified Query
            }),
            pending: await PoliceCase.countDocuments({ 
                assignedStaff: staffId, 
                status: { $in: ['Under Investigation', 'On Hold', 'Critical'] } // 👈 Unified Query
            }),
            closed: await PoliceCase.countDocuments({ 
                assignedStaff: staffId, 
                status: { $in: ['Closed', 'Archived'] } // 👈 Unified Query
            })
        };

        res.json({
            success: true,
            data: {
                officerName: req.user.fullName,
                badgeId: req.user.badgeId,
                profileImage: req.user.profileImage,
                stats
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

 
// --- CASE MANAGEMENT (Screens 10, 12, 19) ---
 
const getAssignedCases = async (req, res) => {
    try {
        const { priority, search, status } = req.query;
        let query = { assignedStaff: req.user.id };
 
        if (status) {
            if (status === 'Fresh') {
                query.status = { $in: ['Fresh', 'Pending'] };
            } else {
                query.status = status;
            }
        }
        if (priority && priority !== 'All') query.severity = priority;
        if (search) query.caseNo = new RegExp(search, 'i');
 
        const cases = await PoliceCase.find(query).sort({ createdAt: -1 });
 
        // FIX: Safe object destructuring taaki null/lean query par crash na ho
        const formattedCases = cases.map(c => {
            const doc = c._doc ? c._doc : c;
            const start = moment(doc.updatedAt || doc.createdAt || Date.now());
            const now = moment();
            return {
                ...doc,
                runningDays: now.diff(start, 'days') || 0
            };
        });
 
        res.json({ success: true, data: formattedCases });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
 
// Accept Case (Image 12)
const acceptCase = async (req, res) => {
    try {
        const updatedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            { status: 'Under Investigation', 'progress.isAccepted': true },
            { new: true }
        );
        res.json({ success: true, message: "Case Accepted", data: updatedCase });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Update Progress Dots (Image 19)
const updateProgressStep = async (req, res) => {
    try {
        const { step } = req.body; // 'isSiteVisited', 'isReportSubmitted'
        const update = {};
        update[`progress.${step}`] = true;
 
        const updatedCase = await PoliceCase.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json({ success: true, message: "Progress Updated", data: updatedCase });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Add Evidence / Attach Document (Image 7)
const uploadEvidence = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
 
        const pcase = await PoliceCase.findById(req.params.id);
        const newEvidence = {
            fileName: req.file.originalname,
            fileUrl: `/uploads/police_staff/${req.file.filename}`,
            fileType: req.file.mimetype.split('/')[1],
            uploadedAt: Date.now()
        };
 
        pcase.evidence.push(newEvidence);
        pcase.progress.isEvidenceCollected = true;
        await pcase.save();
 
        res.json({ success: true, message: "Document Attached Successfully", data: pcase });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const closeCase = async (req, res) => {
    try {
        const closedCase = await PoliceCase.findByIdAndUpdate(
            req.params.id,
            { status: 'Closed', 'progress.isReportSubmitted': true },
            { new: true }
        );
        res.json({ success: true, message: "Case Closed Successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- OFFICER PROFILE (Screen 26) ---
const getDetailedProfile = async (req, res) => {
    try {
        const staffId = req.user.id;
        const staff = await PoliceStaff.findById(staffId).populate('stationId');
 
        const activeCases = await PoliceCase.countDocuments({ assignedStaff: staffId, status: 'Under Investigation' });
        
        // Fetch last activities for "Recent Activity" list
        const activity = await PoliceCase.find({ assignedStaff: staffId })
            .sort({ updatedAt: -1 })
            .limit(5);
 
        res.json({
            success: true,
            data: {
                fullName: staff.fullName,
                rank: staff.rank,
                badgeId: staff.badgeId,
                stationName: staff.stationId.stationName,
                joiningDate: staff.createdAt,
                stats: {
                    activeCases,
                    attendance: "96%", // Mocked as per Figma
                },
                recentActivity: activity
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- PROFILE SETTINGS (Screens 8, 9) ---
 
const updateProfile = async (req, res) => {
    try {
        const updates = req.body;
        if (req.file) updates.profileImage = `/uploads/police_staff/${req.file.filename}`;
 
        const updated = await PoliceStaff.findByIdAndUpdate(req.user.id, updates, { new: true });
        res.json({ success: true, message: "Profile Updated Successfully", data: updated });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const staff = await PoliceStaff.findById(req.user.id).select('+password');
        
        const isMatch = await bcrypt.compare(oldPassword, staff.password);
        if (!isMatch) return res.status(400).json({ message: "Current password is wrong" });
 
        staff.password = await bcrypt.hash(newPassword, 10);
        await staff.save();
        res.json({ success: true, message: "Password Changed" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// --- LEAVE REQUEST (Screens 5, 6) ---
const submitLeave = async (req, res) => {
    try {
        const { leaveType, duration, startDate, endDate, reason } = req.body;
        const leave = await LeaveRequest.create({
            stationId: req.user.stationId,
            staffId: req.user.id,
            leaveType, duration, startDate, endDate, reason
        });
        res.status(201).json({ success: true, message: "Leave Request Submitted", data: leave });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
/**
 * 1. SHIFT CHECK-IN (On-Duty Activation)
 * Figma Link: Screen 37 (Shift Check-in tracking & On Duty active timing update)
 */
const checkInShift = async (req, res) => {
    try {
        const staffId = req.user.id;

        // Set status to On Duty and record current timestamp as lastCheckIn
        const updatedStaff = await PoliceStaff.findByIdAndUpdate(
            staffId,
            {
                $set: {
                    status: 'On Duty',
                    lastCheckIn: Date.now()
                }
            },
            { new: true }
        );

        res.json({
            success: true,
            message: "Shift Checked-in successfully",
            data: {
                fullName: updatedStaff.fullName,
                status: updatedStaff.status,
                lastCheckIn: updatedStaff.lastCheckIn
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. SUBMIT ROSTER REQUEST (Leave, Present, Shift Change, Overtime)
 * Figma Link: Screen 41 (Present Tab), Screen 43 (Leave Tab with Medical Certificate upload)
 */
const submitRosterRequest = async (req, res) => {
    try {
        const { requestType, leaveType, duration, startDate, endDate, reason, fromShift, toShift } = req.body;

        const requestPayload = {
            stationId: req.user.stationId,
            staffId: req.user.id,
            requestType: requestType || 'Leave',
            duration: duration || "1 Day",
            startDate,
            endDate,
            reason
        };

        // Figma Screen 43: Medical Certificate Attachment handling (Optional)
        if (req.file) {
            requestPayload.reason += ` | Attachment: /uploads/police_staff/${req.file.filename}`;
        }

        // Schema validation compatibility (leaveType is required in Mongoose Schema)
        if (requestType === 'Shift Change' || requestType === 'Present') {
            requestPayload.leaveType = 'Casual Leave'; // Fallback mapping to satisfy schema schema validator
            requestPayload.shiftDetails = {
                fromShift: fromShift || 'Morning',
                toShift: toShift || 'Night'
            };
        } else {
            requestPayload.leaveType = leaveType || 'Sick Leave';
        }

        const leave = await LeaveRequest.create(requestPayload);

        res.status(201).json({
            success: true,
            message: `${requestType || 'Leave'} Request Submitted successfully`,
            data: leave
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 3. CLOSE CASE WITH REMARKS & FINAL REPORT FILE
 * Figma Link: Screen 40 (Close Case page - status dropdown, final remarks text, and report file upload)
 */
const closeCaseWithReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks, severityStatus } = req.body; // severityStatus: 'Suspect Arrested', 'False Report' etc.

        const updateData = {
            status: 'Closed',
            'progress.isReportSubmitted': true,
            remarks: remarks || "Case resolved smoothly.",
            severityStatus: severityStatus || "Resolved",
            resolvedAt: Date.now()
        };

        // Image 40: Optional Final Report file PDF/DOCX handling
        if (req.file) {
            const finalReportDoc = {
                fileName: req.file.originalname,
                fileUrl: `/uploads/police_staff/${req.file.filename}`,
                fileType: 'Document',
                fileSize: `${(req.file.size / (1024 * 1024)).toFixed(2)} MB`,
                uploadedAt: Date.now()
            };
            // Pushing the final report to the evidence array as a validated Document
            await PoliceCase.findByIdAndUpdate(id, { $push: { evidence: finalReportDoc } });
        }

        const closedCase = await PoliceCase.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true }
        );

        if (!closedCase) {
            return res.status(404).json({ success: false, message: "Case not found" });
        }

        res.json({
            success: true,
            message: "Case Closed Successfully with final report registration",
            data: closedCase
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 1. UPDATE DETAILED CASE STATUS (On-Ground Progress)
 * Figma Link: Screen 40/17 (Using req.files array)
 */
const updateStaffCaseStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { statusStep, remarks } = req.body; 

        const allowedSteps = [
            'Site Visit Completed', 
            'Evidence Collected', 
            'Suspect Identified', 
            'Suspect Arrested', 
            'Awaiting Approval', 
            'Investigation Ongoing'
        ];

        if (!statusStep || !allowedSteps.includes(statusStep)) {
            return res.status(400).json({ success: false, message: "Invalid status step value." });
        }

        const caseData = await PoliceCase.findById(id);
        if (!caseData) {
            return res.status(404).json({ success: false, message: "Case not found." });
        }

        if (statusStep === 'Site Visit Completed') {
            caseData.progress.isSiteVisited = true;
        } else if (statusStep === 'Evidence Collected') {
            caseData.progress.isEvidenceCollected = true;
        } else if (statusStep === 'Suspect Arrested') {
            caseData.legalProgress.arrestStatus = 'Arrested';
        }

        caseData.severityStatus = statusStep;
        
        if (remarks) {
            caseData.remarks = `[Milestone: ${statusStep}] - ${remarks}\n` + (caseData.remarks || '');
        }

        // FIX: Safe array extraction jo single file aur multi-file dono accept kare bina crash hue
        const filesList = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : (req.file ? [req.file] : []);

        if (filesList.length > 0) {
            filesList.forEach(file => {
                let cleanPath = file.path.replace(/\\/g, '/');
                cleanPath = cleanPath.startsWith('public/') ? cleanPath.replace('public/', '/') : (cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath);

                caseData.evidence.push({
                    fileName: file.originalname,
                    fileUrl: cleanPath,
                    fileType: file.mimetype.startsWith('image/') ? 'Image' : 'Document',
                    fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
                    uploadedAt: Date.now()
                });
            });
        }

        await caseData.save();

        res.json({
            success: true,
            message: `Case progress status updated to: ${statusStep}`,
            data: caseData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 2. ADD EVIDENCE / UPLOAD MEDIA FROM GROUND STAFF
 * Figma Link: Card Button "Add Evidence" -> Screen 8 (Using req.files array)
 */
const addStaffCaseEvidence = async (req, res) => {
    try {
        const { id } = req.params;
        const { evidenceType, description } = req.body;

        // FIX: Safe multi-part handler
        const filesList = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : (req.file ? [req.file] : []);

        if (filesList.length === 0) {
            return res.status(400).json({ success: false, message: "Please upload at least one evidence file." });
        }

        const allowedEvidenceTypes = ['Photo', 'Video', 'FIR Copy', 'Witness Statement', 'Forensic Report'];
        if (!evidenceType || !allowedEvidenceTypes.includes(evidenceType)) {
            return res.status(400).json({ success: false, message: "Invalid evidence type value." });
        }

        const caseData = await PoliceCase.findById(id);
        if (!caseData) {
            return res.status(404).json({ success: false, message: "Case not found." });
        }

        filesList.forEach(file => {
            let schemaFileType = 'Document';
            if (file.mimetype.startsWith('image/')) schemaFileType = 'Image';
            else if (file.mimetype.startsWith('video/')) schemaFileType = 'Video';

            let cleanPath = file.path.replace(/\\/g, '/');
            cleanPath = cleanPath.startsWith('public/') ? cleanPath.replace('public/', '/') : (cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath);

            caseData.evidence.push({
                fileName: file.originalname,
                fileUrl: cleanPath,
                fileType: schemaFileType,
                fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
                uploadedAt: Date.now()
            });
        });

        caseData.progress.isEvidenceCollected = true;
        caseData.remarks = `[Evidence Attached: ${evidenceType}] - ${description || 'No description'}\n` + (caseData.remarks || '');
        
        await caseData.save();

        res.json({
            success: true,
            message: `${filesList.length} Evidence file(s) successfully submitted`,
            data: caseData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



/**
 * GET STAFF CASE HISTORY (Closed vs Transferred)
 * Figma Link: Screen 12 (History page - tabs: Closed vs Transferred)
 */
const getStaffCaseHistory = async (req, res) => {
    try {
        const staffId = req.user.id;
        const { tab, search } = req.query; // Expects 'Closed' or 'Transferred'
        let query = { assignedStaff: staffId };

        if (tab === 'Transferred') {
            query.status = 'Archived';
            query.emergencyOverride = true; // Logged for transferred scope
        } else {
            query.status = 'Closed';
        }

        if (search) {
            query.caseNo = new RegExp(search, 'i');
        }

        const cases = await PoliceCase.find(query)
            .populate('stationId', 'stationName stationCode shoName')
            .populate('transferDetails.transferredTo', 'stationName stationCode shoName')
            .sort({ resolvedAt: -1, updatedAt: -1 });

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
 * 4. GET STAFF NOTIFICATIONS
 * Figma Link: Dashboard (Image 3) Notification Bell Click
 */
const getStaffNotifications = async (req, res) => {
    try {
        // Agar aapke database me notification schema ho:
        // const list = await Notification.find({ recipientId: req.user.id }).sort({ createdAt: -1 });
        res.json({
            success: true,
            message: "Notifications fetched successfully",
            data: [] // Initial empty array matching Figma screens
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 5. MARK ALL STAFF NOTIFICATIONS AS READ
 * Figma Link: Today/Yesterday Notification Screen -> Mark all read button
 */
const markAllStaffNotificationsRead = async (req, res) => {
    try {
        res.json({
            success: true,
            message: "All notifications marked as read successfully"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 6. DELETE STAFF NOTIFICATION
 * Figma Link: Notification row -> Swipe Left delete trash bin click
 */
const deleteStaffNotification = async (req, res) => {
    try {
        res.json({
            success: true,
            message: "Notification deleted successfully"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    getStaffDashboard,
    getAssignedCases,
    acceptCase,
    updateProgressStep,
    uploadEvidence,
    closeCase,
    getDetailedProfile,
    updateProfile,
    changePassword,
    submitLeave,

    checkInShift,
    submitRosterRequest,
    closeCaseWithReport,updateStaffCaseStatus ,addStaffCaseEvidence,getStaffCaseHistory,
    getStaffNotifications,
    markAllStaffNotificationsRead,
    deleteStaffNotification

};