const express = require('express');
const router = express.Router();
const { protect } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer'); // Same Multer from HomePage

const {
    updatePharmacyPage, getPharmacyPage,
    updateFeaturedProducts, getFeaturedProducts,
    updateMedicinePrescription, getMedicinePrescription,
    updateBestOfBest, getBestOfBest,
    updateRecommendedMed, getRecommendedMed,
    updateAboutMedicine, getAboutMedicine
} = require('../../../../controllers/admin/user/Home/MedicinePage');

// Base URL assumed: /api/medicinepage

// ===========================
// 1. PHARMACY PAGE HEADER
// ===========================
router.get('/pharmacy-main', getPharmacyPage);
router.post('/pharmacy-main', protect('admin'), updatePharmacyPage); // No images, just JSON data

// ===========================
// 2. FEATURED PRODUCTS 
// ===========================
router.get('/featured', getFeaturedProducts);
router.post('/featured', protect('admin'), updateFeaturedProducts); // No images, just JSON data

// ===========================
// 3. MEDICINE PRESCRIPTION
// ===========================
router.get('/prescription', getMedicinePrescription);
router.post('/prescription', protect('admin'), contentUploads, updateMedicinePrescription);

// ===========================
// 4. BEST OF BEST
// ===========================
router.get('/best-of-best', getBestOfBest);
router.post('/best-of-best', protect('admin'), contentUploads, updateBestOfBest);

// ===========================
// 5. RECOMMENDED MEDICINES
// ===========================
router.get('/recommended', getRecommendedMed);
router.post('/recommended', protect('admin'), contentUploads, updateRecommendedMed);

// ===========================
// 6. ABOUT MEDICINE
// ===========================
router.get('/about', getAboutMedicine);
router.post('/about', protect('admin'), contentUploads, updateAboutMedicine);

module.exports = router;