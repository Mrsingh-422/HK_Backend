const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer'); // Tumhara multer middleware

const {
    updateSearchTest, getSearchTest,
    updatePrescriptionTest, getPrescriptionTest,
    updateHowItWorks, getHowItWorks,
    updateLabCare, getLabCare,
    updateAboutLab, getAboutLab,
    updateResearchSection, getResearchSection
} = require('../../../../controllers/admin/user/Home/LabPage'); 

// Base URL assumed: /api/labpage

// ===========================
// 1. SEARCH TEST
// ===========================
router.get('/search-test', getSearchTest);
router.post('/search-test', protect('admin'),checkRoleAccess(1), contentUploads, updateSearchTest); // Isme image upload nahi hai toh contentUploads mat lagao

// ===========================
// 2. PRESCRIPTION TEST
// ===========================
router.get('/prescription-test', getPrescriptionTest);
router.post('/prescription-test', protect('admin'),checkRoleAccess(1), contentUploads, updatePrescriptionTest);

// ===========================
// 3. HOW IT WORKS 
// ===========================
router.get('/how-it-works', getHowItWorks);
router.post('/how-it-works', protect('admin'),checkRoleAccess(1), contentUploads, updateHowItWorks); // Isme sirf JSON data aur stringify arrays hain

// ===========================
// 4. LAB CARE
// ===========================
router.get('/lab-care', getLabCare);
router.post('/lab-care', protect('admin'),checkRoleAccess(1), contentUploads, updateLabCare);

// ===========================
// 5. ABOUT LAB
// ===========================
router.get('/about-lab', getAboutLab);
router.post('/about-lab', protect('admin'),checkRoleAccess(1), contentUploads, updateAboutLab);

// ===========================
// 6. RESEARCH & VERIFY
// ===========================
router.get('/research', getResearchSection);
router.post('/research', protect('admin'),checkRoleAccess(1), contentUploads, updateResearchSection);

module.exports = router;