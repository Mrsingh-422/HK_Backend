const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseDocUploads } = require('../../../middleware/multer');
const { addNurseService,addOrUpdateService, getServicesByStatus, getMyServices, deleteService
    ,manageConsumable,listConsumables
 } = require('../../../controllers/provider/Nurse/NurseService');

// Base URL: /provider/nurse/service

router.post('/services/add', protect('nurse'), nurseDocUploads, addOrUpdateService);
router.put('/services/update/:id', protect('nurse'), nurseDocUploads, addOrUpdateService);
router.get('/services/list', protect('nurse'), getMyServices);
router.get('/services/status', protect('nurse'), getServicesByStatus);
router.delete('/services/delete/:id', protect('nurse'), deleteService);

router.post('/consumables/list', protect('nurse'), manageConsumable);
router.get('/consumables/list', protect('nurse'), listConsumables);

module.exports = router; 