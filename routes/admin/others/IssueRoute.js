const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {
    getAllIssuesForAdmin,
    updateIssueStatusByAdmin,
    quickResolveIssueByAdmin,
    deleteIssueByAdmin
} = require('../../../controllers/admin/others/IssueController');

// Base URL: /admin/issues
router.get('/', protect('admin'), getAllIssuesForAdmin);
router.patch('/update-status/:id', protect('admin'), updateIssueStatusByAdmin);
router.patch('/resolve/:id', protect('admin'), quickResolveIssueByAdmin);
router.delete('/delete/:id', protect('admin'), deleteIssueByAdmin);

module.exports = router;