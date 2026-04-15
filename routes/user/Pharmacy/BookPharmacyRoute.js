const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const {getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails,getStandardMedicineCatalog,
    checkoutMedicineOrder,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,getOrderHistory,trackOrder } = require('../../../controllers/user/Pharmacy/BookPharmacy');

// Base URL: /user/pharmacy

router.get('/standard-list', getStandardMedicineCatalog);

router.get('/search-suggestions', getPharmacySearchSuggestions);
router.get('/pharmacy-suggestions', getPharmacyNameSuggestions);

router.post('/list', getPharmacies); // Search & Filter
router.get('/details/:id', getPharmacyDetails); // Profile Detail


router.post('/checkout',protect('user'),checkoutMedicineOrder);
router.post('/validate-coupon',protect('user'),validateCoupon);

router.post('/upload-prescription',protect('user'),uploadPrescription);
router.post('/cancel-order',protect('user'),cancelMedicineOrder);

router.post('/place-order',protect('user'),placeOrder);

router.get('/order-history',protect('user'),getOrderHistory);
router.get('/track-order/:orderId',protect('user'),trackOrder);

module.exports = router;