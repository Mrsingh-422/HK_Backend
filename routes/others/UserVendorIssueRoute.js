const express = require('express');
const router = express.Router();
const { protectIssueReporter } = require('../../middleware/issueAuthMiddleware'); // 👈 Naya Safe Middleware
const { issueUploads } = require('../../middleware/multer');
const {
    createIssueByUserOrVendor,
    getMyReportedIssues,
    getIssueTimelineDetails
} = require('../../controllers/others/UserVendorIssue');

// Base URL: /api/user-vendor/issues
router.post('/create', protectIssueReporter, issueUploads, createIssueByUserOrVendor);
router.get('/my-issues', protectIssueReporter, getMyReportedIssues);
router.get('/track/:id', protectIssueReporter, getIssueTimelineDetails);

module.exports = router;