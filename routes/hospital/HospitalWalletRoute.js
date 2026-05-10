const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getHospitalWalletStats,requestHospitalWithdrawal  } = require('../../controllers/hospital/HospitalWallet');

// Base URL: /hospital/wallet

router.get('/stats', protect('hospital'), getHospitalWalletStats);
router.post('/withdraw', protect('hospital'), requestHospitalWithdrawal);

module.exports = router;
