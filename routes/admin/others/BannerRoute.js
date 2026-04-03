const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { bannerUploads } = require('../../../middleware/multer'); // Multer import
const { 
    createBanner, 
    getAllBanners, 
    updateBanner, 
    deleteBanner, 
    getAppBanners 
} = require('../../../controllers/admin/others/Banner');

// base URL: /admin/banners

// --- Admin Private Routes ---
router.post('/add', protect('admin'), bannerUploads, createBanner); // Multer added
router.put('/update/:id', protect('admin'), bannerUploads, updateBanner); // Multer added
router.get('/list', protect('admin'), getAllBanners);
router.delete('/delete/:id', protect('admin'), deleteBanner);

// --- Public Route for App/User ---
router.get('/display', getAppBanners);

module.exports = router;