const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseDocUploads } = require('../../../middleware/multer');
const { addOrUpdateService, 
    getMyServices, 
    deleteService 
 } = require('../../../controllers/provider/Nurse/NurseService');

// Base URL: /provider/nurse/service

// 1. Service Add/Update
router.post('/manage', protect('nurse'), nurseDocUploads, addOrUpdateService);
router.put('/manage/:id', protect('nurse'), nurseDocUploads, addOrUpdateService);

// 2. List Services (Use ?status=Approved or ?status=Pending)
router.get('/list', protect('nurse'), getMyServices);

// 3. Delete Service
router.delete('/delete/:id', protect('nurse'), deleteService);


module.exports = router; 