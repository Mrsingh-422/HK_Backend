const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer');

const { 
    updateAboutUs, getAboutUs, 
    updateAmbulance, getAmbulance,
    updateHomepageSection, getHomepageSection,
    updateIntroductionSection, getIntroductionSection,
    updateFeaturedProducts, getFeaturedProducts,
    updateLaboratory, getLaboratory,
    updateAppSection, getAppSection,
    updateHospitalSection, getHospitalSection,
    updateNursingSection, getNursingSection
} = require('../../../../controllers/admin/user/Home/HomePageController');

// Base URL assumed: /api/homepage

// ===========================
// 1. ABOUT US
// ===========================
router.get('/about-us', getAboutUs);
router.post('/about-us', protect('admin'), checkRoleAccess(1),contentUploads, updateAboutUs);

// ===========================
// 2. AMBULANCE
// ===========================
router.get('/ambulance', getAmbulance);
router.post('/ambulance', protect('admin'), checkRoleAccess(1), contentUploads, updateAmbulance);

// ===========================
// 3. HOMEPAGE (MAIN/HERO) - (For your First Form)
// ===========================
router.get('/main', getHomepageSection);
router.post('/main', 
    protect('admin'), 
    checkRoleAccess(1),
    contentUploads, // Handles 'images' array
    updateHomepageSection
);

// ===========================
// 4. INTRODUCTION - (For your Second Form)
// ===========================
router.get('/introduction', getIntroductionSection);
router.post('/introduction', 
    protect('admin'), 
    checkRoleAccess(1),
    contentUploads, 
    updateIntroductionSection
);

// 5. Get Health App
router.post('/get-app', protect('admin'), checkRoleAccess(1), contentUploads, updateAppSection);
router.get('/get-app', getAppSection);

// 6. Hospitals
router.post('/hospitals', protect('admin'), checkRoleAccess(1), contentUploads, updateHospitalSection);
router.get('/hospitals', getHospitalSection);

// 7. Nursing
router.post('/nursing', protect('admin'), checkRoleAccess(1), contentUploads, updateNursingSection);
router.get('/nursing', getNursingSection);



// 11. FEATURED PRODUCTS (Medicine)
// ==================================================
router.post('/featured-products', protect('admin'), checkRoleAccess(1), contentUploads, updateFeaturedProducts);
router.get('/featured-products', getFeaturedProducts);

// ==================================================
// 12. LABORATORY
// ==================================================
router.post('/laboratory', protect('admin'), checkRoleAccess(1), contentUploads, updateLaboratory);
router.get('/laboratory', getLaboratory);

module.exports = router;