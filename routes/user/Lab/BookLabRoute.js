const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { prescriptionUploads } = require('../../../middleware/multer'); // Ensure this handles 'prescriptionImages' key
const { 
    getStandardCatalogTests, getStandardPackages,
    getLabs, getLabDetails, getLabSlots, getLabDeliveryCharges,
    bookLabTest, uploadPrescriptionFlow,
    getMyBookings, getBookingDetails ,
    getLabsByMasterTest, getLabsByMasterPackage,
    getMasterTestDetails, getMasterPackageDetails,
    checkoutLabBooking,
    confirmPrescriptionBooking,
    rateLabOrder,cancelBooking,
    getAvailableCoupons 
    
} = require('../../../controllers/user/Lab/BookLab');

// Base URL: /user/labs


router.get('/standard-tests', getStandardCatalogTests);
router.get('/standard-packages', getStandardPackages); 


// Discovery
router.get('/list', getLabs);
router.get('/details/:id', getLabDetails);
router.get('/slots', getLabSlots);

router.get('/master-test/:id', protect('user'), getMasterTestDetails);
router.get('/master-package/:id', protect('user'), getMasterPackageDetails);

router.get('/comparison/test/:masterTestId', protect('user'), getLabsByMasterTest);
router.get('/comparison/package/:masterPackageId', protect('user'), getLabsByMasterPackage);

router.get('/delivery-charges', protect('user'), getLabDeliveryCharges); // NEW

// Booking (Protected)
router.post('/checkout', protect('user'), checkoutLabBooking);
router.post('/confirm-prescription', protect('user'), confirmPrescriptionBooking); // Prescription Flow Part 2
router.post('/upload-prescription', protect('user'), prescriptionUploads.array('prescriptionImages', 5), uploadPrescriptionFlow);

// Discovery & Logistics
router.get('/slots', protect('user'), getLabSlots); // User selects slot
router.get('/coupons', protect('user'), getAvailableCoupons); // User views applicable coupons


router.post('/book', protect('user'), bookLabTest);

// Tracking & History
router.get('/my-bookings', protect('user'), getMyBookings);
router.get('/details/:id/track', protect('user'), getBookingDetails);
router.put('/cancel/:id', protect('user'), cancelBooking);
router.post('/rate', protect('user'), rateLabOrder);


module.exports = router;