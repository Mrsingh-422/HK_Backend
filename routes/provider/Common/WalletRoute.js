const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getWalletStats,requestWithdrawal } = require('../../../controllers/provider/Common/Wallet'); // Apna Coupon controller import karein

// Base URL: /provider/wallet

router.get('/stats', protect('provider'), getWalletStats);

router.post('/withdraw', protect('provider'), requestWithdrawal);

module.exports = router;