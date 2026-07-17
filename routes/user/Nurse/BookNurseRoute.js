const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { prescriptionUploads } = require('../../../middleware/multer');
const { 
    getNurses, getNurseDetails,searchNursesAndServices,  searchNurses,checkRangeAvailability,getNurseAvailability,getAvailableCoupons, validateCoupon, checkoutNurseBooking, placeNurseBooking,verifyNursePayment, getMyNurseBookings, rateNurseService,
    getAppointmentStatus, 
    uploadBookingPrescription ,getNurseDeliveryConfig,getGlobalPackages,rateNurseBooking,getNursePackagesList,
    getNursePackageDetails,getMedicalConditions,
    getGlobalServicesList,getProvidersForService, cancelNurseBooking

} = require('../../../controllers/user/Nurse/BookNurse');

// Base URL: /user/nurse

// Search/Filter list (POST is preferred for complex filters)
router.post('/list', getNurses); 
router.get('/details/:id', getNurseDetails);
router.get('/search-suggestions', searchNursesAndServices);

router.get('/packages/nurse', getGlobalPackages); // For users to see global packages offered by nurses (Screen 6) - Optional, can be integrated into /list with a filter


router.get('/delivery-config/:nurseId', getNurseDeliveryConfig); // For calculating delivery charges in checkout flow
// 2. Booking Flow
router.post('/checkout', protect('user'), checkoutNurseBooking);
router.post('/book', protect('user'), placeNurseBooking);
router.post('/verify-payment', protect('user'), verifyNursePayment);
router.get('/track/:id', protect('user'), getAppointmentStatus); // Figma Tracking Screen

router.get('/coupons/:id', getAvailableCoupons); // Get coupons applicable for this nurse/service
router.post('/validate-coupon', protect('user'), validateCoupon); // Validate coupon code and get discount details

// 3. Add-ons
router.patch('/add-prescription/:id', protect('user'), prescriptionUploads.single('prescription'), uploadBookingPrescription);

// 4. Availability
router.get('/check-range/:nurseId', checkRangeAvailability);
router.get('/availability/:nurseId', getNurseAvailability); // Screen 7
router.get('/my-appointments', protect('user'), getMyNurseBookings); // Screen 11
router.post('/rate', protect('user'), rateNurseService); // Screen 12




// Search (If you want a dedicated search endpoint)
router.post('/search', searchNurses);


router.post('/rate', protect('user'), rateNurseBooking);

///////////////////////// new api for flutter ///////////////////////////////
// 1. List of Packages (Filtered by optional nurseId query)
router.get('/packages/list', getNursePackagesList);

// 2. Single Package Detail
router.get('/packages/details/:packageId', getNursePackageDetails);
router.get('/medical-conditions', getMedicalConditions);

// 1. Get unique services list for home screen (Our Nursing Services)
router.get('/services/global', getGlobalServicesList);

// 2. Get providers offering a selected service
router.get('/services/providers', getProvidersForService);


router.patch('/cancel/:id',protect('user'),cancelNurseBooking);



module.exports = router;