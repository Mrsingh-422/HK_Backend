const Issue = require('../../models/Issue');
const { notifyAdminsAndVendor } = require('../../utils/notification');

// Helper: Determine Model from authenticated req.user
const getReporterModel = (user) => {
    if (!user) return 'User';
    const role = user.role;

    if (role === 'user') return 'User';
    if (role === 'doctor' || role === 'hospital-doctor') return 'Doctor';
    if (role === 'hospital') return 'Hospital';
    if (role === 'lab') return 'Lab';
    if (role === 'pharmacy') return 'Pharmacy';
    if (role === 'nurse') return 'Nurse';
    if (role === 'ambulance' || role === 'hospital-ambulance') return 'Ambulance';
    if (role === 'driver') return 'Driver';

    // Provider Role (Lab / Pharmacy / Nurse)
    if (role === 'provider' || !role) {
        if (user.labName || user.testsOffered !== undefined) return 'Lab';
        if (user.pharmacyName || user.drugLicenseNumber !== undefined) return 'Pharmacy';
        if (user.nursingCertificates || user.speciality !== undefined) return 'Nurse';
    }

    // 🚒 Fire Models
    if (role === 'fire-hq' || user.fireStations !== undefined) return 'FireHQ';
    if (role === 'fire-station' || user.stationId !== undefined) return 'FireStation';
    if (role === 'fire-staff' || user.badgeNumber !== undefined) return 'FireStaff';

    // 🚓 Police Models
    if (role === 'police-hq' || user.policeStations !== undefined) return 'PoliceHQ';
    if (role === 'police-station' || user.jurisdictionArea !== undefined) return 'PoliceStation';
    if (role === 'police-staff' || user.officerRank !== undefined) return 'PoliceStaff';

    return 'User';
};

// 🚀 SMART HELPER: Extracts exact display name across ALL models
const getReporterDisplayName = (user, reporterModel) => {
    if (!user) return reporterModel || 'Reporter';

    // 1. Direct name fields
    if (user.name && user.name.trim() !== "") return user.name.trim();
    if (user.fullName && user.fullName.trim() !== "") return user.fullName.trim();

    // 2. Fire Models (Headquarter / Station / Staff)
    if (user.hqName) return user.hqName.trim();
    if (user.headquarterName) return user.headquarterName.trim();
    if (user.fireHqName) return user.fireHqName.trim();
    if (user.stationName) return user.stationName.trim();
    if (user.fireStationName) return user.fireStationName.trim();
    if (user.staffName) return user.staffName.trim();

    // 3. Police Models (HQ / Station / Staff)
    if (user.policeHqName) return user.policeHqName.trim();
    if (user.policeStationName) return user.policeStationName.trim();

    // 4. Vendors (Lab, Pharmacy, Hospital, Ambulance)
    if (user.labName) return user.labName.trim();
    if (user.pharmacyName) return user.pharmacyName.trim();
    if (user.hospitalName) return user.hospitalName.trim();
    if (user.driverInfo?.fullName) return user.driverInfo.fullName.trim();

    // 5. Fallbacks (Email / Phone)
    if (user.email) return user.email.trim();
    if (user.phone) return user.phone.trim();

    return reporterModel || "Reporter";
};

// ==========================================
// 1. CREATE ISSUE (User / Vendor / Fire / Police)
// ==========================================
const createIssueByUserOrVendor = async (req, res) => {
    try {
        const { 
            title, 
            detailedDescription, 
            category, 
            priority, 
            platform, 
            appVersion 
        } = req.body;

        const reporterModel = req.reporterModel || getReporterModel(req.user);
        const reporterId = req.user._id;

        // 🎯 Auto-extract exact dynamic display name (e.g. "Mohali Fire HQ", "Dr. Rajesh", etc.)
        const reporterDisplayName = getReporterDisplayName(req.user, reporterModel);

        if (!title || !detailedDescription) {
            return res.status(400).json({ 
                success: false, 
                message: "Title and Detailed description are required." 
            });
        }

        const validPlatforms = ['Web', 'App', 'Android', 'iOS'];
        const targetPlatform = (platform && validPlatforms.includes(platform)) ? platform : 'Web';

        const attachmentPaths = req.files ? req.files.map(f => `/uploads/issues/${f.filename}`) : [];
        const customCategory = (category && String(category).trim() !== "") ? String(category).trim() : "General";

        const newIssue = await Issue.create({
            reporterId,
            reporterModel,
            platform: targetPlatform,
            appVersion: appVersion || "",
            title: title.trim(),
            detailedDescription: detailedDescription.trim(),
            category: customCategory,
            priority: priority || "Medium",
            attachments: attachmentPaths,
            status: 'OPEN',
            timeline: [{
                status: 'OPEN',
                note: `Issue reported from ${targetPlatform} by ${reporterDisplayName} (${reporterModel}). Category: [${customCategory}]`,
                updatedBy: reporterId,
                updatedByName: reporterDisplayName, // 👈 Exact FireHQ / Station name aayega
                updatedByRole: reporterModel,
                timestamp: new Date()
            }]
        });

        // 🔔 Notify Admins with Actual Name
        try {
            await notifyAdminsAndVendor(
                null,
                'admin',
                `🚨 New [${reporterModel}] Issue Reported!`,
                `Ticket #${newIssue.ticketId}: ${newIssue.title} [${targetPlatform}] reported by ${reporterDisplayName} (${reporterModel}).`,
                { issueId: newIssue._id.toString(), platform: targetPlatform, type: 'new_issue_reported' }
            );
        } catch (e) {}

        res.status(201).json({
            success: true,
            message: "Issue submitted successfully. Our support team is reviewing it.",
            data: newIssue
        });

    } catch (error) {
        console.error("Create Issue Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 2. GET MY ISSUES LIST
// ==========================================
const getMyReportedIssues = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const { status, platform, search, category } = req.query;

        const query = { reporterId: req.user._id };

        if (status && status !== 'ALL') query.status = status.toUpperCase();
        if (platform && platform !== 'ALL') query.platform = platform;

        if (category && category.trim() !== '') {
            query.category = { $regex: category.trim(), $options: 'i' };
        }

        if (search && search.trim() !== "") {
            query.$or = [
                { title: { $regex: search.trim(), $options: 'i' } },
                { ticketId: { $regex: search.trim(), $options: 'i' } },
                { category: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const skip = (page - 1) * limit;

        const [issues, total] = await Promise.all([
            Issue.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Issue.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            totalRecords: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: issues
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET ISSUE TRACKING & TIMELINE BY ID
// ==========================================
const getIssueTimelineDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const issue = await Issue.findOne({ 
            _id: id, 
            reporterId: req.user._id 
        })
        .populate('resolutionDetails.resolvedBy', 'name email')
        .lean();

        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue ticket not found." });
        }

        res.status(200).json({
            success: true,
            data: issue
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createIssueByUserOrVendor,
    getMyReportedIssues,
    getIssueTimelineDetails
};