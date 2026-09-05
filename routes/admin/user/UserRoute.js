const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    getAllUsersAdmin, 
    searchUsersAdmin, // New Search Controller
    getUserDetailsAdmin, 
    toggleUserStatus, 
    deleteUserAdmin ,
    adminUnbanUser,adminGetBannedUsers,adminGetUnbanRequests,adminHandleUnbanAction,
    getUserOrdersAdmin
} = require('../../../controllers/admin/user/User');

// Base URL: /admin/users

// 1. List Users with Pagination (Usage: /admin/users/list?page=1)
router.get('/list', protect('admin'), checkRoleAccess(1),getAllUsersAdmin);

// 2. Search Users (Usage: /admin/users/search?query=hardeep)
router.get('/search', protect('admin'), checkRoleAccess(1),searchUsersAdmin);

// 3. Single User Details
router.get('/details/:id', protect('admin'),checkRoleAccess(1), getUserDetailsAdmin);

// 4. Toggle Status (Approve/Block)
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(1), toggleUserStatus);

// 5. Delete User
router.delete('/delete/:id', protect('admin'), checkRoleAccess(1),  deleteUserAdmin);

router.get('/banned-users', protect('admin'), adminGetBannedUsers);
router.patch('/unban/:userId', protect('admin'), adminUnbanUser);
// Admin Unban Management
router.get('/unban-requests', protect('admin'), adminGetUnbanRequests);
router.patch('/unban-requests/:requestId', protect('admin'), adminHandleUnbanAction);

router.get('/details/:id/orders', protect('admin'), checkRoleAccess(1), getUserOrdersAdmin);


module.exports = router;