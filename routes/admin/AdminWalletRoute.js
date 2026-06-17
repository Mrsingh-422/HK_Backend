// routes/admin/AdminWallet.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // Admin Auth protection
const { 
    getPendingWithdrawals, 
    approveWithdrawal, 
    rejectWithdrawal 
} = require('../../controllers/admin/AdminWallet');

// Base URL: /api/admin/wallet

// Superadmin or subadmin role validations
router.get('/pending-withdrawals', protect('admin'), getPendingWithdrawals);
router.patch('/approve-withdrawal/:requestId', protect('admin'), approveWithdrawal);
router.patch('/reject-withdrawal/:requestId', protect('admin'), rejectWithdrawal);

module.exports = router;