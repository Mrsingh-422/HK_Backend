const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware.js'); 
const { userProfileUpload, insuranceUpload } = require('../../middleware/multer');
const { 
    registerUser, 
    loginUser, 
    updateUserProfile,
    forgotPassword,
    verifyOtp,
    resetPassword,
    getUserProfile,
    editUserSubItem,
    removeUserSubItem,
    logoutUser,
    addUserAddress,
    addUserFamilyMember,
    getFamilyMembers,
    getFamilyMemberCount,
    editFamilyMember,
    removeFamilyMember,
    getMyInsurance,
    updateWorkDetails,
    updateFamilyHistory,
    updateMedicalConditions,
    updateInsuranceDetails,
    changePassword,
    addUserEmergencyContact, setDefaultAddress,uploadProfilePic,deleteAccount, updateLockerPin, getReferralDetails, getFamilyAccounts
} = require('../../controllers/user/authUser.js'); 

// Base route: /api/auth/user

// Auth
router.post('/register', registerUser);
router.post('/login', loginUser);

router.post('/logout', protect('user'), logoutUser);

// Forgot Password Flow
router.post('/forgot-password', forgotPassword); // Sends OTP
router.post('/verify-otp', verifyOtp);           // Verifies OTP
router.post('/reset-password', resetPassword);   // Sets New Password


router.get('/profile', protect('user'), getUserProfile); //get profile
router.put('/update', protect('user'), userProfileUpload, updateUserProfile);

// My Work
router.put('/update-work', protect('user'), updateWorkDetails);

// Add Address
router.post('/add-address', protect('user'), addUserAddress);

// Add Family Member (With Profile Pic support)
router.post('/add-family', protect('user'), userProfileUpload, addUserFamilyMember);
router.get('/family-members', protect('user'), getFamilyMembers); // get family members
router.get('/family-member-count', protect('user'), getFamilyMemberCount);
router.put('/edit-family-member/:itemId', protect('user'), userProfileUpload, editFamilyMember);  // edit family member
router.delete('/remove-family-member/:itemId', protect('user'), removeFamilyMember); // remove family member


router.put('/update-insurance', protect('user'), insuranceUpload.single('insuranceDocument'), updateInsuranceDetails);
router.get('/my-insurance', protect('user'), getMyInsurance);





// Add Emergency Contact
router.post('/add-emergency', protect('user'), addUserEmergencyContact);

// Example: /api/auth/user/edit-sub-item/family/65a123...
router.put('/edit-sub-item/:type/:itemId', protect('user'), editUserSubItem);  // type: address/family/emergency
router.delete('/remove-sub-item/:type/:itemId', protect('user'), removeUserSubItem); // type: address/family/emergency


router.patch('/set-default-address', protect('user'), setDefaultAddress); // Sets Default Address
router.post('/upload-profile-pic',protect('user'), userProfileUpload, uploadProfilePic); // Profile Pic
router.delete('/delete-account',protect('user'),deleteAccount); // Delete Account



// Medical Details
router.put('/update-family-history', protect('user'), updateFamilyHistory);
router.put('/update-medical-conditions', protect('user'), updateMedicalConditions);

// Insurance

// Security
router.put('/change-password', protect('user'), changePassword);

// Add Family Member (Figma Screen 4, 11)
// Note: Isme height, weight, dob, insuranceNo keys add hongi body mein
router.post('/add-family', protect('user'), userProfileUpload, addUserFamilyMember);

// Locker
router.put('/update-locker-pin', protect('user'), updateLockerPin);

// Referral
router.get('/referral-details', protect('user'), getReferralDetails);
router.get('/family-accounts', protect('user'), getFamilyAccounts);

module.exports = router;