// routes/provider/Nurse/NurseDashboardRoute.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseServiceUploads } = require('../../../middleware/multer');
const {getNurseDashboard,addService, updateService, deleteService ,getMyServices, manageConsumable,listConsumables, deleteConsumable } = require('../../../controllers/provider/Nurse/NurseDashboard');

// Base URL: /provider/nurse/dash

// Nurse Dashboard
router.get('/get', protect('nurse'), getNurseDashboard);

// Nurse Services
router.post('/services/add', protect('nurse'), nurseServiceUploads, addService);
router.put('/services/update/:id', protect('nurse'), nurseServiceUploads, updateService);
router.delete('/services/delete/:id', protect('nurse'), deleteService);
router.get('/services/list', protect('nurse'), getMyServices);

// Nurse Consumables
router.post('/consumables/manage', protect('nurse'), manageConsumable);
router.get('/consumables/list', protect('nurse'), listConsumables);
router.delete('/consumables/delete/:id', protect('nurse'), deleteConsumable);
module.exports = router;