// routes/admin/AdminWallet.js
const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../middleware/authMiddleware'); // Admin Auth protection
const { 
    getPendingWithdrawals, 
    approveWithdrawal, 
    rejectWithdrawal ,verifyVendorBankDetails,getPendingBankVerifications,getAdminWalletDashboardStats
} = require('../../controllers/admin/AdminWallet');

// Base URL: /api/admin/wallet

// Superadmin or subadmin role validations
router.get('/pending-withdrawals', protect('admin'), checkRoleAccess(55),getPendingWithdrawals);
router.patch('/approve-withdrawal/:requestId', protect('admin'), checkRoleAccess(55), approveWithdrawal);
router.patch('/reject-withdrawal/:requestId', protect('admin'),  checkRoleAccess(55),rejectWithdrawal);
router.patch('/verify-bank/:vendorModel/:vendorId', protect('admin'),  checkRoleAccess(55),verifyVendorBankDetails);
router.get('/pending-banks', protect('admin'),  checkRoleAccess(55),getPendingBankVerifications);
router.get('/dashboard-stats', protect('admin'), checkRoleAccess(55), getAdminWalletDashboardStats);


module.exports = router;