const express = require('express');
const router = express.Router();
const { protect, checkAccess } = require('../../middleware/authMiddleware');


const {
    getDoctors, verifyDoctor,
    getHospitals, verifyHospital,
    getProviders, verifyProvider
} = require('../../controllers/admin/approvalController');


// --- DOCTOR MANAGEMENT ---
// List: Only if canSeeList is true
router.get('/doctors', protect('admin'),  getDoctors);
router.patch('/verify-doctor', protect('admin'), verifyDoctor);


// --- HOSPITAL MANAGEMENT ---
router.get('/hospitals', protect('admin'),  getHospitals);
router.post('/verify-hospital', protect('admin'), verifyHospital);


// --- PROVIDER MANAGEMENT (Special Case) ---
// Note: Isme list mixed ho sakti hai, isliye hum Controller ke andar ya Query Param se filter laga sakte hain.
// Lekin Verify ka logic Controller me handle kiya hai (Category wise).

// List: Alag-alag routes banaye taaki permission middleware lag sake
router.get('/providers/pharmacy', protect('admin'),  (req, res) => {
    req.query.category = 'Pharmacy'; // Force category
    getProviders(req, res);
});

router.get('/providers/lab', protect('admin'), (req, res) => {
    req.query.category = 'Lab';
    getProviders(req, res);
});

router.get('/providers/nursing', protect('admin'), (req, res) => {
    req.query.category = 'Nursing';
    getProviders(req, res);
});

// Verify: Single Route (Controller ke andar logic hai category check karne ka)
router.post('/verify-provider', protect('admin'), verifyProvider);

module.exports = router;