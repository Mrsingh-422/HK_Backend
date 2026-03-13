const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getMyPills,
    getTodaySchedule,
    addPill,
    recordPillAction,
    updatePill,
    deletePill
} = require('../../../controllers/user/Doctor/Pills');

// Base route: /user/doctor/pills

router.get('/my-pills', protect('user'), getMyPills);     // Settings/List screen
router.get('/today', protect('user'), getTodaySchedule);    // Home screen card
router.post('/add', protect('user'), addPill);              // Add medication screen
router.patch('/action/:pillId', protect('user'), recordPillAction); // Taken/Snooze buttons
router.put('/update/:id', protect('user'), updatePill);     // Edit screen
router.delete('/delete/:id', protect('user'), deletePill);  // Delete button in edit

module.exports = router;