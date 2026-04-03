const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { adUploads } = require('../../../middleware/multer');
const { 
    createAd, getAllAds, updateAd, deleteAd, getAdsByPage 
} = require('../../../controllers/admin/others/AdManager');

// base URL: /admin/ads

// Admin Routes
router.post('/add', protect('admin'), adUploads, createAd);
router.get('/list', protect('admin'), getAllAds);
router.put('/update/:id', protect('admin'), adUploads, updateAd);
router.delete('/delete/:id', protect('admin'), deleteAd);

// Public Display Route for App
// GET /admin/ads/display?page=Medicine Store
router.get('/display', getAdsByPage);

module.exports = router;