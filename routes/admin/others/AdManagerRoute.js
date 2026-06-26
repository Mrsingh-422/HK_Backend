const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { adUploads } = require('../../../middleware/multer');
const { 
    createAd, getAllAds, updateAd, deleteAd, getAdsByPage 
} = require('../../../controllers/admin/others/AdManager');

// base URL: /admin/ads

//Advertisement Management Routes tab=20
// Admin Routes
router.post('/add', protect('admin'), checkRoleAccess(20), adUploads, createAd);
router.get('/list', protect('admin'), checkRoleAccess(20), getAllAds);
router.put('/update/:id', protect('admin'), checkRoleAccess(20), adUploads, updateAd);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(20), deleteAd);

// Public Display Route for App
// GET /admin/ads/display?page=Medicine Store
router.get('/display', getAdsByPage);

module.exports = router;