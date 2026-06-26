const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nursingPrescriptionUploads } = require('../../../middleware/multer');
const {
    uploadAndParsePrescription,
    broadcastPrescriptionRequest,
    getUserPrescriptionHistory,
    getRequestProposals,
    acceptProposalAndBook,verifyPrescriptionPayment
} = require('../../../controllers/user/Nurse/NursingPrescriptionFlow');

// Base prefix: /user/nurse/prescription

// Upload prescription file and parse via AI (uses the new multer config)
router.post('/upload', protect('user'), nursingPrescriptionUploads.single('prescriptionImage'), uploadAndParsePrescription);

// Broadcast finalized service requirements to 10 nearest providers
router.post('/broadcast', protect('user'), broadcastPrescriptionRequest);

// View incoming requests from different providers
router.get('/history', protect('user'), getUserPrescriptionHistory);
// View incoming proposal bills from different providers
router.get('/proposals/:requestId', protect('user'), getRequestProposals);

// Accept selected proposal and generate order booking
router.post('/accept', protect('user'), acceptProposalAndBook);

// Verify prescription payment
router.post('/verify-payment', protect('user'), verifyPrescriptionPayment);

module.exports = router;