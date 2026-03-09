const express = require('express');
const router = express.Router();

// Middlewares
const { protect } = require('../../middleware/authMiddleware');

// Controllers
const { 
    getAllTabs, 
    createRoleTemplate, 
    assignRoleToAdmin,  
    addNewTab,
    toggleTabStatus, updateRolePermissions
} = require('../../controllers/subAdmin/RoleController');

// Base route: /admin/roles

router.get('/tabs', protect('admin'), getAllTabs);

router.post('/create', protect('admin'), (req, res, next) => {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Only SuperAdmin can create role templates' });
    }
    next();
}, createRoleTemplate);

router.post('/assign', protect('admin'), (req, res, next) => {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Only SuperAdmin can assign roles to other admins' });
    }
    next();
}, assignRoleToAdmin);


router.post('/add-new-tab', protect('admin'), (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ message: "Unauthorized" });
    next();
}, addNewTab);

router.put('/toggle-tab-status', protect('admin'), (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ message: "Unauthorized" });
    next();
}, toggleTabStatus);

router.put('/update-role-permissions', protect('admin'), (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ message: "Unauthorized" });
    next();
}, updateRolePermissions);

module.exports = router;