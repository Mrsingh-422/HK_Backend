const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { pharmacyPrescriptionUploads } = require('../../../middleware/multer');
const { scanPrescription,getMedicineSuggestions,getMedicineFullDetails, getMedicineCategories,getPharmacySubCategories,getMedicineCategoryDetails,getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails,getTrendingMedicinesNearUser,getStandardMedicineCatalog,getMedicineVendors,
    getPharmacySlots,getPharmacyDeliveryCharges,checkoutMedicineOrder,getPharmacyAvailableCoupons,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,getOrderHistory,trackOrder } = require('../../../controllers/user/Pharmacy/BookPharmacy');

// Base URL: /user/pharmacy

router.post('/scan-rx', 
    protect('user'), 
    pharmacyPrescriptionUploads.single('prescriptionFile'), 
    scanPrescription
);
// --- API 1: GET MEDICINE SUGGESTIONS (Search Bar) ---
router.post('/search-suggestions', getMedicineSuggestions);
router.get('/full-details/:id', getMedicineFullDetails);

router.get('/categories', getMedicineCategories);
router.get('/sub-categories', getPharmacySubCategories);
router.get('/category-details', getMedicineCategoryDetails);

router.get('/standard-list', getStandardMedicineCatalog); // get all list medicine
router.post('/trending-medicines', getTrendingMedicinesNearUser); // Get trending medicines near user
router.get('/medicine-details/:medicineId', getMedicineVendors); // Get medcine by id

router.get('/search-suggestions', getPharmacySearchSuggestions);
router.get('/pharmacy-suggestions', getPharmacyNameSuggestions);
router.post('/list', getPharmacies); // Search & Filter
router.get('/details/:id', getPharmacyDetails); // Profile Detail




router.get('/slots', protect('user'), getPharmacySlots); // Naya Endpoint
router.get('/delivery-charges', protect('user'), getPharmacyDeliveryCharges); // Re-use lab delivery logic if same

router.post('/validate-coupon',protect('user'),validateCoupon);
router.get('/available-coupons',protect('user'),getPharmacyAvailableCoupons);

router.post('/checkout', 
    protect('user'),  
    checkoutMedicineOrder
);
router.post('/upload-prescription',protect('user'),uploadPrescription);
router.post('/cancel-order',protect('user'),cancelMedicineOrder);

router.post('/place-order', pharmacyPrescriptionUploads.fields([{ name: 'prescriptionImages', maxCount: 5 }]), protect('user'),placeOrder);

router.get('/order-history',protect('user'),getOrderHistory);
router.get('/track-order/:orderId',protect('user'),trackOrder);

module.exports = router;