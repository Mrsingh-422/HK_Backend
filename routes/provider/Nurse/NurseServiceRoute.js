const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseDocUploads } = require('../../../middleware/upload');
const { getNurseStats, handleNurseRequest } = require('../../../controllers/provider/Nurse/NurseDashboard');
const { addNurseService, getMyServices, deleteService } = require('../../../controllers/provider/Nurse/NurseService');

// Dashboard & Requests
router.get('/dashboard', protect('nurse'), getNurseStats);
router.patch('/order-action/:id', protect('nurse'), handleNurseRequest);

// Services (Daily Care / Packages)
router.post('/services/add', protect('nurse'), nurseDocUploads, addNurseService);
router.get('/services/list', protect('nurse'), getMyServices);
router.delete('/services/delete/:id', protect('nurse'), deleteService);

module.exports = router;