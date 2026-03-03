const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const { createRole, getRolesList, assignRolesToAdmin } = require('../../controllers/subAdmin/RoleController');

// endpoint base: /admin/roles

router.post('/create', protect('admin'), createRole);
router.get('/list', protect('admin'), getRolesList);

router.put('/assign-roles', protect('admin'), (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ message: 'Only SuperAdmin can assign roles' });
    next();
}, assignRolesToAdmin);

module.exports = router;