const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    addContact, 
    getContacts, 
    updateContact, 
    deleteContact 
} = require('../../../controllers/admin/others/EmergencyContact');

// Base URL: /admin/emergency-contacts

router.post('/add', protect('admin'), addContact);
router.get('/list', getContacts); // Public list for app or Admin
router.put('/update/:id', protect('admin'), updateContact);
router.delete('/delete/:id', protect('admin'), deleteContact);

module.exports = router;