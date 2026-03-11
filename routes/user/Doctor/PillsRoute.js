const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    getMyPills,
    getTodaySchedule,
    addPill,
    recordPillAction,
    toggleReminder,
    updatePill,
    deletePill
} = require('../../../controllers/user/Doctor/Pills');

// Base route: /user/doctor/pills

router.get('/my-pills', protect('user'), getMyPills);
router.get('/today', protect('user'), getTodaySchedule); // Today's plan

router.post('/add', protect('user'), addPill);

router.patch('/action/:pillId', protect('user'), recordPillAction); // Taken/Snooze
router.patch('/toggle/:id', protect('user'), toggleReminder); // Quick toggle

router.put('/update/:id', protect('user'), updatePill);
router.delete('/delete/:id', protect('user'), deletePill);

module.exports = router;