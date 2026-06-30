const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer'); 

const { 
    forgotPassword,
    verifyForgotOtp,
    resetPassword,
    changePassword,
    updateProfile,
    toggleDriverStatus,
    getLabDashboard,
    getDriverOrders,
    getOrderDetail,
    respondToOrder,
    startDelivery,
    arriveAtLocation,
    verifySampleCollection,
    deliverSampleToLab,
    reportNoResponse,
    createBookingAtHome,
    addFamilyToBooking,
    appendItemsToBooking,
    getAdminContact,
    reassignLabOrderDueToEmergency,
    getDriverHistory,
    getTermsAndConditions,
    getAboutContent,
    
    // Razorpay DOORSTEP endpoints imports
    createDoorstepOrder,
    verifyDoorstepPayment,
    collectCashPayment
} = require('../../../controllers/driver/driverLab/LabDriverOrders');

// Base URL: /driver/lab

// ==========================================
// 1. AUTHENTICATION & PROFILE ACTIONS
// ==========================================
router.post('/forgot-password', forgotPassword);
router.post('/verify-forgot-otp', verifyForgotOtp);
router.post('/reset-password', resetPassword);
router.patch('/change-password', protect('driver'), changePassword);
router.put('/update-profile', protect('driver'), driverDocUploads, updateProfile);
router.patch('/toggle-status', protect('driver'), toggleDriverStatus);
router.get('/contact-admin', protect('driver'), getAdminContact);

// ==========================================
// 2. DIAGNOSTIC WORKFLOWS
// ==========================================
router.get('/orders/list', protect('driver'), getDriverOrders);
router.get('/orders/detail/:bookingId', protect('driver'), getOrderDetail);
router.post('/orders/respond/:orderId', protect('driver'), respondToOrder);
router.patch('/orders/start/:orderId', protect('driver'), startDelivery); 
router.patch('/orders/arrive/:orderId', protect('driver'), arriveAtLocation); 

router.post('/orders/verify-otp', protect('driver'), verifySampleCollection); 

router.post('/orders/deliver-lab/:orderId', protect('driver'), deliverSampleToLab); 
router.post('/orders/no-response/:orderId', protect('driver'), reportNoResponse); 

// ==========================================
// 3. DYNAMIC ADDITIONS & AT-HOME LOGS
// ==========================================
router.post('/orders/create', protect('driver'), createBookingAtHome); 
router.post('/orders/add-family/:bookingId', protect('driver'), addFamilyToBooking); 
router.patch('/orders/add-items/:bookingId', protect('driver'), appendItemsToBooking); 
router.post('/orders/reassign-emergency', protect('driver'), reassignLabOrderDueToEmergency);

// ==========================================
// 4. HISTORY, DRAWER & LEGAL INFORMATION
// ==========================================
router.get('/orders/history', protect('driver'), getDriverHistory);
router.get('/terms', protect('driver'), getTermsAndConditions);
router.get('/about', protect('driver'), getAboutContent);

// ==========================================
// 💡 5. DOORSTEP PAYMENT PATHS
// ==========================================
router.post('/orders/doorstep-payment/:bookingId', protect('driver'), createDoorstepOrder); // Generates QR payload
router.post('/orders/verify-doorstep-payment/:bookingId', protect('driver'), verifyDoorstepPayment); // Verifies signature & logs [1]
router.post('/orders/collect-cash/:bookingId', protect('driver'), collectCashPayment); // Logs CASH collection

module.exports = router;