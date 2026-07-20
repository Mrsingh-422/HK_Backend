const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware.js'); 
const { 
    getProfileUpdateRequests, 
    getProfileUpdateRequestDetails, 
    handleProfileUpdateAction 
} = require('../../../controllers/admin/others/ProfileUpdateApproval.js'); // 👈 Fixed import path

// Base route: /api/admin/profile-update

// 1. GET: Fetch all requests with filters (?status=Pending&vendorModel=Doctor&page=1)
router.get('/', protect('admin'), getProfileUpdateRequests);

// 2. GET: Fetch specific request details with comparison payload
router.get('/:requestId', protect('admin'), getProfileUpdateRequestDetails);

// 3. POST: Process request (Approve/Reject)
router.post('/:requestId/action', protect('admin'), handleProfileUpdateAction);

module.exports = router;