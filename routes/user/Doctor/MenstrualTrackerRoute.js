const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { 
    updatePeriodSettings, 
    logNewPeriodDate, 
    getPeriodInsights, 
    getCalendarHighlights,
    getPeriodHistory,
    deletePeriodDate,
        editPeriodDate
} = require('../../../controllers/user/Doctor/MenstrualController');

// Base URL: /user/doctor/menstrual

router.post('/settings', protect('user'), updatePeriodSettings); // Configure length & duration settings
router.post('/log-period', protect('user'), logNewPeriodDate);   // Logs new period start date ("Add" Button)
router.get('/insights', protect('user'), getPeriodInsights);      // Overview Panel Details
router.get('/calendar', protect('user'), getCalendarHighlights);  // Highlights Days in Calendar Tab (month level query)
router.get('/history', protect('user'), getPeriodHistory);        // History tab items listing
router.delete('/delete-period', protect('user'), deletePeriodDate); // Log delete
router.put('/edit-period', protect('user'), editPeriodDate);       // Log edit/update

module.exports = router;