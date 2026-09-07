const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {
    createIssue,
    getAllIssues,
    updateIssue,
    resolveIssue,
    deleteIssue
} = require('../../../controllers/admin/others/IssueController');

// Base URL: /admin/issues

router.get('/', protect('admin'), getAllIssues);                 // Search & Table list
router.post('/create', protect('admin'), createIssue);           // "+ ADD ISSUE" Modal
router.put('/update/:id', protect('admin'), updateIssue);        // Edit button
router.patch('/resolve/:id', protect('admin'), resolveIssue);    // Checkmark button (Quick Resolve)
router.delete('/delete/:id', protect('admin'), deleteIssue);     // Cross button (Delete)

module.exports = router;