const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    addContact, 
    getContacts, 
    updateContact, 
    deleteContact 
} = require('../../../controllers/admin/others/EmergencyContact');

// Base URL: /admin/emergency-contacts

router.post('/add', protect('admin'),checkRoleAccess(22), addContact);
router.get('/list', getContacts); // Public list for app or Admin
router.put('/update/:id', protect('admin'), checkRoleAccess(22), updateContact);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(22), deleteContact);

module.exports = router;