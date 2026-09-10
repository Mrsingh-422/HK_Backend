// controllers/admin/others/IssueController.js
const Issue = require('../../../models/Issue');
const moment = require('moment');
const { sendPushNotification } = require('../../../utils/notification');

// =========================================================================
// 1. GET ALL ISSUES (Admin Panel Table with Search & Filters)
// =========================================================================
const getAllIssuesForAdmin = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            search = "", 
            status, 
            platform, 
            reporterModel, 
            category 
        } = req.query;

        const query = {};

        if (status && status !== 'ALL') query.status = status.toUpperCase();
        if (platform && platform !== 'ALL') query.platform = platform;
        if (reporterModel && reporterModel !== 'ALL') query.reporterModel = reporterModel;

        if (category && category !== 'ALL' && category.trim() !== '') {
            query.category = { $regex: category.trim(), $options: 'i' };
        }

        if (search.trim() !== "") {
            query.$or = [
                { title: { $regex: search.trim(), $options: 'i' } },
                { ticketId: { $regex: search.trim(), $options: 'i' } },
                { category: { $regex: search.trim(), $options: 'i' } },
                { detailedDescription: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [issues, total] = await Promise.all([
            Issue.find(query)
                // 🚀 Populates all possible name fields across User, Vendors, Fire & Police
                .populate('reporterId', 'name fullName hqName headquarterName stationName fireStationName policeStationName labName pharmacyName email phone profileImage profilePic')
                .populate('resolutionDetails.resolvedBy', 'name email role')
                .sort({ issueNumber: 1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            Issue.countDocuments(query)
        ]);

        const formattedData = issues.map(item => {
            const rep = item.reporterId;
            const reporterDisplayName = rep ? (
                rep.name || rep.fullName || rep.hqName || rep.headquarterName ||
                rep.stationName || rep.fireStationName || rep.policeStationName ||
                rep.labName || rep.pharmacyName || rep.email || item.reporterModel
            ) : "Anonymous";

            return {
                _id: item._id,
                displayId: `#${item.issueNumber}`,
                ticketId: item.ticketId,
                platform: item.platform,
                appVersion: item.appVersion || null,
                title: item.title,
                detailedDescription: item.detailedDescription,
                category: item.category || "General",
                priority: item.priority,
                loggedDateFormatted: moment(item.createdAt).format('YYYY-MM-DD'),
                status: item.status,
                reporter: {
                    id: rep?._id || null,
                    name: reporterDisplayName, // 👈 Exact FireHQ / Station name
                    email: rep?.email || "N/A",
                    phone: rep?.phone || "N/A",
                    role: item.reporterModel
                },
                attachments: item.attachments,
                resolvedByAdmin: item.resolutionDetails?.resolvedBy?.name || null,
                resolvedAt: item.resolutionDetails?.resolvedAt || null,
                timeline: item.timeline
            };
        });

        const [totalOpen, totalInProgress, totalResolved, totalWebIssues, totalAppIssues] = await Promise.all([
            Issue.countDocuments({ status: { $in: ['OPEN', 'UNDER REVIEW'] } }),
            Issue.countDocuments({ status: 'IN PROGRESS' }),
            Issue.countDocuments({ status: 'RESOLVED' }),
            Issue.countDocuments({ platform: 'Web' }),
            Issue.countDocuments({ platform: { $in: ['App', 'Android', 'iOS'] } })
        ]);

        res.status(200).json({
            success: true,
            totalRecords: total,
            totalPages: Math.ceil(total / Number(limit)),
            currentPage: Number(page),
            pageSize: Number(limit),
            overview: {
                totalOpen,
                totalInProgress,
                totalResolved,
                totalWebIssues,
                totalAppIssues
            },
            data: formattedData
        });

    } catch (error) {
        console.error("Admin Get Issues Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 2. UPDATE ISSUE STATUS & ADD TIMELINE EVENT (Admin Action)
// =========================================================================
const updateIssueStatusByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, resolutionNote } = req.body;
        const adminId = req.user._id;
        const adminName = req.user.name || "Super Admin";

        const issue = await Issue.findById(id);
        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found." });
        }

        const validStatuses = ['OPEN', 'UNDER REVIEW', 'IN PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value." });
        }

        const newStatus = status || issue.status;
        issue.status = newStatus;

        issue.timeline.push({
            status: newStatus,
            note: note || `Status updated to ${newStatus} by Admin (${adminName}).`,
            updatedBy: adminId,
            updatedByName: adminName,
            updatedByRole: 'Admin',
            timestamp: new Date()
        });

        if (newStatus === 'RESOLVED') {
            issue.resolutionDetails = {
                resolvedBy: adminId,
                resolutionNote: resolutionNote || note || "Issue has been resolved successfully.",
                resolvedAt: new Date()
            };
        }

        await issue.save();

        // 🔔 Push Notification
        try {
            const recipientType = issue.reporterModel.toLowerCase();
            await sendPushNotification(
                issue.reporterId,
                recipientType,
                `Issue #${issue.ticketId} Update: ${newStatus}`,
                note || `Your reported [${issue.platform}] issue "${issue.title}" is now marked as ${newStatus}.`,
                { issueId: issue._id.toString(), status: newStatus, type: 'issue_status_updated' }
            );
        } catch (e) {}

        res.status(200).json({
            success: true,
            message: `Issue status updated to ${newStatus}.`,
            data: issue
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 3. QUICK RESOLVE BUTTON (Green Checkmark on Admin Screenshot)
// =========================================================================
const quickResolveIssueByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user._id;
        const adminName = req.user.name || "Super Admin";

        const issue = await Issue.findById(id);
        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found." });
        }

        issue.status = 'RESOLVED';
        issue.timeline.push({
            status: 'RESOLVED',
            note: `Quick resolved by ${adminName}.`,
            updatedBy: adminId,
            updatedByName: adminName,
            updatedByRole: 'Admin',
            timestamp: new Date()
        });
        issue.resolutionDetails = {
            resolvedBy: adminId,
            resolutionNote: "Issue resolved directly by Admin.",
            resolvedAt: new Date()
        };

        await issue.save();

        res.status(200).json({
            success: true,
            message: `Issue marked as RESOLVED by ${adminName}.`,
            data: issue
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. DELETE ISSUE (Red Cross Button)
// ==========================================
const deleteIssueByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Issue.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Issue not found." });
        }

        res.status(200).json({
            success: true,
            message: `Issue #${deleted.issueNumber} deleted successfully.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAllIssuesForAdmin,
    updateIssueStatusByAdmin,
    quickResolveIssueByAdmin,
    deleteIssueByAdmin
};