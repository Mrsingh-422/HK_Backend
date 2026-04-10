// routes/provider/Nurse/NurseDashboardRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseDocUploads } = require('../../../middleware/multer');
const { getNurseStats, handleNurseRequest } = require('../../../controllers/provider/Nurse/NurseDashboard');

// Nurse Dashboard
router.get('/dashboard', protect('nurse'), getNurseStats);
router.patch('/order-action/:id', protect('nurse'), handleNurseRequest);

module.exports = router;