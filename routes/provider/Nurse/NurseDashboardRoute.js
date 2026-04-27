// routes/provider/Nurse/NurseDashboardRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseServiceUploads } = require('../../../middleware/multer');
const {getNurseDashboard,addService, updateService, deleteService  } = require('../../../controllers/provider/Nurse/NurseDashboard');

// Base URL: /provider/nurse/dash

// Nurse Dashboard
router.get('/dash', protect('nurse'), getNurseDashboard);

// Nurse Services
router.post('/services/add', protect('nurse'), nurseServiceUploads, addService);
router.put('/services/update/:id', protect('nurse'), nurseServiceUploads, updateService);
router.delete('/services/delete/:id', protect('nurse'), deleteService);
module.exports = router;