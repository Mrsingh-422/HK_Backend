const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { prescriptionUploads } = require('../../../middleware/multer'); // Ensure this handles 'prescriptionImages' key
const { 
    getStandardCatalogTests,searchStandardTests, getStandardPackages,searchStandardPackages,getFemaleStandardPackages,getFemaleStandardTests,getSearchSuggestions,getLabSuggestions,
    getLabs, getLabDetails,getLabInventoryTests,searchLabInventoryTests,getLabInventoryPackages,searchLabInventoryPackages,
    
    getLabSlots, getLabDeliveryCharges,
    bookLabTest, uploadPrescriptionFlow,
    getMyBookings, getBookingDetails ,
    getLabsByMasterTest, getLabsByMasterPackage,
    getMasterTestDetails, getMasterPackageDetails,
    checkoutLabBooking,
    confirmPrescriptionBooking,
    rateLabOrder,cancelBooking,
    getAvailableCoupons ,validateLabCoupon,
    getPreparationGuide, suggestPersonalizedPackage,getTestSuggestions,getWomenSpecialTests,
    getWomenCategories,getWomenTestsByCategory
    
} = require('../../../controllers/user/Lab/BookLab');

// Base URL: /user/labs

router.post('/test-suggestions', getTestSuggestions);


router.get('/standard-tests', getStandardCatalogTests);
router.post('/standard-tests/details/:id', getMasterTestDetails);
router.post('/standard-tests/search', searchStandardTests); ///user/labs/standard-tests/search?page=1

router.get('/standard-packages', getStandardPackages); 
router.post('/standard-packages/details/:id', getMasterPackageDetails); ///user/labs/standard-packages/details/:id
router.post('/standard-packages/search', searchStandardPackages); ///user/labs/standard-packages/search?page=1
router.get('/standard-packages/female', getFemaleStandardPackages);
router.get('/standard-tests/female', getFemaleStandardTests);


router.get('/suggestions', getSearchSuggestions); //user/labs/suggestions?query=Labname
router.get('/lab-suggestions', getLabSuggestions); //user/labs/lab-suggestions?query=Labname
// Discovery
router.post('/list', getLabs);
router.get('/details/:id', getLabDetails);
// 2. Inventory - Tests for specific lab
router.get('/:labId/inventory-tests', getLabInventoryTests); // GET with ?page=1
router.post('/:labId/inventory-tests/search', searchLabInventoryTests); // POST with body {query: ""}
// 3. Inventory - Packages for specific lab
router.get('/:labId/inventory-packages', getLabInventoryPackages);
router.post('/:labId/inventory-packages/search', searchLabInventoryPackages);


router.get('/slots', getLabSlots); // user/labs/slots?labId=xxx&date=2024-08-20

// --- Guidance & Suggestion ---
router.get('/prep-guide', protect('user'), getPreparationGuide); // For Fasting/Instructions modal
router.post('/suggest-package', protect('user'), suggestPersonalizedPackage); // Figma Personalized Flow




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
router.post('/validate-coupon', protect('user'), validateLabCoupon); 
  

router.post('/book', protect('user'), bookLabTest);

// Tracking & History
router.get('/my-bookings', protect('user'), getMyBookings);
router.get('/details/:id/track', protect('user'), getBookingDetails);
router.put('/cancel/:id', protect('user'), cancelBooking);
router.post('/rate', protect('user'), rateLabOrder);

router.get('/women-special-tests', protect('user'), getWomenSpecialTests); //
router.get('/test/women/categories', protect('user'), getWomenCategories); //
router.get('/test/women/tests-by-category', protect('user'), getWomenTestsByCategory); //


module.exports = router;