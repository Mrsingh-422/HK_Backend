const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { nurseProgressUpload } = require('../../../middleware/multer'); 

const { 
    getNurseBookings, 
    getBookingDetail,
    respondToBooking, 
    toggleDriverStatus,
    forgotPassword,
    verifyForgotOtp,
    resetPassword,
    changePassword,
    updateProfile,
    rejectBookingWithReason,
    arriveAtLocation,
    verifyOtpAndStartService,
    addProgressUpdate,
    submitServiceCompletion,
    verifyCompleteOtp,
    getAdminContact,
    getDriverHistory,
    getTermsAndConditions,
    getAboutContent

} = require('../../../controllers/driver/driverNurse/NurseDriverOrders');

// Base URL: /driver/nurse

// ==========================================
// 1. AUTHENTICATION & PASSWORD OPERATIONS
// ==========================================
router.post('/forgot-password', forgotPassword);
router.post('/verify-forgot-otp', verifyForgotOtp);
router.post('/reset-password', resetPassword);
router.patch('/change-password', protect('driver'), changePassword);

// ==========================================
// 2. PROFILE & STATUS (With Multer for Profile Picture)
// ==========================================
router.put('/update-profile', protect('driver'), nurseProgressUpload, updateProfile);
router.patch('/toggle-status', protect('driver'), toggleDriverStatus);
router.get('/contact-admin', protect('driver'), getAdminContact);

// ==========================================
// 3. SERVICE WORKFLOW & BOOKING MANAGEMENT
// ==========================================
router.get('/orders/list', protect('driver'), getNurseBookings);
router.get('/orders/detail/:bookingId', protect('driver'), getBookingDetail);
router.patch('/orders/respond/:bookingId', protect('driver'), respondToBooking);
router.patch('/orders/reject-reason/:bookingId', protect('driver'), rejectBookingWithReason);
router.patch('/orders/arrive/:bookingId', protect('driver'), arriveAtLocation);
router.post('/orders/verify-start-otp', protect('driver'), verifyOtpAndStartService);

router.patch('/orders/progress-update/:bookingId', protect('driver'), nurseProgressUpload, addProgressUpdate);

router.post('/orders/submit-completion/:bookingId', protect('driver'), nurseProgressUpload, submitServiceCompletion);

router.post('/orders/verify-complete-otp', protect('driver'), verifyCompleteOtp);

// ==========================================
// 4. HISTORY & INFORMATION
// ==========================================
router.get('/orders/history', protect('driver'), getDriverHistory); // My History Screen
router.get('/terms', protect('driver'), getTermsAndConditions); // Terms page
router.get('/about', protect('driver'), getAboutContent); // About page

module.exports = router;