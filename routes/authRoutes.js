// const express = require('express');
// const router = express.Router();

// // Middleware
// const { protect, checkPermission } = require('../middleware/authMiddleware');

// // Controllers
// const { registerUser, loginUser, updateUserProfile } = require('../controllers/user/authUser.js');
// const { registerDoctor, loginDoctor, updateDoctorProfile } = require('../controllers/doctor/authDoctor.js');
// const { registerSuperAdmin,loginAdmin, createSubAdmin, updateAdminProfile } = require('../controllers/admin/authAdmin.js');
// const { registerHospital, loginHospital, updateHospitalProfile } = require('../controllers/hospital/authHospital.js');
// const { registerProvider, loginProvider, updateProviderProfile } = require('../controllers/provider/authProvider.js');


// // --- 1. USER ROUTES ---
// router.post('/user/register', registerUser);
// router.post('/user/login', loginUser);
// router.put('/user/update', protect('user'), updateUserProfile) 

// // --- 2. DOCTOR ROUTES ---
// router.post('/doctor/register', registerDoctor);
// router.post('/doctor/login', loginDoctor);
// router.put('/doctor/update', protect('doctor'), updateDoctorProfile) 

// // --- 3. HOSPITAL ROUTES ---
// router.post('/hospital/register', registerHospital);
// router.post('/hospital/login', loginHospital);
// router.put('/hospital/update', protect('hospital'), updateHospitalProfile)

// // --- 4. PROVIDER ROUTES ---
// router.post('/provider/register', registerProvider);
// router.post('/provider/login', loginProvider);
// router.put('/provider/update', protect('provider'), updateProviderProfile)

// // --- 3. ADMIN ROUTES ---
// // Public Routes
// router.post('/register-super-admin', registerSuperAdmin); // Sirf pehli baar use karein
// router.post('/admin-login', loginAdmin);
// router.put('/admin/update', protect('admin'), updateAdminProfile);

// // Protected Routes (Sirf logged-in Admin hi access kar sakta hai)
// // 'protect("admin")' ka matlab hai token verify karo aur check karo ki Admin model me user hai ya nahi
// router.post('/create-subadmin', protect('admin'), createSubAdmin);


// module.exports = router;