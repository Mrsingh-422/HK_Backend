const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getAllUsersAdmin, 
    searchUsersAdmin, // New Search Controller
    getUserDetailsAdmin, 
    toggleUserStatus, 
    deleteUserAdmin 
} = require('../../../controllers/admin/user/User');

// Base URL: /admin/users

// 1. List Users with Pagination (Usage: /admin/users/list?page=1)
router.get('/list', protect('admin'), getAllUsersAdmin);

// 2. Search Users (Usage: /admin/users/search?query=hardeep)
router.get('/search', protect('admin'), searchUsersAdmin);

// 3. Single User Details
router.get('/details/:id', protect('admin'), getUserDetailsAdmin);

// 4. Toggle Status (Approve/Block)
router.patch('/toggle-status/:id', protect('admin'), toggleUserStatus);

// 5. Delete User
router.delete('/delete/:id', protect('admin'), deleteUserAdmin);

module.exports = router;