const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../middleware/authMiddleware');

const {
    getDoctors, verifyDoctor,
    getHospitals, verifyHospital,
    getProviders, verifyProvider
} = require('../../controllers/admin/approvalController');

// --- DOCTOR MANAGEMENT (Tab ID: 31) ---
router.get('/doctors', protect('admin'), checkRoleAccess(31), getDoctors);
router.patch('/verify-doctor', protect('admin'), checkRoleAccess(31), verifyDoctor);

// --- HOSPITAL MANAGEMENT (Tab ID: 4) ---
router.get('/hospitals', protect('admin'), checkRoleAccess(4), getHospitals);
router.post('/verify-hospital', protect('admin'), checkRoleAccess(4), verifyHospital);

// --- PROVIDER MANAGEMENT ---

// Pharmacy (Tab ID: 28)
router.get('/providers/pharmacy', protect('admin'), checkRoleAccess(28), (req, res) => {
    req.query.category = 'Pharmacy';
    getProviders(req, res);
});

// Lab (Tab ID: 29)
router.get('/providers/lab', protect('admin'), checkRoleAccess(29), (req, res) => {
    req.query.category = 'Lab';
    getProviders(req, res);
});

// Nursing (Tab ID: 30)
router.get('/providers/nursing', protect('admin'), checkRoleAccess(30), (req, res) => {
    req.query.category = 'Nursing';
    getProviders(req, res);
});

/** 
 * Verify Provider:
 * Isme hum logic middleware se handle kar rahe hain. 
 * Agar multi-role access chahiye to checkRoleAccess ko category wise route pe lagayein.
 */
router.post('/verify-provider', protect('admin'), (req, res, next) => {
    // Ye dynamic check tab hoga jab single verify route ho. 
    // Lekin simple rakhne ke liye aap category wise checkRoleAccess use kar sakte hain routes upar ki tarah.
    next();
}, verifyProvider);

module.exports = router;