const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {
    getIncomingPrescriptionRequests,
    submitProposal,
    declinePrescriptionRequest,getVendorPrescriptionBookings
} = require('../../../controllers/provider/Nurse/NursePrescription');

// Base prefix: /provider/nurse/prescription

// 1. Get active incoming requests in range
router.get('/requests', protect('nurse'), getIncomingPrescriptionRequests);

// 2. Submit proposal bill for request
router.post('/respond', protect('nurse'), submitProposal);

// 3. Decline a request
router.post('/decline', protect('nurse'), declinePrescriptionRequest);

// 4. Get all prescription bookings for the nurse
router.get('/bookings', protect('nurse'), getVendorPrescriptionBookings);

module.exports = router;