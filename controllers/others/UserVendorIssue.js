const Issue = require('../../models/Issue');
const { notifyAdminsAndVendor } = require('../../utils/notification');

// ==========================================
// 1. CREATE ISSUE (User / Lab / Doctor / Fire / Police)
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

        // 🎯 Exact Model Auto-detected from Middleware ('Lab', 'Doctor', 'User', etc.)
        const reporterModel = req.reporterModel || req.user?.constructor?.modelName || 'User';
        const reporterId = req.user._id;

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
            reporterModel, // 👈 Ab yahan 100% 'Lab' save hoga
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
                note: `Issue reported from ${targetPlatform} by ${req.user.name || reporterModel}. Category: [${customCategory}]`,
                updatedBy: reporterId,
                updatedByName: req.user.name || "Reporter",
                updatedByRole: reporterModel, // 👈 Timeline me bhi 'Lab' aayega
                timestamp: new Date()
            }]
        });

        // 🔔 Notify Admins
        try {
            await notifyAdminsAndVendor(
                null,
                'admin',
                `🚨 New [${reporterModel}] Issue Reported!`,
                `Ticket #${newIssue.ticketId}: ${newIssue.title} [${targetPlatform}] reported by ${reporterModel} (${req.user.name || ''}).`,
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