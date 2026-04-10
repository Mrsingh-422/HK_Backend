const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { getNurses,getNurseDetails, bookNurse, getMyNurseAppointments } = require('../../../controllers/user/Nurse/BookNurse');

// Base URL: /user/nurse

// Public List
router.post('/list', getNurses);

// Public Details
router.get('/details/:id', getNurseDetails);


// Protected Booking
router.post('/book', protect('user'), bookNurse);
router.get('/my-appointments', protect('user'), getMyNurseAppointments);








// Migrate Location
// router.get('/migrate-location', async (req, res) => {
//     try {
//         const Nurse = require('../../../models/Pharmacy');
        
//         // Sabhi nurses ko update karein jinke paas location nahi hai
//         const result = await Nurse.updateMany(
//             { "location.lat": { $exists: false } },
//             { 
//                 $set: { 
//                     "location.lat": 30.7333, // Default Mohali Lat
//                     "location.lng": 76.7794  // Default Mohali Lng
//                 } 
//             }
//         );

//         res.json({ 
//             success: true, 
//             message: `Migration successful! Updated ${result.modifiedCount} nurses.`,
//             modifiedCount: result.modifiedCount 
//         });
//     } catch (error) {
//         res.status(500).json({ success: false, message: error.message });
//     }
// });


module.exports = router;