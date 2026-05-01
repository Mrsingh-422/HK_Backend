const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // Ensure this supports 'doctor'
const { 
    createDoctorCoupon, 
    getDoctorCoupons, 
    toggleDoctorCoupon, 
    updateDoctorCoupon, 
    deleteDoctorCoupon 
} = require('../../controllers/doctor/DoctorCoupon');

// Base URL: /doctor/coupon

router.post('/add', protect('doctor'), createDoctorCoupon);
router.get('/list', protect('doctor'), getDoctorCoupons);
router.patch('/toggle/:id', protect('doctor'), toggleDoctorCoupon);
router.put('/update/:id', protect('doctor'), updateDoctorCoupon);
router.delete('/delete/:id', protect('doctor'), deleteDoctorCoupon);

module.exports = router;