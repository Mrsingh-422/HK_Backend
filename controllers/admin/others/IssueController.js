const Issue = require('../../../models/Issue');
const moment = require('moment');

// ==========================================
// 1. CREATE NEW ISSUE (Modal: "+ ADD ISSUE")
// ==========================================
const createIssue = async (req, res) => {
    try {
        const { title, detailedDescription, category, loggedDate } = req.body;

        if (!title) {
            return res.status(400).json({ success: false, message: "Issue description/title is required." });
        }

        const newIssue = await Issue.create({
            title: title.trim(),
            detailedDescription: detailedDescription || "",
            category: category || "Other",
            loggedDate: loggedDate ? new Date(loggedDate) : new Date(),
            status: 'IN PROGRESS',
            createdBy: req.user?._id || null
        });

        res.status(201).json({
            success: true,
            message: "Issue logged successfully.",
            data: newIssue
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. GET ALL ISSUES (Search, Pagination, Filter)
// ==========================================
const getAllIssues = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", status } = req.query;

        const query = {};

        // Status Filter ('IN PROGRESS' or 'RESOLVED')
        if (status && status !== 'ALL') {
            query.status = status.toUpperCase();
        }

        // Live Search across Title and Description
        if (search.trim() !== "") {
            query.$or = [
                { title: { $regex: search.trim(), $options: 'i' } },
                { detailedDescription: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [issues, total] = await Promise.all([
            Issue.find(query)
                .populate('resolvedBy', 'name email role')
                .populate('createdBy', 'name email')
                .sort({ issueNumber: 1 }) // #1, #2... order
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            Issue.countDocuments(query)
        ]);

        // Format data matching exact screenshot UI
        const formattedData = issues.map(item => ({
            _id: item._id,
            displayId: `#${item.issueNumber}`,
            issueNumber: item.issueNumber,
            title: item.title,
            detailedDescription: item.detailedDescription,
            category: item.category,
            loggedDateFormatted: moment(item.loggedDate).format('YYYY-MM-DD'),
            status: item.status,
            resolvedByAdmin: item.resolvedBy ? item.resolvedBy.name : null,
            resolvedAt: item.resolvedAt,
            createdAt: item.createdAt
        }));

        res.status(200).json({
            success: true,
            totalRecords: total,
            totalPages: Math.ceil(total / Number(limit)),
            currentPage: Number(page),
            pageSize: Number(limit),
            data: formattedData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. EDIT ISSUE (Pencil Icon)
// ==========================================
const updateIssue = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, detailedDescription, category, loggedDate, status } = req.body;

        const updatePayload = {};
        if (title) updatePayload.title = title.trim();
        if (detailedDescription !== undefined) updatePayload.detailedDescription = detailedDescription;
        if (category) updatePayload.category = category;
        if (loggedDate) updatePayload.loggedDate = new Date(loggedDate);
        if (status) updatePayload.status = status;

        const updatedIssue = await Issue.findByIdAndUpdate(
            id,
            { $set: updatePayload },
            { new: true }
        ).populate('resolvedBy', 'name email');

        if (!updatedIssue) {
            return res.status(404).json({ success: false, message: "Issue not found." });
        }

        res.status(200).json({
            success: true,
            message: "Issue updated successfully.",
            data: updatedIssue
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. QUICK RESOLVE (Green Checkmark Button)
// ==========================================
const resolveIssue = async (req, res) => {
    try {
        const { id } = req.params;
        const resolvingAdminId = req.user?._id;

        const issue = await Issue.findById(id);
        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found." });
        }

        if (issue.status === 'RESOLVED') {
            return res.status(400).json({ success: false, message: "This issue is already marked as RESOLVED." });
        }

        issue.status = 'RESOLVED';
        issue.resolvedBy = resolvingAdminId;
        issue.resolvedAt = new Date();
        await issue.save();

        const populatedIssue = await Issue.findById(id).populate('resolvedBy', 'name email role');

        res.status(200).json({
            success: true,
            message: `Issue marked as RESOLVED by ${req.user?.name || 'Admin'}.`,
            data: {
                _id: populatedIssue._id,
                displayId: `#${populatedIssue.issueNumber}`,
                title: populatedIssue.title,
                status: populatedIssue.status,
                resolvedByAdmin: populatedIssue.resolvedBy?.name || "Admin",
                resolvedAt: populatedIssue.resolvedAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. DELETE ISSUE (Red Cross Button)
// ==========================================
const deleteIssue = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedIssue = await Issue.findByIdAndDelete(id);
        if (!deletedIssue) {
            return res.status(404).json({ success: false, message: "Issue not found." });
        }

        res.status(200).json({
            success: true,
            message: `Issue #${deletedIssue.issueNumber} deleted successfully.`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createIssue,
    getAllIssues,
    updateIssue,
    resolveIssue,
    deleteIssue
};