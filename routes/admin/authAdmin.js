const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { registerSuperAdmin, loginAdmin, createSubAdmin, updateAdminProfile,getAdminsList ,editSubadmin} = require('../../controllers/admin/authAdmin.js');

// Base route: /api/auth/admin (server.js me define hoga)

// Public Routes
router.post('/register-super-admin', registerSuperAdmin); 
router.post('/login', loginAdmin); // Maine isko 'login' kar diya hai taaki '/api/admin/login' bane

// Protected Routes
router.put('/update', protect('admin'), updateAdminProfile);
router.post('/create-subadmin', protect('admin'), createSubAdmin);
router.get('/manage-admins', protect('admin'), getAdminsList);
 router.put('/subadmins/:id', protect('admin'), editSubadmin);

module.exports = router;