const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { doctorDocUploads } = require('../../../middleware/multer');
const { 
    loginHospitalDoctor,
    addHospitalDoctor, 
    getMyHospitalDoctors, 
    updateHospitalDoctor, 
    deleteHospitalDoctor 
} = require('../../../controllers/hospital/hospitalDoctor/hosDoctor');

// Base route: /api/hospital/doctors

// --- PUBLIC AUTH ROUTE ---
router.post('/login', loginHospitalDoctor);

// --- PROTECTED ROUTES (By Hospital) ---
router.post('/add', protect('hospital'), doctorDocUploads, addHospitalDoctor);
router.get('/my-doctors', protect('hospital'), getMyHospitalDoctors);
router.put('/update/:id', protect('hospital'), doctorDocUploads, updateHospitalDoctor);
router.delete('/delete/:id', protect('hospital'), deleteHospitalDoctor);

module.exports = router;