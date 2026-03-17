const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { savePhlebotomist, toggleStaffStatus } = require('../../../controllers/provider/Lab/LabsStaff');

// Base URL: /provider/labs/staff

// PROTECTED (Requires Provider token)
router.post('/add-phlebotomist', protect('lab'), savePhlebotomist);
router.patch('/toggle-status/:id', protect('lab'), toggleStaffStatus);

module.exports = router;
