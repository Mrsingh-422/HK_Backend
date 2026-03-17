const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getWalletStats,requestWithdrawal } = require('../../../controllers/provider/Common/Wallet'); // Apna Coupon controller import karein

// Route: GET /provider/wallet/stats
router.get('/wallet/stats', protect('provider'), getWalletStats);

// Route: POST /provider/wallet/withdraw
router.post('/wallet/withdraw', protect('provider'), requestWithdrawal);

module.exports = router;