const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { driverDocUploads } = require('../../../middleware/multer'); // Used for Profile update

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
    getAboutContent

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
router.get('/dashboard', protect('driver'), getLabDashboard);
router.get('/orders/list', protect('driver'), getDriverOrders);
router.get('/orders/detail/:bookingId', protect('driver'), getOrderDetail);
router.post('/orders/respond/:orderId', protect('driver'), respondToOrder);
router.patch('/orders/start/:orderId', protect('driver'), startDelivery); // "Start Service" button
router.patch('/orders/arrive/:orderId', protect('driver'), arriveAtLocation); // "Collect Sample" triggers OTP

router.post('/orders/verify-otp', protect('driver'), verifySampleCollection); // "Verify OTP" and change status to Sample Collected

router.post('/orders/deliver-lab/:orderId', protect('driver'), deliverSampleToLab); // "Sample Delivered to Lab" submit form
router.post('/orders/no-response/:orderId', protect('driver'), reportNoResponse); // "No Response" button action

// ==========================================
// 3. DYNAMIC ADDITIONS (Figma At-Home Patient Actions)
// ==========================================
router.post('/orders/create', protect('driver'), createBookingAtHome); // Fresh Booking registration
router.post('/orders/add-family/:bookingId', protect('driver'), addFamilyToBooking); // Add Family Members
router.patch('/orders/add-items/:bookingId', protect('driver'), appendItemsToBooking); // Append Tests/Packages

router.post('/orders/reassign-emergency', protect('driver'), reassignLabOrderDueToEmergency);

// ==========================================
// 4. HISTORY & INFORMATION
// ==========================================

router.get('/orders/history', protect('driver'), getDriverHistory);
router.get('/terms', protect('driver'), getTermsAndConditions);
router.get('/about', protect('driver'), getAboutContent);

module.exports = router;