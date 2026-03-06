const express = require('express');
const router = express.Router();

// Middlewares
const { protect } = require('../../middleware/authMiddleware');

// Controllers
const { 
    getAllTabs, 
    createRoleTemplate, 
    assignRoleToAdmin,  
    addNewTab
} = require('../../controllers/subAdmin/RoleController');

/**
 * @route   GET /api/admin/roles/tabs
 * @desc    Get all available permissions/tabs (PHP role table logic)
 * @access  Protected (Admin Only)
 */
router.get('/tabs', protect('admin'), getAllTabs);

/**
 * @route   POST /api/admin/roles/create
 * @desc    Create a new Role Template (e.g., "Manager" with tabIds [1,2,28])
 * @access  Protected (SuperAdmin Only)
 */
router.post('/create', protect('admin'), (req, res, next) => {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Only SuperAdmin can create role templates' });
    }
    next();
}, createRoleTemplate);

/**
 * @route   POST /api/admin/roles/assign
 * @desc    Assign a Role Template to an Admin user
 * @access  Protected (SuperAdmin Only)
 */
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

module.exports = router;