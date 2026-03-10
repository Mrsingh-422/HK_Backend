const express = require('express');
const router = express.Router();

// Middlewares
const { protect } = require('../../../middleware/authMiddleware');
const { ambulanceDocUploads } = require('../../../middleware/multer');

// Controller Functions
const { 
    addHospitalAmbulance, 
    getMyHospitalAmbulances, 
    updateHospitalAmbulance, 
    deleteHospitalAmbulance, 
    loginHospitalAmbulance 
} = require('../../../controllers/hospital/hospitalAmbulance/hosAmbulance');

// Base route  /api/hospital/ambulance

router.post('/add', protect('hospital'),ambulanceDocUploads, addHospitalAmbulance);

router.get('/my-ambulances', protect('hospital'), getMyHospitalAmbulances);

router.put('/update/:id', protect('hospital'), ambulanceDocUploads, updateHospitalAmbulance);

router.delete('/delete/:id', protect('hospital'), deleteHospitalAmbulance);

router.post('/login', loginHospitalAmbulance);


module.exports = router;