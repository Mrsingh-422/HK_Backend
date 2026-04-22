const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { pharmacyPrescriptionUploads } = require('../../../middleware/multer');
const { scanPrescription,getMedicineCategories,getPharmacySubCategories,getMedicineCategoryDetails,getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails,getStandardMedicineCatalog,getMedicineVendors,
    getPharmacySlots,getPharmacyDeliveryCharges,checkoutMedicineOrder,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,getOrderHistory,trackOrder } = require('../../../controllers/user/Pharmacy/BookPharmacy');

// Base URL: /user/pharmacy

router.post('/scan-rx', 
    protect('user'), 
    pharmacyPrescriptionUploads.single('prescriptionFile'), 
    scanPrescription
);
router.get('/categories', getMedicineCategories);
router.get('/sub-categories', getPharmacySubCategories);
router.get('/category-details', getMedicineCategoryDetails);

router.get('/standard-list', getStandardMedicineCatalog); // get all list medicine
router.get('/medicine-details/:medicineId', getMedicineVendors); // Get medcine by id

router.get('/search-suggestions', getPharmacySearchSuggestions);
router.get('/pharmacy-suggestions', getPharmacyNameSuggestions);
router.post('/list', getPharmacies); // Search & Filter
router.get('/details/:id', getPharmacyDetails); // Profile Detail




router.get('/slots', protect('user'), getPharmacySlots); // Naya Endpoint
router.get('/delivery-charges', protect('user'), getPharmacyDeliveryCharges); // Re-use lab delivery logic if same

router.post('/validate-coupon',protect('user'),validateCoupon);

router.post('/checkout', 
    protect('user'), 
    pharmacyPrescriptionUploads.fields([{ name: 'prescriptionImages', maxCount: 5 }]), 
    checkoutMedicineOrder
);
router.post('/upload-prescription',protect('user'),uploadPrescription);
router.post('/cancel-order',protect('user'),cancelMedicineOrder);

router.post('/place-order',protect('user'),placeOrder);

router.get('/order-history',protect('user'),getOrderHistory);
router.get('/track-order/:orderId',protect('user'),trackOrder);

module.exports = router;