const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { pharmacyDeliveryUpload } = require('../../../middleware/multer'); // सेंट्रलाइज्ड फ़ाइल से इंपोर्ट किया

const { 
    forgotPassword,
    verifyForgotOtp,
    resetPassword,
    changePassword,
    updateProfile,
    toggleDriverStatus,
    getPharmacyDashboard,
    getDriverOrders, 
    getOrderDetail, 
    respondToOrder, 
    startDelivery,
    arriveAtLocation, 
    verifyOtpAndDeliver, 
    returnOrder,
    getAdminContact,
    reassignOrderDueToEmergency,
    getDriverHistory,
    getTermsAndConditions,
    getAboutContent, reportPharmacyNoShow,

    getMyReturnPickups,
    updateReturnPickupStatus,
    verifyAndCompleteReturnPickup,
    reportFailedReturnPickup
} = require('../../../controllers/driver/driverPharmacy/Orders');

// Base URL: /driver/pharmacy

// ==========================================
// 1. AUTHENTICATION & PROFILE ACTIONS
// ==========================================
router.post('/forgot-password', forgotPassword);
router.post('/verify-forgot-otp', verifyForgotOtp);
router.post('/reset-password', resetPassword);
router.patch('/change-password', protect('driver'), changePassword);
router.put('/update-profile', protect('driver'), pharmacyDeliveryUpload, updateProfile);
router.patch('/toggle-status', protect('driver'), toggleDriverStatus);
router.get('/contact-admin', protect('driver'), getAdminContact);

// ==========================================
// 2. ORDER TRIP WORKFLOWS
// ==========================================
router.get('/dashboard', protect('driver'), getPharmacyDashboard); 
router.get('/orders/list', protect('driver'), getDriverOrders);
router.get('/orders/detail/:orderId', protect('driver'), getOrderDetail);
router.post('/orders/respond', protect('driver'), respondToOrder);
router.patch('/orders/start/:orderId', protect('driver'), startDelivery); // "Start" Route Button
router.patch('/orders/arrive/:orderId', protect('driver'), arriveAtLocation); // "Arrived" Button

// "Verify OTP" and upload Delivery Proof Photo
router.post('/orders/verify-otp', protect('driver'), pharmacyDeliveryUpload, verifyOtpAndDeliver);

// "Return Order" with comments
router.post('/orders/return/:orderId', protect('driver'), returnOrder);

router.post('/orders/reassign-emergency', protect('driver'), reassignOrderDueToEmergency);

// ==========================================
// 3. HISTORY & INFORMATION
// ==========================================
router.get('/orders/history', protect('driver'), getDriverHistory); // My History Screen
router.get('/terms', protect('driver'), getTermsAndConditions); // Terms page
router.get('/about', protect('driver'), getAboutContent); // About page


router.post('/orders/no-show', protect('driver'), reportPharmacyNoShow);

// ==========================================
// 4. RETURN PICKUP FLOW
// ==========================================
router.get('/return-pickups/my-tasks', protect('driver'), getMyReturnPickups);
router.patch('/return-pickups/status/:orderId', protect('driver'), updateReturnPickupStatus);
router.post('/return-pickups/verify-pickup', protect('driver'), pharmacyDeliveryUpload, verifyAndCompleteReturnPickup);
router.post('/return-pickups/report-failed', protect('driver'), reportFailedReturnPickup); 


module.exports = router;