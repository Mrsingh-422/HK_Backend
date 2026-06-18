// routes/admin/AdminWallet.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // Admin Auth protection
const { 
    getPendingWithdrawals, 
    approveWithdrawal, 
    rejectWithdrawal ,verifyVendorBankDetails,getPendingBankVerifications,getAdminWalletDashboardStats
} = require('../../controllers/admin/AdminWallet');

// Base URL: /api/admin/wallet

// Superadmin or subadmin role validations
router.get('/pending-withdrawals', protect('admin'), getPendingWithdrawals);
router.patch('/approve-withdrawal/:requestId', protect('admin'), approveWithdrawal);
router.patch('/reject-withdrawal/:requestId', protect('admin'), rejectWithdrawal);
router.patch('/verify-bank/:vendorModel/:vendorId', protect('admin'), verifyVendorBankDetails);
router.get('/pending-banks', protect('admin'), getPendingBankVerifications);
router.get('/dashboard-stats', protect('admin'), getAdminWalletDashboardStats);


module.exports = router;